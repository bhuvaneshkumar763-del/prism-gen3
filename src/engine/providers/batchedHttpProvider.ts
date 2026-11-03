import { err, ok, type Result } from '../../shared/result';
import { connectivity } from '../connectivity';
import { getAdaptiveConcurrency } from '../networkQuality';
import type { PieceOutcome, TranslateBatchRequest, TranslateError, Translator } from '../translator';
import { isSuspiciousOutcome } from './outputSanityCheck';

/**
 * Shared machinery for HTTP translation providers: request-level dedupe, a
 * soft per-request char budget that bundles many small pieces into few HTTP
 * calls, retry-with-backoff honoring `Retry-After`, a shared concurrency cap,
 * and a repair pass for missing/suspicious pieces. `fetch`-based and free of
 * `chrome`/`browser` APIs so it can live in `src/engine/`.
 *
 * Two levels: each piece (1+ related strings) is wire-encoded by
 * `transformPiece`; several encoded pieces are bundled into one request up to
 * `maxBatchChars`. `parseResponse` maps the response back to one raw string
 * per piece (request order), and `splitPieceResponse` decodes each back into
 * its original N-string shape.
 */

interface RawPieceResult {
  text: string;
  detectedLanguage: string | null;
}

export interface BatchedProviderCallbacks {
  transformPiece(strings: string[]): string;
  /**
   * Given the parsed response body and how many pieces were sent, return one
   * entry per piece (null = missing), or null when the body's shape can't be
   * read at all. Validate rather than cast: a changed shape is a bad response.
   */
  parseResponse(response: unknown, pieceCount: number): Array<RawPieceResult | null> | null;
  splitPieceResponse(raw: string): string[];
  getRequestBody?(sourceLanguage: string, targetLanguage: string, pieceWireTexts: string[]): string | undefined;
  getExtraHeaders?(): Array<{ name: string; value: string }>;
}

export interface BatchedProviderOptions {
  name: string;
  /** Requests are POSTed here. */
  baseUrl: string;
  callbacks: BatchedProviderCallbacks;
  /**
   * Soft per-request budget of CONTENT characters (pre-`transformPiece`).
   * Per-request overhead dominates at small values; positional alignment was
   * measured exact at up to 300 pieces/request, so 2000 is a safe default.
   */
  maxBatchChars?: number;
  /** Hard cap on pieces per HTTP request, for endpoints with a documented per-request segment limit. Unset = no piece limit. */
  maxBatchPieces?: number;
  /** Cap on concurrent in-flight HTTP requests. Default 6 — firing every chunk of a long page at once tends to trip rate limiters. */
  maxConcurrent?: number;
  /**
   * Optional hooks around the whole translateBatch() call, for a
   * platform-supplied concern like an MV3 service-worker keepalive — the
   * engine itself never touches `browser`/`chrome` APIs (see
   * src/engine/README.md), so this is how that gets wired in from
   * src/platform/ without breaking the purity boundary.
   */
  onBatchStart?(): void;
  onBatchEnd?(): void;
  /**
   * Fired on a non-retryable HTTP status (not 429/5xx) before the error is
   * thrown, so a provider can drop a rejected credential immediately.
   * `reason` is the service's own message (see `readRejectionReason`): Google
   * answers a bad key with a 400 that only its message tells apart.
   */
  onNonRetryableStatus?(status: number, reason: string | null): void;
  /**
   * Fired once (edge-triggered) when the rolling window of the last
   * `SUSPICIOUS_WINDOW_SIZE` pieces crosses `SUSPICIOUS_RATIO_THRESHOLD`
   * suspicious: almost everything echoing back untranslated looks like broken
   * auth, so the provider can force a credential refresh.
   */
  onSuspiciousStreak?(): void;
}

/**
 * A failed attempt and whether another attempt could help. A 4xx other than
 * 429 (bad key, malformed request) and an unreadable answer are permanent;
 * retrying them only burns the retry budget.
 */
class RequestFailure extends Error {
  constructor(
    readonly error: TranslateError,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(error.message);
  }
}

function describeThrown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const MAX_REJECTION_REASON_CHARS = 200;

