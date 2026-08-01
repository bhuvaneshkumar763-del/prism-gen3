import type { PieceOutcome, TranslateBatchRequest, Translator } from '../engine/translator';
import { sendMessage } from './messaging/protocol';

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
 */
export function createRemoteTranslator(): Translator {
  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      return sendMessage('translatePieces', request);
    },
  };
}
