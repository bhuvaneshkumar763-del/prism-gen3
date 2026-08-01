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
