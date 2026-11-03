import { describeOneOffTranslateError } from '../../src/engine/pageTranslator/errorState';
import type { TranslateError } from '../../src/engine/translator';
import { TimeoutError } from '../../src/shared/withTimeout';

/** The selection popup's wording for a failed translation; it is never retried. */
export function describeSelectionError(error: TranslateError): string {
  return describeOneOffTranslateError(error);
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
