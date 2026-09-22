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
  /**
   * Reliability fix, found via a live incident: a genuine non-retryable
   * HTTP status (a real 401/403, not the 429/5xx `sendOnce` already
   * retries) used to be swallowed entirely inside `handleBatch`'s catch
   * block, with no way for the provider that supplied the credential to
   * react — a rejected/rotated key kept being resent for the rest of
   * whatever cache window the provider used. Fired from `sendOnce` the
   * instant `!response.ok` is detected, before the error is thrown, so a
   * provider like `google.ts` can invalidate its cached auth key
   * immediately instead of waiting out its own cache timer.
   */
  onNonRetryableStatus?(status: number): void;
  /**
   * Reliability fix, found via a live incident: a real, live-reproduced
   * case where the provider's auth was silently broken and every piece
   * came back looking like a legitimate "already in the target language"
   * echo (`kind: 'suspicious'`) — by design, correct for a genuinely
   * untranslatable piece, but indistinguishable from a fully-broken
   * provider when every single piece is affected. Fired once, edge-
   * triggered, the moment a rolling window of the last
   * `SUSPICIOUS_WINDOW_SIZE` piece classifications crosses
   * `SUSPICIOUS_RATIO_THRESHOLD` — lets a provider force an immediate
   * credential refresh so the very next tick has a real chance to
   * self-heal, rather than only reporting the problem after the fact.
   */
  onSuspiciousStreak?(): void;
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
  /**
   * `wasSuspicious` (added via a reliability audit): true when a null
   * `result` means "confirmed suspicious after a repair retry, not a real
   * network/HTTP failure" — see `translator.ts`'s `'suspicious'` error
   * kind doc comment for why this distinction matters. Only meaningful
   * when `result` is null; ignored otherwise.
   */
  resolve(result: { text: string; detectedLanguage: string | null } | null, wasSuspicious?: boolean): void;
}

const DEFAULT_MAX_BATCH_CHARS = 2000;
/**
 * Speed fix, found via measuring the actual delta between beta.27 and the
 * next release (this file's own git history) after a live user report:
 * `maxBatchChars` is documented (see its own doc comment above) as a
 * CONTENT budget — "how much of the page's own text goes in one request" —
 * but the batching loop below used to charge it against `wireText.length`,
 * the POST-`transformPiece` string. For a provider whose wrapper is
 * non-trivial (Google's `<pre><a i=N>text</a></pre>` per single-node
 * piece), that's `content.length + 34` for the common single-node-piece
 * case — pure markup ceremony eating the same budget meant for content, so
 * a page of many short pieces (a novel chapter's dialogue lines, a nav
 * list) filled each request with FEWER real pieces than the budget's own
 * name promises, and paid for several times more HTTP requests as a result
 * (measured: 8 requests vs 3 for 300 pieces of ~19 chars — see this file's
 * own chapter-shaped test).
 * Now budgeted on content length (`pending.originalText.length`, the same
 * pre-`transformPiece` string `isSuspiciousOutcome` already compares
 * against) instead, restoring what a typical short-piece page's actual
 * request density looked like before that wrapper existed.
 *
 * A CONTENT budget alone isn't a complete substitute for the old WIRE
 * budget, though: a batch built entirely from a handful of unusually LONG
 * pieces could now produce a wire payload past what's actually been
 * measured safe (see `maxBatchChars`'s own doc comment: ~6000 wire
 * chars/request was the largest size directly verified against the live
 * endpoint with 0 positional misalignment at up to 300 pieces). This is
 * that same already-measured figure, kept as a hard ceiling alongside the
 * content budget — whichever trips first closes the batch — so a request's
 * wire size can never exceed what's actually been verified safe, while the
 * common short-piece case is no longer artificially split by markup that
 * was never part of what `maxBatchChars` was meant to bound.
 */
const HARD_MAX_WIRE_CHARS = 6000;
const DEFAULT_MAX_CONCURRENT = 6;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
// Reliability fix, found via a live incident (see onSuspiciousStreak's doc
// comment above): deliberately conservative pending real live tuning.
// Legitimate suspicious content (a same-language endonym, a handful of
// numbers/proper nouns) clusters in small groups within otherwise-normal
// translated prose — it does not plausibly make up 27+ of 30 consecutive
// pieces across a real page, so a large window and a high threshold keep
// this from ever firing on a genuinely healthy, if unusual, page.
const SUSPICIOUS_WINDOW_SIZE = 30;
const SUSPICIOUS_RATIO_THRESHOLD = 0.9;
// REQUEST_TIMEOUT_MS x MAX_ATTEMPTS (plus inter-attempt delays) is a ~62s
// worst case with no cap — translationRoutine awaits one sendWithRetry()
// call synchronously, so a provider that's merely slow (not down; a 5xx/429
// with no Retry-After) could leave the page visibly untranslated for a full
// minute with no error. This bounds the WHOLE retry sequence, not any single
// attempt: the first attempt still gets a real shot even against a fresh
// REQUEST_TIMEOUT_MS-scale hang, but later attempts get whatever's left of
// the budget, not a fresh timeout each time.
const OVERALL_DEADLINE_MS = 30000;

