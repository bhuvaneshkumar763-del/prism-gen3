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
 * Turns a test translation's outcome into what Settings shows. Text that
 * comes back identical counts as a FAILURE: the service answering normally
 * but translating nothing is the silent-failure mode this test exists to catch.
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
