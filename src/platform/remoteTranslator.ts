import type { PieceOutcome, TranslateBatchRequest, Translator } from '../engine/translator';
import { withTimeout } from '../shared/withTimeout';
import { isTrustedSender, onMessage, sendMessage } from './messaging/protocol';

/**
 * Implements the engine's `Translator` port by messaging the background,
 * which holds the real provider; this keeps the engine free of browser APIs.
 *
 * `onPieceComplete` is a function and can't survive message serialization,
 * so it's stripped before sending; the background relays per-piece results
 * as `translatePiecesProgress` messages tagged with this call's `requestId`.
 * The progress listener is registered once at module scope because
 * `@webext-core/messaging` allows one listener per message type per context;
 * `requestId` routes each notification to the right in-flight call.
 */
const progressCallbacks = new Map<number, (index: number, outcome: PieceOutcome) => void>();
let progressListenerRegistered = false;
let nextRequestId = 0;

/**
 * Bounds the round trip so a service worker killed mid-request (e.g. an OS
 * low-memory kill) can't leave this call hanging forever. Generous on purpose:
 * one request can cover several batches queued behind the provider's shared
 * concurrency gate, each bounded at 30s. A timeout is handled like any failed batch.
 */
const TRANSLATE_PIECES_TIMEOUT_MS = 90000;

function ensureProgressListener(): void {
  if (progressListenerRegistered) return;
  progressListenerRegistered = true;
  onMessage('translatePiecesProgress', (message) => {
    // Defence in depth, as in every other handler: a matched requestId writes
    // text onto the page via onPieceComplete.
    if (!isTrustedSender(message.sender)) return;
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