/**
 * The service's own explanation of a rejection, from the response body —
 * Google-style `{error: {message}}`, Google's protobuf-JSON `[code, "message",
 * ...]` (the free endpoint's shape), a bare `{message}`/`{error: "..."}`, or a
 * short plain-text body. Null for an empty body or an HTML error page: markup
 * is never worth showing a user, and a status code alone is honest.
 */
async function readRejectionReason(response: Response): Promise<string | null> {
  let text: string;
  try {
    text = (await response.text()).trim();
  } catch {
    return null;
  }
  if (!text || text.startsWith('<')) return null;
  let reason: unknown = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      reason = parsed[1] ?? null;
    } else {
      const body = parsed as { error?: unknown; message?: unknown };
      const nested =
        typeof body.error === 'object' && body.error !== null
          ? (body.error as { message?: unknown }).message
          : undefined;
      reason = nested ?? body.message ?? body.error ?? null;
    }
  } catch {
    // not JSON — the plain text itself is the reason
  }
  if (typeof reason !== 'string') return null;
  const collapsed = reason.replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed.slice(0, MAX_REJECTION_REASON_CHARS) : null;
}

interface PendingRequest {
  wireText: string;
  /**
   * The piece's ORIGINAL strings joined (pre-`transformPiece`).
   * `isSuspiciousOutcome` compares against this, not `wireText`: a wrapped
   * request (Google wraps in `<pre>`) can never equal an unwrapped response.
   */
  originalText: string;
  resolve(settlement: PieceSettlement): void;
}

/** A piece's raw wire result, or why it has none. */
type PieceSettlement = Result<RawPieceResult, TranslateError>;

const DEFAULT_MAX_BATCH_CHARS = 2000;
/**
 * Hard ceiling on WIRE characters per request, alongside the content budget
 * (`maxBatchChars`); whichever trips first closes the batch. 6000 is the
 * largest size verified against the live endpoint with zero misalignment.
 */
const HARD_MAX_WIRE_CHARS = 6000;
const DEFAULT_MAX_CONCURRENT = 6;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
// Deliberately conservative: legitimate suspicious content (endonyms,
// numbers, proper nouns) comes in small clusters, not 27+ of 30 consecutive
// pieces, so this shouldn't fire on a healthy page.
const SUSPICIOUS_WINDOW_SIZE = 30;
const SUSPICIOUS_RATIO_THRESHOLD = 0.9;
// Bounds the WHOLE retry sequence (otherwise ~62s worst case): the first
// attempt gets a full REQUEST_TIMEOUT_MS, later ones only what's left.
const OVERALL_DEADLINE_MS = 30000;

interface ConcurrencyGate {
  run<T>(worker: () => Promise<T>): Promise<T>;
}

/**
 * A semaphore gating at most `getLimit()` in-flight tasks. `getLimit` is
 * polled on every dispatch so a connection-quality change applies mid-run.
 * One gate per provider instance: the provider is a long-lived singleton
 * shared by the page, attribute and title translators, and all of them (plus
 * repair retries) must draw from the same `maxConcurrent` budget.
 */
function createConcurrencyGate(getLimit: () => number): ConcurrencyGate {
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  function pump(): void {
    while (inFlight < getLimit() && waiters.length > 0) {
      const next = waiters.shift();
      if (next) {
        inFlight++;
        next();
      }
    }
  }

  return {
    run<T>(worker: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiters.push(() => {
          worker().then(
            (value) => {
              inFlight--;
              resolve(value);
              pump();
            },
            (error: unknown) => {
              inFlight--;
              reject(error as Error);
              pump();
            },
          );
        });
        pump();
      });
    },
  };
}

