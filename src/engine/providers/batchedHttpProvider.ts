import { err, ok } from '../../shared/result';
import { connectivity } from '../connectivity';
import { getAdaptiveConcurrency } from '../networkQuality';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../translator';
import { isSuspiciousOutcome } from './outputSanityCheck';

/**
 * Shared machinery every HTTP-based translation provider composes (Gen 3
 * plan, Session 4): request-level dedupe, a soft per-request char budget so
 * many small pieces get bundled into few HTTP calls, retry-with-backoff
 * honoring `Retry-After`, a concurrency cap, and a "short response" repair
 * pass. This is the old repo's `Service` base class, kept because the
 * design is real, hard-won engineering (see each option's doc comment for
 * the specific problem it solves) — rebuilt fresh here, and importantly
 * kept `fetch`-based and free of any `chrome`/`browser` API so it can live
 * in `src/engine/` at all (the old repo's equivalent used an XHR shim
 * because MV3 service workers lack real XHR — `fetch` doesn't have that
 * problem, so no shim is needed here).
 *
 * The two-level structure: `pieces` (each is 1+ related strings, e.g.
 * grouped DOM siblings) are wire-transformed individually by
 * `transformPiece`, then MULTIPLE pieces get bundled into one HTTP request
 * up to `maxBatchChars`, and `getRequestBody`/`getQueryString` receive the
 * whole bundle of already-transformed piece strings to build one wire
 * request. `parseResponse` maps the raw response back to one raw string
 * per piece (in request order), and `splitPieceResponse` decodes each
 * piece's raw string back into its original N-string shape.
 */

export interface BatchedProviderCallbacks {
  transformPiece(strings: string[]): string;
  /** Given the raw parsed response body and how many pieces were sent, return one outcome per piece (null = missing). */
  parseResponse(response: unknown, pieceCount: number): Array<{ text: string; detectedLanguage: string | null } | null>;
  splitPieceResponse(raw: string, dontSortResults: boolean): string[];
  /** `pieceWireTexts` is included for GET-based providers (e.g. Yandex) that encode the whole batch in the query string rather than a request body. */
  getQueryString?(sourceLanguage: string, targetLanguage: string, pieceWireTexts: string[]): string;
  getRequestBody?(sourceLanguage: string, targetLanguage: string, pieceWireTexts: string[]): string | undefined;
  getExtraHeaders?(): Array<{ name: string; value: string }>;
}

export interface BatchedProviderOptions {
  name: string;
  baseUrl: string;
  method: 'GET' | 'POST';
  callbacks: BatchedProviderCallbacks;
  /**
   * Soft per-HTTP-request character budget across bundled pieces.
   *
   * Raised from 800 to 2000 (speed audit, found via direct measurement
   * against the live endpoint): per-request overhead dominates at 800 —
   * 300 short pieces at ~800 chars/request took 674ms end-to-end vs 107ms
   * bundled at ~6000 chars/request, and positional array alignment stayed
   * EXACT at up to 300 pieces sharing one request (0 misaligned at 40, 120,
   * and 300 pieces/request, measured directly). That means the stated
   * rationale for keeping this small — "fewer unrelated pieces sharing a
   * request means less for Google's endpoint to misalign" — doesn't
   * actually hold: the real misalignment risk this project has hit before
   * (tag-cluster scrambling) is the `<a i=N>` reflow WITHIN a single piece,
   * independent of how many pieces share a request, and is already handled
   * separately (tag-cluster isolation, single-item padding — see
   * google.ts).
   *
   * 2000 rather than the full ~6000 tested: still a real, measurable win
   * (fewer requests per page) while staying well short of the largest
   * value exercised, and — matching this project's own established
   * caution here, this exact constant has a real prior incident (beta.22)
   * — verified end-to-end against a real large live page (not just
   * synthetic sentences) before shipping, not just via the unit tests
   * below.
   *
   * 800 previously matched TWP's real upstream value; TWP's own tuning
   * doesn't bind this fork once measurement says otherwise.
   */
  maxBatchChars?: number;
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
}

interface RetryableError extends Error {
  retryAfterMs?: number;
}

/**
 * A 4xx other than 429 (a bad/expired API key, a malformed request) is
 * permanent — retrying it wastes the full retry budget (up to ~30s)
 * confirming the same failure three times before surfacing an error the
 * first attempt already proved. Real bug: `sendWithRetry`'s catch didn't
 * distinguish this from a transient network/5xx/429 failure at all, so it
 * retried everything uniformly.
 */
