import type { Result } from '../shared/result';

/**
 * The core port every translation provider implements. Deliberately
 * minimal for this first vertical slice (Session 2) — batching, retry,
 * concurrency, and provider capability metadata (batchingHint,
 * requiresKey, ...) land in Session 4 once there's more than one provider
 * to generalize across. See docs/decisions/ for anything non-obvious.
 */

export interface TranslateRequest {
  text: string;
  /** ISO 639-1 language code, or 'auto' to let the provider detect it. */
  sourceLanguage: string;
  targetLanguage: string;
}

export type TranslateError = { kind: 'network' | 'http' | 'parse'; message: string };

export interface Translator {
  translate(request: TranslateRequest): Promise<Result<string, TranslateError>>;
}
