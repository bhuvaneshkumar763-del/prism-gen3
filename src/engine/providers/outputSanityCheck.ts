import { baseLanguageTag } from '../../shared/languages';

/**
 * Best-effort guard against silent bad translations: the original text echoed
 * back unchanged, or an empty result for real text. Flagged pieces go through
 * `batchedHttpProvider.ts`'s existing one-shot repair path.
 */

export interface SanityCheckResult {
  text: string;
  detectedLanguage: string | null;
}

/**
 * Short identical strings ("2024", "OK", "NASA") are usually correct, so only
 * a long identical result is flagged. Fallback for the ambiguous same-script
 * case (e.g. English→French); see `hasScriptMismatch` for the common case.
 */
const MIN_SUSPICIOUS_IDENTICAL_LENGTH = 40;

/**
 * Scripts distinct enough from Latin that text surviving translation
 * unchanged is near-certain failure, whatever its length (silent echoes hit
 * short nav labels and buttons most). Must cover every script
 * `NON_LATIN_TARGET_LANGUAGES` names.
 *
 * Plain data turned into a `new RegExp` at runtime, NOT a regex literal:
 * Safari's extension runtime rejected the literal form ("range out of order")
 * and the minifier turns `\u{…}` escapes in a literal back into raw characters.
 */
const NON_LATIN_SCRIPT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x530, 0x58f],
  [0x590, 0x5ff],
  [0x600, 0x6ff],
  [0x900, 0x97f],
  [0xe00, 0xe7f],
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0x980, 0x9ff],
  [0xa00, 0xa7f],
  [0xa80, 0xaff],
  [0xb80, 0xbff],
  [0xc00, 0xc7f],
  [0xc80, 0xcff],
  [0xd00, 0xd7f],
  [0xd80, 0xdff],
  [0xe80, 0xeff],
  [0x1000, 0x109f],
  [0x10a0, 0x10ff],
  [0x1780, 0x17ff],
  [0x1800, 0x18af],
];
const NON_LATIN_SCRIPT_CLASS = `[${NON_LATIN_SCRIPT_RANGES.map(([start, end]) => `\\u{${start.toString(16)}}-\\u{${end.toString(16)}}`).join('')}]`;
const NON_LATIN_SCRIPT = new RegExp(NON_LATIN_SCRIPT_CLASS, 'u');
/** Same ranges as `NON_LATIN_SCRIPT`, global-flagged so `hasScriptMismatch` can count every match rather than just testing presence. */
const NON_LATIN_SCRIPT_GLOBAL = new RegExp(NON_LATIN_SCRIPT_CLASS, 'gu');
const LETTER_GLOBAL = /\p{L}/gu;

/**
 * Share of letters that must be non-Latin for a script mismatch. A real
 * failed non-Latin label is almost entirely non-Latin; requiring a majority
 * avoids flagging Latin prose with an incidental "Δt" or Cyrillic name.
 */
const NON_LATIN_MAJORITY_THRESHOLD = 0.8;

/**
 * Base codes of languages not normally written in Latin script;
 * `hasScriptMismatch` only fires when the target is NOT one of these.
 * Deliberately generous: a miss just falls through to the length check.
 */
const NON_LATIN_TARGET_LANGUAGES = new Set([
  'ar',
  'bn',
  'bg',
  'zh',
  'el',
  'he',
  'iw',
  'hi',
  'ja',
  'ko',
  'fa',
  'ru',
  'th',
  'uk',
  'hy',
  'ka',
  'km',
  'lo',
  'mn',
  'my',
  'ne',
  'pa',
  'sr',
  'mk',
  'si',
  'ta',
  'te',
  'kn',
  'ml',
  'gu',
  'ur',
]);

/**
 * True if `text` is written in a non-Latin script but the target language
 * doesn't itself normally use that script — an identical result in that
 * case is close to unambiguous failure evidence (see `NON_LATIN_SCRIPT`'s
 * comment), regardless of string length.
 */
function hasScriptMismatch(text: string, targetLanguage: string): boolean {
  if (!NON_LATIN_SCRIPT.test(text)) return false;
  const letters = text.match(LETTER_GLOBAL);
  if (!letters || letters.length === 0) return false;
  const nonLatinCount = text.match(NON_LATIN_SCRIPT_GLOBAL)?.length ?? 0;
  if (nonLatinCount / letters.length < NON_LATIN_MAJORITY_THRESHOLD) return false;
  return !NON_LATIN_TARGET_LANGUAGES.has(baseLanguageTag(targetLanguage));
}

/**
 * `true` if `result` looks like a translation that silently failed rather
 * than a real (possibly legitimate) output — `original` unchanged when it
 * shouldn't be, or empty when it shouldn't be.
 */
export function isSuspiciousOutcome(
  original: string,
  result: SanityCheckResult,
  sourceLanguage: string,
  targetLanguage: string,
): boolean {
  const trimmedOriginal = original.trim();
  const trimmedResult = result.text.trim();

  if (trimmedOriginal.length === 0) return false; // nothing to translate, nothing to flag
  if (trimmedResult.length === 0) return true; // empty result for real input — a real failure signature

  if (trimmedResult !== trimmedOriginal) return false; // genuinely translated — nothing suspicious

  // Before the length gate and before trusting `detectedLanguage`: Google's
  // auto-detect can report the target language for real non-Latin text.
  if (hasScriptMismatch(trimmedOriginal, targetLanguage)) return true;

  if (trimmedOriginal.length <= MIN_SUSPICIOUS_IDENTICAL_LENGTH) return false; // short identical string — likely legitimate

  // The provider's own detected source language says this text was
  // already in the target language — an identical result is then the
  // CORRECT no-op, not a failure.
  if (result.detectedLanguage) {
    return baseLanguageTag(result.detectedLanguage) !== baseLanguageTag(targetLanguage);
  }
  // No detected-language signal from the provider — fall back to the
  // request's own declared languages. 'auto' means we don't actually know
  // the source, so there's no basis to call an identical result wrong.
  if (sourceLanguage === 'auto') return false;
  return baseLanguageTag(sourceLanguage) !== baseLanguageTag(targetLanguage);
}
