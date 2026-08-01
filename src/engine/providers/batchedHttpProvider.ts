import { err, ok } from '../../shared/result';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../translator';

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
  /** Soft per-HTTP-request character budget across bundled pieces. Default 1100 — matches the old repo's tuning (bumped up from an original 800 for more context per request and fewer round trips). */
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

interface PendingRequest {
  wireText: string;
  stringCount: number;
  resolve(result: { text: string; detectedLanguage: string | null } | null): void;
}

const DEFAULT_MAX_BATCH_CHARS = 1100;
const DEFAULT_MAX_CONCURRENT = 6;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;

export function createBatchedHttpProvider(options: BatchedProviderOptions): Translator {
  const maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  /** In-flight dedupe: two identical concurrent piece requests share one HTTP call's result. */
  const inFlightByKey = new Map<string, Promise<{ text: string; detectedLanguage: string | null } | null>>();

  async function sendOnce(sourceLanguage: string, targetLanguage: string, pieceWireTexts: string[]): Promise<unknown> {
    const query = options.callbacks.getQueryString?.(sourceLanguage, targetLanguage, pieceWireTexts) ?? '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
        throw new Error(`HTTP ${response.status}`);
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
  ): Promise<unknown> {
    let lastError: RetryableError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        let delay = attempt === 1 ? 400 : 1200;
        if (lastError?.retryAfterMs && lastError.retryAfterMs > delay) delay = lastError.retryAfterMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      try {
        return await sendOnce(sourceLanguage, targetLanguage, pieceWireTexts);
      } catch (e) {
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
  ): Promise<void> {
    try {
      const response = await sendWithRetry(
        sourceLanguage,
        targetLanguage,
        pending.map((p) => p.wireText),
      );
      const results = options.callbacks.parseResponse(response, pending.length);
      const missing: PendingRequest[] = [];

      pending.forEach((p, idx) => {
        const result = results[idx];
        if (!result) {
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
      await Promise.all(missing.map((p) => handleBatch(sourceLanguage, targetLanguage, [p], true)));
    } catch (e) {
      console.error(`[${options.name}] translation request failed`, e);
      pending.forEach((p) => {
        p.resolve(null);
      });
    }
  }

  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const { sourceLanguage, targetLanguage, pieces, dontSortResults = false } = request;

      // Bundle pieces into HTTP-request-sized batches, sharing in-flight
      // requests for identical (already-transformed) piece text.
      const batches: PendingRequest[][] = [];
      let currentBatch: PendingRequest[] = [];
      let currentChars = 0;
      const resultPromises: Array<Promise<{ text: string; detectedLanguage: string | null } | null>> = [];

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

        const pending: PendingRequest = { wireText, stringCount: piece.length, resolve: resolveFn };
        currentBatch.push(pending);
        currentChars += wireText.length;
        if (currentChars > maxBatchChars) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      options.onBatchStart?.();
      try {
        if (batches.length > 0) {
          let cursor = 0;
          let inFlight = 0;
          await new Promise<void>((resolveAll) => {
            let completed = 0;
            const pump = () => {
              while (inFlight < maxConcurrent && cursor < batches.length) {
                const batch = batches[cursor++];
                if (!batch) continue;
                inFlight++;
                handleBatch(sourceLanguage, targetLanguage, batch).then(() => {
                  inFlight--;
                  completed++;
                  if (completed === batches.length) resolveAll();
                  else pump();
                });
              }
            };
            pump();
          });
        }

        const results = await Promise.all(resultPromises);
        return results.map((result, idx) => {
          const piece = pieces[idx];
          if (!piece) return err({ kind: 'parse', message: 'internal: piece/result index mismatch' });
          if (!result) return err({ kind: 'network', message: `[${options.name}] no result for this piece` });
          const strings = options.callbacks.splitPieceResponse(result.text, dontSortResults);
          return ok(strings);
        });
      } finally {
        options.onBatchEnd?.();
      }
    },
  };
}
