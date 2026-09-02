import { err, ok, type Result } from '../shared/result';

/**
 * The core port every translation provider implements. Session 2 shipped a
 * deliberately minimal single-string version of this; Session 4 is where it
 * generalizes to real batching, exactly per the Gen 3 plan's guidance —
 * "if adding provider #6 needs touching shared internals, fix the
 * abstraction now while there are only ~5 implementations." This is
 * provider #2, so now is when the batch shape gets designed for real,
 * against Google/Bing/Yandex/LLM's actual (very different) wire formats,
 * not guessed at with only LibreTranslate as a data point.
 */

export type TranslateError = { kind: 'network' | 'http' | 'parse'; message: string };

/**
 * One unit of translation work. Usually a single string; more than one
 * when a piece is a group of related strings translated together for
 * shared context (e.g. sibling DOM text nodes under the same block
 * element — the old repo's `grouping.ts` concept, ported in a later
 * session once the page-translation engine exists). Every provider must
 * preserve the string count and order within a piece.
 */
export type TranslatePiece = string[];

export interface TranslateBatchRequest {
  sourceLanguage: string;
  targetLanguage: string;
  pieces: TranslatePiece[];
  /**
   * When true, don't reorder results to match request order — just return
   * them in whatever order the provider's response naturally gives (some
   * providers' index markers can drop/merge under real-world HTML, so
   * "trust response order" is sometimes the more correct choice for a
   * given piece of content). Ported concept from the old repo's
   * `dontSortResults`.
   */
  dontSortResults?: boolean;
  /**
   * Speed fix, found via audit: a batch of N pieces used to have every
   * translated piece withheld from the caller until the SLOWEST of the
   * batch's underlying HTTP sub-requests finished — so on a 300-node
   * article split into ~30 sub-batches at 6 concurrent, one sub-batch
   * stalling to its request timeout held back the other 29 (already
   * fully translated in memory) from ever reaching the DOM. Optional and
   * purely additive: a provider that supports incremental delivery
   * (`batchedHttpProvider`-based ones) calls this the instant each
   * individual piece's result is known, well before the overall
   * `translateBatch()` promise resolves; a caller that doesn't pass it
   * gets the exact same behavior as before. `translateBatch()`'s
   * returned array remains the single source of truth for bookkeeping
   * (retries, error surfacing, dedupe) — this is only a chance to write
   * a piece to the page sooner, never a replacement for awaiting the
   * final result.
   */
  onPieceComplete?(index: number, outcome: PieceOutcome): void;
}

/** Per-piece outcome: the translated strings (same length/order as the input piece), or an error if that piece failed. */
export type PieceOutcome = Result<string[], TranslateError>;

export interface Translator {
  translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]>;
}

/** Convenience wrapper for the common single-string case (e.g. a UI surface translating one selection). */
export async function translateOne(
  translator: Translator,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<Result<string, TranslateError>> {
  const outcomes = await translator.translateBatch({ sourceLanguage, targetLanguage, pieces: [[text]] });
  const outcome = outcomes[0];
  if (!outcome) return err({ kind: 'parse', message: 'provider returned no result' });
  if (!outcome.ok) return outcome;
  const [value] = outcome.value;
  if (value === undefined) return err({ kind: 'parse', message: 'provider returned an empty piece result' });
  return ok(value);
}
