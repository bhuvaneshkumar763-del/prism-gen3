import type { PieceOutcome, TranslateBatchRequest, Translator } from '../engine/translator';
import { withTimeout } from '../shared/withTimeout';
import { onMessage, sendMessage } from './messaging/protocol';

/**
 * Implements the engine's `Translator` port by messaging the background
 * script (which holds the real provider, selected via
 * `registry.createProvider()` — see `entrypoints/background.ts`'s
 * `translatePieces` handler). This is the seam that lets
 * `src/engine/pageTranslator/translateLoop.ts` stay 100% engine-pure: it
 * only ever calls `translator.translateBatch(...)`, with zero awareness of
 * `browser.runtime` — this file is the one place that bridges the two.
 *
 * A future non-extension surface would supply a different `Translator`
 * here (e.g. one that calls a translation API directly) and reuse
 * `translateLoop.ts` unmodified.
 *
 * Reliability/speed fix, found via audit: `request.onPieceComplete` — the
 * callback beta.34 added so a page's translated text appears progressively
 * instead of only once a whole tick's `translateBatch()` call resolves —
 * is a function, and a function property cannot survive `chrome.runtime`'s
 * structured-clone message serialization. Passing `request` straight
 * through to `sendMessage()` silently dropped it, so incremental
 * write-back only ever worked in a unit test's in-process mock
 * `Translator`; the real extension always waited for the entire tick
 * regardless, exactly the behavior beta.34 was written to remove. Fixed by
 * stripping `onPieceComplete` out before sending, tagging the request with
 * a `requestId`, and relaying each piece's own completion back over a
 * dedicated `translatePiecesProgress` message (background → this frame)
 * the instant it resolves — background.ts wires this into the real
 * provider's own `onPieceComplete` (which already exists for exactly this
 * purpose; it previously had no consumer that could see it from here).
 *
 * The progress listener is registered ONCE at module scope, not per
 * `createRemoteTranslator()` call: `@webext-core/messaging` allows only
 * one listener per message type per JS context (confirmed by this file's
 * own test suite, which has to manually unsubscribe its `translatePieces`
 * mock between tests for the same reason) — content.ts only ever creates
 * one remote translator per real page load, but more than one could exist
 * in a single test file's lifetime. `requestId` is what lets a single
 * shared listener correctly route each incoming progress notification to
 * the right in-flight `translateBatch()` call, since the main tick,
 * `attributeTranslator.ts`, and `titleTranslator.ts` can all have their
 * own `translatePieces` request in flight from the same frame at once.
 */
const progressCallbacks = new Map<number, (index: number, outcome: PieceOutcome) => void>();
let progressListenerRegistered = false;
let nextRequestId = 0;

/**
 * Reliability fix, found via a real mobile bug report: the background's own
 * worst-case processing time for one `translatePieces` call is bounded
 * (`batchedHttpProvider.ts`'s retry loop tops out around ~62s), but the
 * round trip back across the messaging boundary to THIS call was not. If
 * the background service worker is torn down mid-request — the keepalive
 * alarm in `background.ts` defeats Chrome's own idle eviction, but not an
 * OS-level low-memory kill, which is a real risk on a constrained mobile
 * device and not something any extension API can prevent — its
 * `sendResponse` closure is gone, and this call would otherwise hang
 * forever: `working` stays true permanently, with no recovery short of
 * reloading the page. Timeout is the background's own worst case plus
 * generous margin for concurrency-queue wait, not a tight bound; a
 * rejection here is already handled the same as any other failed batch by
 * `translateLoop.ts`'s existing retry/error-surfacing logic.
 */
const TRANSLATE_PIECES_TIMEOUT_MS = 90000;

function ensureProgressListener(): void {
  if (progressListenerRegistered) return;
  progressListenerRegistered = true;
  onMessage('translatePiecesProgress', (message) => {
    const { requestId, index, outcome } = message.data;
    progressCallbacks.get(requestId)?.(index, outcome);
  });
}

export function createRemoteTranslator(): Translator {
  ensureProgressListener();
  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const { onPieceComplete, ...serializable } = request;
      const requestId = nextRequestId++;
      if (onPieceComplete) progressCallbacks.set(requestId, onPieceComplete);
      try {
        return await withTimeout(
          sendMessage('translatePieces', { ...serializable, requestId }),
          TRANSLATE_PIECES_TIMEOUT_MS,
        );
      } finally {
        progressCallbacks.delete(requestId);
      }
    },
  };
}