class NonRetryableHttpError extends Error {}

interface PendingRequest {
  wireText: string;
  /**
   * The piece's ORIGINAL strings joined — i.e. pre-`transformPiece`, with no
   * wire-format wrapper or HTML escaping. `isSuspiciousOutcome` compares
   * against this, not `wireText`: comparing a wrapped request against an
   * unwrapped response can never match, which silently disabled the
   * echoed-back-untranslated check for any provider whose `transformPiece`
   * adds a wrapper (Google wraps every piece in `<pre>`, so the check was
   * inert there specifically — see google.ts's `transformPiece`).
   */
  originalText: string;
  resolve(result: { text: string; detectedLanguage: string | null } | null): void;
}

const DEFAULT_MAX_BATCH_CHARS = 2000;
const DEFAULT_MAX_CONCURRENT = 6;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
// REQUEST_TIMEOUT_MS x MAX_ATTEMPTS (plus inter-attempt delays) is a ~62s
// worst case with no cap — translationRoutine awaits one sendWithRetry()
// call synchronously, so a provider that's merely slow (not down; a 5xx/429
// with no Retry-After) could leave the page visibly untranslated for a full
// minute with no error. This bounds the WHOLE retry sequence, not any single
// attempt: the first attempt still gets a real shot even against a fresh
// REQUEST_TIMEOUT_MS-scale hang, but later attempts get whatever's left of
// the budget, not a fresh timeout each time.
const OVERALL_DEADLINE_MS = 30000;

/**
 * Runs `worker` over `items` with at most `getLimit()` concurrently in
 * flight. Factored out (found via a speed/reliability audit) so the
 * top-level batch dispatch loop and the individual-piece repair retry
 * share ONE concurrency gate instead of the repair path bypassing it
 * entirely via a bare `Promise.all` — a batch-wide echo/truncation
 * failure used to fan out into dozens of simultaneous uncounted requests,
 * exactly the rate-limiter stampede a concurrency cap exists to prevent,
 * and exactly when the endpoint is already struggling. `getLimit` is
 * polled fresh on every dispatch, not read once, so a connection-quality
 * change mid-run is picked up without restarting (matches the adaptive
 * behavior the top-level loop already had).
 */
async function runWithConcurrencyLimit<T>(
  items: T[],
  getLimit: () => number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  let inFlight = 0;
  await new Promise<void>((resolveAll) => {
    let completed = 0;
    const pump = () => {
      const limit = getLimit();
      while (inFlight < limit && cursor < items.length) {
        const item = items[cursor++];
        if (item === undefined) continue;
        inFlight++;
        worker(item).then(() => {
          inFlight--;
          completed++;
          if (completed === items.length) resolveAll();
          else pump();
        });
      }
    };
    pump();
  });
}

