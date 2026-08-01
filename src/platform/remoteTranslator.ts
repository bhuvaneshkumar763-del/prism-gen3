import type { PieceOutcome, TranslateBatchRequest, Translator } from '../engine/translator';

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

export interface TranslatePiecesMessage extends TranslateBatchRequest {
  type: 'translatePieces';
}

export function isTranslatePiecesMessage(message: unknown): message is TranslatePiecesMessage {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'translatePieces';
}

export function createRemoteTranslator(): Translator {
  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const message: TranslatePiecesMessage = { type: 'translatePieces', ...request };
      const response = await browser.runtime.sendMessage(message);
      return response as PieceOutcome[];
    },
  };
}
