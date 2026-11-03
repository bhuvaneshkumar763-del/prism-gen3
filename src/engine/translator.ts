import { err, ok, type Result } from '../shared/result';

/** The port every translation provider implements. */

/**
 * `'suspicious'`: the request succeeded but the response still looked like a
 * silent echo after a repair retry. Unlike `'network'`/`'http'` it isn't
 * evidence the provider is down, so callers shouldn't retry it forever (the
 * result may be legitimate, e.g. a proper noun). See translateLoop.ts.
 */
export type TranslateError = { kind: 'network' | 'http' | 'parse' | 'suspicious'; message: string };

/**
 * One unit of translation work: usually a single string, or a group of
 * related strings (e.g. sibling text nodes) sent together for context.
 * Providers must preserve the string count and order within a piece.
 */
export type TranslatePiece = string[];

export interface TranslateBatchRequest {
  sourceLanguage: string;
  targetLanguage: string;
  pieces: TranslatePiece[];
  /**
   * True when the user chose `sourceLanguage` (the bubble's From picker);
   * false/absent for the page-level guess. A provider may override a guess
   * with per-piece detection but must honour an explicit choice.
   */
  sourceLanguageIsExplicit?: boolean;
  /**
   * Provider-internal: the language to re-request a suspicious piece with.
   * Set by a provider that sends `'auto'`, so a silent echo falls back to the
   * page's guess instead of repeating the identical `'auto'` request.
   */
  suspiciousRetrySourceLanguage?: string;
  /**
   * When true, return results in the provider's response order instead of
   * reordering to request order (index markers can drop/merge under real HTML).
   */
  dontSortResults?: boolean;
  /**
   * Optional incremental delivery: called as soon as each piece's result is
   * known, so one slow sub-request doesn't hold back the rest. The returned
   * array stays the source of truth for bookkeeping (retries, errors).
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