export function createBatchedHttpProvider(options: BatchedProviderOptions): Translator {
  const maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const configuredMaxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  /** In-flight dedupe: two identical concurrent piece requests share one HTTP call's result. */
  const inFlightByKey = new Map<string, Promise<{ text: string; detectedLanguage: string | null } | null>>();

  async function sendOnce(
    sourceLanguage: string,
    targetLanguage: string,
    pieceWireTexts: string[],
    timeoutMs: number,
  ): Promise<unknown> {
    const query = options.callbacks.getQueryString?.(sourceLanguage, targetLanguage, pieceWireTexts) ?? '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(options.baseUrl + query, {
        method: options.method,
        headers: Object.fromEntries((options.callbacks.getExtraHeaders?.() ?? []).map((h) => [h.name, h.value])),
        body:
          options.method === 'GET'
            ? undefined
            : options.callbacks.getRequestBody?.(sourceLanguage, targetLanguage, pieceWireTexts),
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        const retryableError: RetryableError = new Error(`HTTP ${response.status}`);
        const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
        if (retryAfter > 0) retryableError.retryAfterMs = Math.min(6000, retryAfter * 1000);
        throw retryableError;
      }
      if (!response.ok) {
        throw new NonRetryableHttpError(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendWithRetry(
    sourceLanguage: string,
    targetLanguage: string,
    pieceWireTexts: string[],
    // Speed/reliability fix, found via audit: the individual-piece repair
    // path below used to call this with no deadline, so it computed its
    // OWN fresh `OVERALL_DEADLINE_MS` budget — meaning a `handleBatch()`
    // whose response came back with a couple of missing/suspicious pieces
    // could genuinely run for ~60s (the original batch's ~30s PLUS a
    // fresh ~30s for the repair retry), double what this constant's own
    // doc comment above says it bounds. Threading the PARENT's absolute
    // deadline down here means a repair retry gets whatever's left of the
    // SAME budget, not a second one — this parameter is only ever unset at
    // the true top level, where a fresh deadline is exactly correct.
    inheritedDeadline?: number,
  ): Promise<unknown> {
    const deadline = inheritedDeadline ?? Date.now() + OVERALL_DEADLINE_MS;
    let lastError: RetryableError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        // Offline: the browser has no route to anywhere, so every remaining
        // attempt is guaranteed to fail the same way sendOnce() would find
        // out anyway — skip straight to giving up instead of burning the
        // rest of the retry budget sleeping between doomed requests.
        // navigator.onLine has known false positives (a captive portal),
        // which is exactly why this only short-circuits the *retry* loop,
        // not the very first attempt — a false "online" or an offline
        // flip mid-request still goes through the normal sendOnce()/catch
        // path below and reports a real error, same as before this change.
        if (!connectivity.isOnline()) break;

        let delay = attempt === 1 ? 400 : 1200;
        if (lastError?.retryAfterMs && lastError.retryAfterMs > delay) {
          // A server-specified Retry-After is exact, not jittered — the
          // endpoint told us how long to wait, second-guessing it with
          // randomness serves no purpose.
          delay = lastError.retryAfterMs;
        } else {
          // ±25% jitter on the fixed delays: with maxConcurrent=6, many
          // pieces failing together against a real provider outage used to
          // retry in lockstep at the exact same two offsets, producing
          // synchronized request waves against an already-struggling
          // endpoint. Jitter desyncs those waves.
          delay = delay * 0.75 + Math.random() * delay * 0.5;
        }
        // Never sleep past the overall deadline — a Retry-After longer than
        // what's left of the budget is a sign this attempt sequence should
        // end, not extend indefinitely.
        delay = Math.min(delay, deadline - Date.now());
        if (delay <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        return await sendOnce(sourceLanguage, targetLanguage, pieceWireTexts, Math.min(REQUEST_TIMEOUT_MS, remaining));
      } catch (e) {
        if (e instanceof NonRetryableHttpError) throw e;
        lastError = e as RetryableError;
      }
    }
    throw lastError;
  }

  /**
   * "Checking": a batch response can come back with fewer entries than
   * pieces sent (a real risk for an LLM provider — truncation/malformed
   * JSON — much rarer but still possible for a plain MT endpoint). Rather
   * than failing the whole batch, retry just the missing pieces
   * individually once before marking them as errors.
   */
  async function handleBatch(
    sourceLanguage: string,
    targetLanguage: string,
    pending: PendingRequest[],
    isIndividualRetry = false,
    // Absolute deadline (ms since epoch), threaded down from the top-level
    // call and reused as-is by the repair retry below — see
    // `sendWithRetry`'s `inheritedDeadline` doc comment for why.
    deadline: number = Date.now() + OVERALL_DEADLINE_MS,
  ): Promise<void> {
    try {
      const response = await sendWithRetry(
        sourceLanguage,
        targetLanguage,
        pending.map((p) => p.wireText),
        deadline,
      );
      const results = options.callbacks.parseResponse(response, pending.length);
      const missing: PendingRequest[] = [];

      pending.forEach((p, idx) => {
        const result = results[idx];
        if (!result) {
          missing.push(p);
          return;
        }
        // Decode the wire response back to plain text before the sanity
        // check, so the comparison is original-vs-translation rather than
        // wrapped-request-vs-unwrapped-response (see PendingRequest.originalText).
        const decoded = options.callbacks.splitPieceResponse(result.text, false).join('');
        if (isSuspiciousOutcome(p.originalText, { ...result, text: decoded }, sourceLanguage, targetLanguage)) {
          missing.push(p);
          return;
        }
        p.resolve(result);
      });

      if (missing.length === 0) return;
      if (isIndividualRetry) {
        missing.forEach((p) => {
          p.resolve(null);
        });
        return;
      }
      // Speed fix, found via audit: this used to be a bare
      // `Promise.all(missing.map(...))`, firing one HTTP request per
      // missing/suspicious piece all at once — completely invisible to
      // `pump()`'s `inFlight` accounting below, which only ever counts
      // TOP-LEVEL batches. A batch-wide echo/truncation failure (Google's
      // documented silent-echo mode, or an LLM response short a few
      // entries) could turn one counted "slot" into dozens of uncounted
      // concurrent requests — precisely the rate-limiter stampede
      // `maxConcurrent` exists to prevent, and precisely when the
      // endpoint is already struggling. `runWithConcurrencyLimit` applies
      // the SAME adaptive limit real top-level batches respect.
      await runWithConcurrencyLimit(
        missing,
        () => getAdaptiveConcurrency(configuredMaxConcurrent),
        (p) => handleBatch(sourceLanguage, targetLanguage, [p], true, deadline),
      );
    } catch (e) {
      console.error(`[${options.name}] translation request failed`, e);
      pending.forEach((p) => {
        p.resolve(null);
      });
    }
  }

  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const { sourceLanguage, targetLanguage, pieces, dontSortResults = false, onPieceComplete } = request;

      // Bundle pieces into HTTP-request-sized batches, sharing in-flight
      // requests for identical (already-transformed) piece text.
      const batches: PendingRequest[][] = [];
      let currentBatch: PendingRequest[] = [];
      let currentChars = 0;
      const resultPromises: Array<Promise<{ text: string; detectedLanguage: string | null } | null>> = [];
      // Populated by the same per-piece transform as the return statement
      // below — computed eagerly, as each `resultPromises[i]` settles
      // (see the `.forEach` right after this loop), instead of only once
      // every piece in the whole call has settled. Returning this array
      // at the end (rather than re-deriving it from `resultPromises` again)
      // means the eager computation isn't wasted duplicate work.
      const outcomes: PieceOutcome[] = new Array(pieces.length);

      for (const piece of pieces) {
        const wireText = options.callbacks.transformPiece(piece);
        const dedupeKey = `${sourceLanguage}>${targetLanguage}:${wireText}`;

        const existing = inFlightByKey.get(dedupeKey);
        if (existing) {
          resultPromises.push(existing);
          continue;
        }

        let resolveFn!: (result: { text: string; detectedLanguage: string | null } | null) => void;
        const promise = new Promise<{ text: string; detectedLanguage: string | null } | null>((resolve) => {
          resolveFn = resolve;
        });
        inFlightByKey.set(dedupeKey, promise);
        promise.finally(() => {
          if (inFlightByKey.get(dedupeKey) === promise) inFlightByKey.delete(dedupeKey);
        });
        resultPromises.push(promise);

        const pending: PendingRequest = { wireText, originalText: piece.join(''), resolve: resolveFn };
        currentBatch.push(pending);
        currentChars += wireText.length;
        if (currentChars > maxBatchChars) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      // Each `resultPromises[idx]` already resolves independently, as soon
      // as ITS OWN underlying sub-batch's HTTP response is parsed (see
      // `handleBatch`'s `p.resolve(result)`) — not when every sub-batch in
      // this whole call finishes. Attaching the per-piece transform here,
      // rather than only in the `Promise.all(resultPromises)` block below,
      // is what actually delivers that per-piece timing to the caller via
      // `onPieceComplete`, instead of uniformly holding every piece back
      // until the slowest one settles.
      resultPromises.forEach((resultPromise, idx) => {
        resultPromise.then((result) => {
          const piece = pieces[idx];
          const outcome: PieceOutcome = !piece
            ? err({ kind: 'parse', message: 'internal: piece/result index mismatch' })
            : !result
              ? err({ kind: 'network', message: `[${options.name}] no result for this piece` })
              : ok(options.callbacks.splitPieceResponse(result.text, dontSortResults));
          outcomes[idx] = outcome;
          onPieceComplete?.(idx, outcome);
        });
      });

      options.onBatchStart?.();
      try {
        // Resolved fresh on every dispatch inside runWithConcurrencyLimit,
        // not captured once — a long page's connection quality can change
        // mid-batch (e.g. a real network degradation partway through 500
        // paragraphs), and this picks that up without restarting.
        await runWithConcurrencyLimit(
          batches,
          () => getAdaptiveConcurrency(configuredMaxConcurrent),
          (batch) => handleBatch(sourceLanguage, targetLanguage, batch),
        );

        // Every entry was already computed the instant its own
        // `resultPromises[idx]` settled (see above) — this await is only
        // to know that ALL of them have, not to (re-)compute anything.
        await Promise.all(resultPromises);
        return outcomes;
      } finally {
        options.onBatchEnd?.();
      }
    },
  };
}
