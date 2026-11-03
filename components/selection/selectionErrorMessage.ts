import { describeTranslateError } from '../../src/engine/pageTranslator/errorState';
import type { TranslateError } from '../../src/engine/translator';
import { TimeoutError } from '../../src/shared/withTimeout';

/**
 * The selection popup's wording for a failed translation: the page
 * translator's plain-language message, minus its promise of an automatic
 * retry, since a one-off selection translation is never retried.
 */
export function describeSelectionError(error: TranslateError): string {
  if (error.kind === 'suspicious' || error.kind === 'untranslated') {
    return 'The translation service sent this text back untranslated. Try again; if it keeps happening, switch provider in Settings.';
  }
  return describeTranslateError(error).replace(/\s*(?:—|;)\s*(?:retrying|Prism will retry) automatically\.$/, '.');
}

/**
 * For a request that never got an answer at all. Anything but a timeout means
 * this tab can't reach Prism's background, almost always because Prism was
 * updated or reloaded since the page opened.
 */
export function describeSelectionRejection(cause: unknown): string {
  if (cause instanceof TimeoutError) return describeSelectionError({ kind: 'timeout', message: cause.message });
  return "Couldn't reach Prism — it was probably just updated. Reload the page, then try again.";
}