export function createBatchedHttpProvider(options: BatchedProviderOptions): Translator {
  const maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const configuredMaxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  // Provider-level, so every translateBatch() call and repair retry shares it.
  const concurrencyGate = createConcurrencyGate(() => getAdaptiveConcurrency(configuredMaxConcurrent));

  /** In-flight dedupe: two identical concurrent piece requests share one HTTP call's result. */
  const inFlightByKey = new Map<string, Promise<PieceSettlement>>();
  const label = `[${options.name}]`;
  const timedOut = (): RequestFailure => new RequestFailure({ kind: 'timeout', message: `${label} timed out` }, true);

  // Provider-level rolling window of the last SUSPICIOUS_WINDOW_SIZE piece
  // classifications (the auth key it protects is provider-wide).
  // `suspiciousStreakActive` makes `onSuspiciousStreak` fire once per crossing.
  const suspiciousWindow: boolean[] = [];
  let suspiciousStreakActive = false;

  /**
   * Records one piece's final suspicious/not classification and returns
   * whether the ratio is over threshold. Called from `resolveFn`, which every
   * piece's final settlement (first attempt or repair) goes through.
   */
  function recordSuspiciousSample(isSuspicious: boolean): boolean {
    suspiciousWindow.push(isSuspicious);
    if (suspiciousWindow.length > SUSPICIOUS_WINDOW_SIZE) suspiciousWindow.shift();
    if (suspiciousWindow.length < SUSPICIOUS_WINDOW_SIZE) {
      suspiciousStreakActive = false;
      return false;
    }
    const suspiciousCount = suspiciousWindow.reduce((count, sample) => count + (sample ? 1 : 0), 0);
    const overThreshold = suspiciousCount / suspiciousWindow.length >= SUSPICIOUS_RATIO_THRESHOLD;
    if (overThreshold) {
      if (!suspiciousStreakActive) options.onSuspiciousStreak?.();
      suspiciousStreakActive = true;
    } else {
      suspiciousStreakActive = false;
    }
    return overThreshold;
  }

  async function sendOnce(
    sourceLanguage: string,
    targetLanguage: string,
    pieceWireTexts: string[],
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let backstopTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Raced against a plain timer: WebKit doesn't always reject an aborted
      // fetch once headers have arrived and the body is mid-read. A hung call
      // would never return its concurrency-gate permit, and the gate is a
      // long-lived singleton. The +500 lets the real abort error win normally.
      return await Promise.race([
        (async () => {
          // An abort is our own timer firing, so it's a timeout, not a dropped connection.
          const unreachable = (e: unknown): RequestFailure =>
            controller.signal.aborted
              ? timedOut()
              : new RequestFailure({ kind: 'network', message: `${label} network error: ${describeThrown(e)}` }, true);
          let response: Response;
          try {
            response = await fetch(options.baseUrl, {
              method: 'POST',
              headers: Object.fromEntries((options.callbacks.getExtraHeaders?.() ?? []).map((h) => [h.name, h.value])),
              body: options.callbacks.getRequestBody?.(sourceLanguage, targetLanguage, pieceWireTexts),
              signal: controller.signal,
            });
          } catch (e) {
            throw unreachable(e);
          }

          const { status } = response;
          if (status === 429 || status >= 500) {
            const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
            const error: TranslateError =
              status === 429
                ? { kind: 'rateLimited', status, message: `${label} rate-limited (HTTP 429)` }
                : { kind: 'http', status, message: `${label} server error (HTTP ${status})` };
            throw new RequestFailure(error, true, retryAfter > 0 ? Math.min(6000, retryAfter * 1000) : undefined);
          }
          if (!response.ok) {
            const reason = await readRejectionReason(response);
            options.onNonRetryableStatus?.(status, reason);
            throw new RequestFailure(
              {
                kind: 'http',
                status,
                ...(reason ? { reason } : {}),
                message: `${label} rejected (HTTP ${status})${reason ? `: ${reason}` : ''}`,
              },
              false,
            );
          }
          let body: string;
          try {
            body = await response.text();
          } catch (e) {
            throw unreachable(e);
          }
          try {
            return JSON.parse(body) as unknown;
          } catch {
            throw new RequestFailure({ kind: 'badResponse', message: `${label} response is not valid JSON` }, false);
          }
        })(),
        new Promise<never>((_, reject) => {
          backstopTimeout = setTimeout(() => reject(timedOut()), timeoutMs + 500);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      clearTimeout(backstopTimeout);
    }
  }

  async function sendWithRetry(
    sourceLanguage: string,
    targetLanguage: string,
    pieceWireTexts: string[],
    // Absolute deadline from a parent call, so a repair retry shares the
    // original budget instead of starting a fresh one. Unset at top level.
    inheritedDeadline?: number,
  ): Promise<unknown> {
    const deadline = inheritedDeadline ?? Date.now() + OVERALL_DEADLINE_MS;
    let lastFailure: RequestFailure | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        // Offline: remaining attempts are doomed, so stop retrying. Only the
        // retries are skipped (navigator.onLine has false positives); the
        // first attempt always goes out.
        if (!connectivity.isOnline()) break;

        let delay = attempt === 1 ? 400 : 1200;
        if (lastFailure?.retryAfterMs && lastFailure.retryAfterMs > delay) {
          // A server-specified Retry-After is used exactly, not jittered.
          delay = lastFailure.retryAfterMs;
        } else {
          // ±25% jitter so many pieces failing together don't retry in lockstep.
          delay = delay * 0.75 + Math.random() * delay * 0.5;
        }
        // Never sleep past the overall deadline.
        delay = Math.min(delay, deadline - Date.now());
        if (delay <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        return await sendOnce(sourceLanguage, targetLanguage, pieceWireTexts, Math.min(REQUEST_TIMEOUT_MS, remaining));
      } catch (e) {
        if (!(e instanceof RequestFailure) || !e.retryable) throw e;
        lastFailure = e;
      }
    }
    // No failure yet means the deadline ran out before the first attempt.
    throw lastFailure ?? timedOut();
  }

  /**
   * Sends one bundled request. Pieces missing from the response, or flagged
   * suspicious, are retried individually once before being marked as errors.
   */
  async function handleBatch(
    sourceLanguage: string,
    targetLanguage: string,
    pending: PendingRequest[],
    isIndividualRetry = false,
    // Absolute deadline (ms since epoch), reused as-is by the repair retry.
    deadline: number = Date.now() + OVERALL_DEADLINE_MS,
    /**
     * Language a SUSPICIOUS piece is re-requested with. Supplied by a
     * provider that sends `'auto'` on the wire (see `google.ts`): retrying
     * such a piece with `'auto'` again would repeat the identical request,
     * so the caller hands down the page's guessed language instead.
     */
    suspiciousRetrySourceLanguage: string | undefined = undefined,
  ): Promise<void> {
    try {
      const response = await sendWithRetry(
        sourceLanguage,
        targetLanguage,
        pending.map((p) => p.wireText),
        deadline,
      );
      const parsed = options.callbacks.parseResponse(response, pending.length);
      if (parsed === null) {
        throw new RequestFailure({ kind: 'badResponse', message: `${label} response has an unexpected shape` }, false);
      }
      // Results are matched by position; on a count mismatch, treat the whole request as missing.
      const results = parsed.length === pending.length ? parsed : [];
      const missing: PendingRequest[] = [];
      // Which `missing` entries were a 200 OK that looked like a silent echo,
      // as opposed to no data at all. Reported as `'suspicious'` if the
      // repair retry is also exhausted.
      const missingBecauseSuspicious = new Set<PendingRequest>();

      pending.forEach((p, idx) => {
        const result = results[idx];
        if (!result) {
          missing.push(p);
          return;
        }
        // Decode the wire response back to plain text before the sanity
        // check, so the comparison is original-vs-translation rather than
        // wrapped-request-vs-unwrapped-response (see PendingRequest.originalText).
        const decoded = options.callbacks.splitPieceResponse(result.text).join('');
        if (isSuspiciousOutcome(p.originalText, { ...result, text: decoded }, sourceLanguage, targetLanguage)) {
          missing.push(p);
          missingBecauseSuspicious.add(p);
          return;
        }
        p.resolve(ok(result));
      });

      if (missing.length === 0) return;
      if (isIndividualRetry) {
        missing.forEach((p) => {
          p.resolve(
            err(
              missingBecauseSuspicious.has(p)
                ? {
                    kind: 'suspicious',
                    message: `${label} result kept looking like a silent-echo failure after a repair retry`,
                  }
                : { kind: 'badResponse', message: `${label} no result for this piece` },
            ),
          );
        });
        return;
      }
      // A suspicious piece suggests its declared source language is wrong
      // (Google echoes input told source == target), so it retries with
      // `suspiciousRetrySourceLanguage` or 'auto'; a missing piece keeps it.
      //
      // Through the shared gate but NOT awaited: this call already holds a
      // slot, so awaiting children deadlocks at low limits. Callers await
      // each piece's own promise, and handleBatch never throws.
      missing.forEach((p) => {
        void concurrencyGate.run(() =>
          handleBatch(
            missingBecauseSuspicious.has(p)
              ? (suspiciousRetrySourceLanguage ?? (sourceLanguage !== 'auto' ? 'auto' : sourceLanguage))
              : sourceLanguage,
            targetLanguage,
            [p],
            true,
            deadline,
            suspiciousRetrySourceLanguage,
          ),
        );
      });
    } catch (e) {
      console.error(`${label} translation request failed`, e);
      // Anything but a RequestFailure was thrown while reading the answer.
      const error: TranslateError =
        e instanceof RequestFailure
          ? e.error
          : { kind: 'badResponse', message: `${label} couldn't read the response: ${describeThrown(e)}` };
      pending.forEach((p) => {
        p.resolve(err(error));
      });
    }
  }

  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const { sourceLanguage, targetLanguage, pieces, onPieceComplete, suspiciousRetrySourceLanguage } = request;

      // Bundle pieces into HTTP-request-sized batches, sharing in-flight
      // requests for identical (already-transformed) piece text.
      const batches: PendingRequest[][] = [];
      let currentBatch: PendingRequest[] = [];
      /** Content length (pre-`transformPiece`), budgeted by `maxBatchChars`. */
      let currentChars = 0;
      /** Wire length (post-`transformPiece`) — the hard ceiling only, independent of the content budget above. */
      let currentWireChars = 0;
      const resultPromises: Array<Promise<PieceSettlement>> = [];
      // Filled in as each `resultPromises[i]` settles (see below) and returned as-is.
      const outcomes: PieceOutcome[] = new Array(pieces.length);

      for (const piece of pieces) {
        const wireText = options.callbacks.transformPiece(piece);
        const dedupeKey = `${sourceLanguage}>${targetLanguage}:${wireText}`;

        const existing = inFlightByKey.get(dedupeKey);
        if (existing) {
          resultPromises.push(existing);
          continue;
        }

        let resolveFn!: (settlement: PieceSettlement) => void;
        const promise = new Promise<PieceSettlement>((resolve) => {
          resolveFn = (settlement) => {
            // Once the window is over threshold, a suspicious result is
            // reported as `'untranslated'`, a provider failure (likely a broken key).
            const wasSuspicious = !settlement.ok && settlement.error.kind === 'suspicious';
            const overThreshold = recordSuspiciousSample(wasSuspicious);
            resolve(
              wasSuspicious && overThreshold
                ? err({ kind: 'untranslated', message: `${label} kept sending text back untranslated` })
                : settlement,
            );
          };
        });
        inFlightByKey.set(dedupeKey, promise);
        promise.finally(() => {
          if (inFlightByKey.get(dedupeKey) === promise) inFlightByKey.delete(dedupeKey);
        });
        resultPromises.push(promise);

        const pending: PendingRequest = { wireText, originalText: piece.join(''), resolve: resolveFn };
        currentBatch.push(pending);
        // Content against the content budget, wire against the hard ceiling;
        // whichever trips first closes the batch.
        currentChars += pending.originalText.length;
        currentWireChars += wireText.length;
        if (
          currentChars > maxBatchChars ||
          currentWireChars > HARD_MAX_WIRE_CHARS ||
          (options.maxBatchPieces !== undefined && currentBatch.length >= options.maxBatchPieces)
        ) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
          currentWireChars = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      // Each piece resolves as soon as its own sub-batch is parsed; attaching
      // the transform here delivers `onPieceComplete` per piece instead of
      // holding every piece until the slowest settles.
      resultPromises.forEach((resultPromise, idx) => {
        resultPromise.then((settlement) => {
          const piece = pieces[idx];
          const outcome: PieceOutcome = !piece
            ? err({ kind: 'badResponse', message: 'internal: piece/result index mismatch' })
            : settlement.ok
              ? ok(options.callbacks.splitPieceResponse(settlement.value.text))
              : settlement;
          outcomes[idx] = outcome;
          onPieceComplete?.(idx, outcome);
        });
      });

      options.onBatchStart?.();
      try {
        await Promise.all(
          batches.map((batch) =>
            concurrencyGate.run(() =>
              handleBatch(sourceLanguage, targetLanguage, batch, false, undefined, suspiciousRetrySourceLanguage),
            ),
          ),
        );

        // Outcomes are already computed; this only waits for all to settle.
        await Promise.all(resultPromises);
        return outcomes;
      } finally {
        options.onBatchEnd?.();
      }
    },
  };
}
