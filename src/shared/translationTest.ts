import type { TranslateError } from '../engine/translator';
import { baseLanguageTag } from './languages';
import type { Result } from './result';

export interface TranslationTestSample {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

const ENGLISH_SAMPLE = 'Good morning, how are you today?';
/** Used when the target is English, where an English sample would come back unchanged and prove nothing. */
const FRENCH_SAMPLE = "Bonjour, comment allez-vous aujourd'hui ?";

/**
 * A short sample whose translation can actually demonstrate that
 * translation happened — which means its language must differ from the
 * target.
 */
export function pickTranslationTestSample(targetLanguage: string): TranslationTestSample {
  if (baseLanguageTag(targetLanguage) === 'en') {
    return { text: FRENCH_SAMPLE, sourceLanguage: 'fr', targetLanguage };
  }
  return { text: ENGLISH_SAMPLE, sourceLanguage: 'en', targetLanguage };
}

/**
 * Turns a test translation's outcome into what Settings shows.
 *
 * An answer identical to the input is reported as a FAILURE, not success:
 * that is this project's documented silent-failure mode — the service
 * responds normally but translates nothing (see the post-launch incident
 * "translation didn't work out of the box, and failure was silent"). A test
 * that called that "working" would reproduce exactly the problem it's for.
 */
export function describeTranslationTest(
  sample: TranslationTestSample,
  result: Result<string, TranslateError>,
  elapsedMs: number,
): { ok: boolean; message: string } {
  if (!result.ok) {
    return { ok: false, message: `Not working: ${result.error.message}` };
  }
  if (result.value.trim() === sample.text.trim()) {
    return {
      ok: false,
      message: 'Reached the service, but the text came back unchanged — nothing was actually translated.',
    };
  }
  return { ok: true, message: `Working — “${sample.text}” → “${result.value}” (${Math.round(elapsedMs)} ms)` };
}
