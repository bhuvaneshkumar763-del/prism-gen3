import { err, ok, type Result } from '../shared/result';

/** The port every translation provider implements. */

/**
 * Why a piece failed, set where the failure happens and carried unchanged to
 * the bubble (errorState.ts words it per kind). Never parse `message`.
 * - `network`: no answer at all (no connection, connection reset).
 * - `timeout`: no answer in time.
 * - `rateLimited`: HTTP 429 after every retry.
 * - `http`: another HTTP failure, a 5xx after every retry or a 4xx rejection.
 * - `auth`: the credential was rejected or is missing.
 * - `badResponse`: an answer Prism can't read (bad JSON, changed shape, a missing piece).
 * - `suspicious`: a 200 that still looked like a silent echo after a repair
 *   retry. Not evidence the provider is down (it may be a proper noun), so
 *   callers shouldn't retry it forever.
 * - `untranslated`: suspicious results across most of the page, which is
 *   treated as a provider failure.
 * - `notConfigured`: the chosen provider isn't set up.
 */
export type TranslateErrorKind =
  | 'network'
  | 'timeout'
  | 'rateLimited'
  | 'http'
  | 'auth'
  | 'badResponse'
  | 'suspicious'
  | 'untranslated'
  | 'notConfigured';

export interface TranslateError {
  kind: TranslateErrorKind;
  /** Diagnostic text for logs and for surfaces that show the provider's own words (selection popup, Settings test). */
  message: string;
  /** The HTTP status, when the service answered with one. */
  status?: number;
  /** The service's own explanation of a rejection, when it gave a usable one. */
  reason?: string;
}

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
  if (!outcome) return err({ kind: 'badResponse', message: 'provider returned no result' });
  if (!outcome.ok) return outcome;
  const [value] = outcome.value;
  if (value === undefined) return err({ kind: 'badResponse', message: 'provider returned an empty piece result' });
  return ok(value);
}