interface ConcurrencyGate {
  run<T>(worker: () => Promise<T>): Promise<T>;
}

/**
 * A shared semaphore gating at most `getLimit()` concurrently in-flight
 * tasks. `getLimit` is polled fresh on every dispatch, not read once, so a
 * connection-quality change mid-run is picked up without restarting
 * (matches the adaptive behavior this always had).
 *
 * Speed fix, found via a round-4 audit: this used to be a plain function
 * (`runWithConcurrencyLimit`) that created a FRESH `inFlight` counter on
 * every call, so the top-level batch dispatch loop and the individual-
 * piece repair retry — despite intending to share one cap — each got
 * their OWN independent budget for the SAME `translateBatch()` call. Worse,
 * `createProvider()`'s result is a singleton memoized for the whole
 * service-worker lifetime (see `background.ts`'s `cachedProvider` comment,
 * which already documented the INTENT that `maxConcurrent` lives at the
 * provider level — the actual counter just never did): the main
 * translate tick, `attributeTranslator.ts`, and `titleTranslator.ts` all
 * share that one provider instance, but each of their own
 * `translateBatch()` calls also got an independent local counter. Clicking
 * Translate on a long page could open 6 (main tick) + 6
 * (`attributeTranslator`) + 1 (`titleTranslator`) = 13 simultaneous
 * requests against a `maxConcurrent` of 6, against a free endpoint that
 * rate-limits by IP. Fixed by hoisting ONE gate into
 * `createBatchedHttpProvider`'s closure (alongside `inFlightByKey`) so
 * every caller — both call sites below, and every separate
 * `translateBatch()` invocation sharing this provider instance — draws
 * from the same budget.
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

  // Provider-level (not per-`translateBatch()` call) — see
  // `createConcurrencyGate`'s doc comment for the real bug this closes:
  // both call sites below (the top-level batch dispatch and the
  // individual-piece repair retry), and every separate `translateBatch()`
  // call sharing this one cached provider instance (the main tick,
  // `attributeTranslator.ts`, `titleTranslator.ts`), now draw from ONE
  // shared concurrency budget instead of each getting their own.
  const concurrencyGate = createConcurrencyGate(() => getAdaptiveConcurrency(configuredMaxConcurrent));

  /** In-flight dedupe: two identical concurrent piece requests share one HTTP call's result. */
  const inFlightByKey = new Map<string, Promise<{ text: string; detectedLanguage: string | null } | null>>();
  // Provider-level (not per-`translateBatch()` call), for the same reason
  // `inFlightByKey` is: a piece deduped into an ALREADY-in-flight promise
  // from a separate `translateBatch()` call needs to find the SAME
  // WeakSet the original call's `resolveFn` added that promise to — a
  // WeakSet scoped inside `translateBatch()` would be empty for every
  // caller except the one that happened to own the original request,
  // silently defaulting every deduped-in caller back to the network-error
  // kind. Keyed by the shared result PROMISE, not by index or
  // PendingRequest, so this works regardless of which call's index the
  // promise ends up at.
  const suspiciousPromises = new WeakSet<Promise<{ text: string; detectedLanguage: string | null } | null>>();

  // Provider-level (not per-`translateBatch()` call) rolling window of the
  // last SUSPICIOUS_WINDOW_SIZE piece-level classifications — same scope
  // as `inFlightByKey`/`suspiciousPromises` above, and for the same
  // reason: the auth key this ratio is meant to protect is a provider-wide
  // resource, shared across every tab/page using this one cached provider
  // instance, not something scoped to a single page's translateBatch()
  // call. `suspiciousStreakActive` edge-triggers `onSuspiciousStreak` once
  // per crossing rather than firing it again for every piece while the
  // ratio stays over threshold.
  const suspiciousWindow: boolean[] = [];
  let suspiciousStreakActive = false;

  /**
   * Records one piece's final suspicious/not classification into the
   * rolling window and returns whether the ratio is (now) over threshold.
   * Called from `resolveFn` below — the single choke point every piece's
   * FINAL settlement funnels through, whether it resolved on the first
   * attempt or only after `handleBatch`'s individual-piece repair retry.
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
    const query = options.callbacks.getQueryString?.(sourceLanguage, targetLanguage, pieceWireTexts) ?? '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Hygiene fix, found via a round-6 audit: the backstop's own timer
    // (below) was never cleared, leaving one armed for `timeoutMs + 500`
    // past every request that settled normally — harmless (its reject()
    // call lands on an already-settled Promise.race, a no-op), but untidy
    // and unnecessary now that its handle is captured here.
    let backstopTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Reliability fix, found via a live user report (spinning forever,
      // permanently, after exactly one successful translate — reproduced
      // on sangtacviet.vip in Orion/iOS): this used to just `await
      // fetch(...)`/`response.json()` directly, trusting `controller.abort()`
      // to make that reject once `timeoutMs` elapsed. WebKit (Orion's and
      // iOS Safari's engine) has real-world cases where aborting a fetch
      // doesn't reliably reject it once response headers have already
      // arrived and the body is still being read — exactly the shape of a
      // large JSON response from a text-dense page. If that happens, this
      // function never settles, which means `handleBatch`'s wrapping
      // `concurrencyGate.run(...)` call never settles either, which means
      // that permit is never returned to the gate (see
      // `createConcurrencyGate`'s doc comment: `inFlight` only decrements
      // inside `worker().then(...)`) — and since the gate is a shared
      // singleton living for the whole background-context lifetime, that
      // permit is gone forever, eventually exhausting all of
      // `DEFAULT_MAX_CONCURRENT` and making every future translate hang.
      // Racing against a plain `setTimeout`-based rejection that doesn't
      // depend on `AbortController`/`fetch` cooperating at all guarantees
      // this function — and therefore the gate permit it holds — always
      // settles by `timeoutMs`, regardless of what the platform's
      // fetch/abort implementation actually does. The `+500` gives the
      // normal abort path (which already produces a real HTTP/network
      // error, more informative than this generic one) a head start, so
      // this backstop only fires when that path has genuinely failed to
      // settle at all.
      return await Promise.race([
        (async () => {
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
            options.onNonRetryableStatus?.(response.status);
            throw new NonRetryableHttpError(`HTTP ${response.status}`);
          }
          return await response.json();
        })(),
        new Promise<never>((_, reject) => {
          backstopTimeout = setTimeout(() => reject(new Error('Request timed out (backstop)')), timeoutMs + 500);
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
      const results = options.callbacks.parseResponse(response, pending.length);
      const missing: PendingRequest[] = [];
      // Tracks WHICH of `missing`'s entries got there via the sanity check
      // (a real 200 OK that just looked like a silent echo) rather than
      // `!result` (no data at all for this piece — closer to a real
      // network/parse failure). Only meaningful once a repair retry is
      // ALSO exhausted (see the `isIndividualRetry` branch below) — see
      // `translator.ts`'s `'suspicious'` error kind for why this
      // distinction is threaded all the way out to the caller.
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
        const decoded = options.callbacks.splitPieceResponse(result.text, false).join('');
        if (isSuspiciousOutcome(p.originalText, { ...result, text: decoded }, sourceLanguage, targetLanguage)) {
          missing.push(p);
          missingBecauseSuspicious.add(p);
          return;
        }
        p.resolve(result);
      });

      if (missing.length === 0) return;
      if (isIndividualRetry) {
        missing.forEach((p) => {
          p.resolve(null, missingBecauseSuspicious.has(p));
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
      //
      // Reliability fix, found via a live-page audit and reproduced
      // directly against a real, logged-in X.com/Twitter account: a piece
      // flagged suspicious (see `isSuspiciousOutcome`'s script-mismatch
      // check) is real evidence that the CALLER'S declared `sourceLanguage`
      // is wrong for this specific piece, not just that the provider had a
      // blip — translateLoop.ts's `getSourceLanguage()` reports one
      // language for the whole page, but a genuinely multi-language page
      // (a social feed, a forum, a comment section) can have individual
      // pieces in a different language than whatever the page-level
      // detector guessed. Retrying with that SAME wrong source (as this
      // used to do unconditionally) just reproduces the identical
      // silent-echo failure every time — Google, told the source IS the
      // target language, has nothing to translate and hands the input
      // straight back — so the piece stays suspicious forever and
      // (correctly, per the fix above this comment's era) is never retried
      // again, leaving it permanently untranslated with no error surfaced:
      // exactly "shows translated, does nothing" for that piece. A plain
      // missing piece (no data at all — truncation/parse failure) has no
      // such evidence about the source language being wrong, so it keeps
      // retrying with the ORIGINAL declared source, unchanged.
      //
      // Dispatched, NOT awaited — real deadlock this closed, found while
      // sharing one gate across both call sites (see createConcurrencyGate's
      // doc comment): THIS call is itself running inside a
      // `concurrencyGate.run(...)` slot from the top-level dispatch below.
      // Awaiting these child repairs here would hold that slot hostage
      // until every repair also finishes — which deadlocks outright once
      // the adaptive limit is low enough that no slot is ever free for a
      // child while its parent still occupies one (reproduces reliably at
      // limit=1, a real value `getAdaptiveConcurrency` returns on a
      // detected slow connection — exactly when a repair retry is also
      // more likely to be needed). This request already has its own
      // answer back by this point; each repair is dispatched as its own
      // independent, gate-managed unit of work instead. Nothing here
      // needs to wait for it: the piece's own promise (`resolveFn`, wired
      // up in `translateBatch`) is what the real caller awaits via
      // `resultPromises`, entirely independent of whether THIS
      // `handleBatch()` call's own returned promise has settled.
      // `handleBatch` never throws (its own catch block below resolves
      // pending pieces instead), so no unhandled rejection risk either.
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
      console.error(`[${options.name}] translation request failed`, e);
      pending.forEach((p) => {
        p.resolve(null);
      });
    }
  }

  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const {
        sourceLanguage,
        targetLanguage,
        pieces,
        dontSortResults = false,
        onPieceComplete,
        suspiciousRetrySourceLanguage,
      } = request;

      // Bundle pieces into HTTP-request-sized batches, sharing in-flight
      // requests for identical (already-transformed) piece text.
      const batches: PendingRequest[][] = [];
      let currentBatch: PendingRequest[] = [];
      /** Content length (pre-`transformPiece`) — what `maxBatchChars` actually budgets. See `HARD_MAX_WIRE_CHARS`'s own doc comment. */
      let currentChars = 0;
      /** Wire length (post-`transformPiece`) — the hard ceiling only, independent of the content budget above. */
      let currentWireChars = 0;
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

        let resolveFn!: (
          result: { text: string; detectedLanguage: string | null } | null,
          wasSuspicious?: boolean,
        ) => void;
        const promise = new Promise<{ text: string; detectedLanguage: string | null } | null>((resolve) => {
          resolveFn = (result, wasSuspicious) => {
            // Reliability fix, found via a live incident: recording every
            // piece's final classification here — success and genuine
            // failure count as `false`, a confirmed-suspicious result as
            // `true` — is what lets a sustained run of suspicious results
            // (the real live shape of a broken/rejected auth key: Google
            // silently echoing everything back rather than a clean HTTP
            // rejection) get reclassified as a genuine `'network'` failure
            // once it's overwhelmingly more likely to be provider breakage
            // than a page's content coincidentally matching its own target
            // language. Deliberately NOT added to `suspiciousPromises` in
            // that case, so the outcome-kind check below reports
            // `'network'` instead of `'suspicious'` — the only change
            // needed for `translateLoop.ts`'s existing failure-surfacing
            // logic to correctly start counting these as real failures.
            const overThreshold = recordSuspiciousSample(!!wasSuspicious);
            if (wasSuspicious && !overThreshold) suspiciousPromises.add(promise);
            resolve(result);
          };
        });
        inFlightByKey.set(dedupeKey, promise);
        promise.finally(() => {
          if (inFlightByKey.get(dedupeKey) === promise) inFlightByKey.delete(dedupeKey);
        });
        resultPromises.push(promise);

        const pending: PendingRequest = { wireText, originalText: piece.join(''), resolve: resolveFn };
        currentBatch.push(pending);
        // Content against the content budget, wire against the hard
        // ceiling — whichever trips first closes the batch. See
        // `HARD_MAX_WIRE_CHARS`'s doc comment for why these are two
        // separate bounds rather than one.
        currentChars += pending.originalText.length;
        currentWireChars += wireText.length;
        if (currentChars > maxBatchChars || currentWireChars > HARD_MAX_WIRE_CHARS) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
          currentWireChars = 0;
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
              ? err(
                  suspiciousPromises.has(resultPromise)
                    ? {
                        kind: 'suspicious',
                        message: `[${options.name}] result kept looking like a silent-echo failure after a repair retry`,
                      }
                    : { kind: 'network', message: `[${options.name}] no result for this piece` },
                )
              : ok(options.callbacks.splitPieceResponse(result.text, dontSortResults));
          outcomes[idx] = outcome;
          onPieceComplete?.(idx, outcome);
        });
      });

      options.onBatchStart?.();
      try {
        // concurrencyGate is shared with the individual-piece repair retry
        // above, and with every other translateBatch() call sharing this
        // provider instance — see createConcurrencyGate's doc comment.
        await Promise.all(
          batches.map((batch) =>
            concurrencyGate.run(() =>
              handleBatch(sourceLanguage, targetLanguage, batch, false, undefined, suspiciousRetrySourceLanguage),
            ),
          ),
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
