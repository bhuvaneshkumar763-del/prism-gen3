import { baseLanguageTag } from '../../shared/languages';

/**
 * A bounded, best-effort guard against a class of silent bad translation —
 * Phase 5 of the graceful-degradation pass. Real, explainable failure
 * modes this catches: a proxy/gateway that swallows a request and echoes
 * the original text back unchanged, or a provider that returns an empty
 * string for a real piece of text.
 *
 * Deliberately NOT provably complete — see `batchedHttpProvider.ts`'s
 * `handleBatch` for where this plugs into the existing one-shot repair
 * path (reused, not a new retry mechanism), and this project's own
 * verification convention: this needs a live-traffic check before it's
 * trusted, not just unit tests, given the false-positive risk called out
 * below.
 */

export interface SanityCheckResult {
  text: string;
  detectedLanguage: string | null;
}

/**
 * Short strings that are legitimately identical across a language pair
 * (numbers, acronyms, proper nouns — "2024", "OK", "NASA") are common and
 * correct, not a translation failure — only a long identical result is
 * suspicious enough to flag. Kept as the fallback for the genuinely
 * ambiguous same-script case (e.g. English→French) — see
 * `hasScriptMismatch` below for the length-independent case this project
 * actually hits most often in practice.
 */
const MIN_SUSPICIOUS_IDENTICAL_LENGTH = 40;

/**
 * Unicode ranges for scripts distinct enough from Latin that "the exact
 * same characters survived translation unchanged" is close to unambiguous
 * failure evidence, not a coincidence — unlike two Latin-script languages,
 * where an identical short string is routinely correct (a proper noun, an
 * acronym, a number). Real gap this closes, found via an audit: the
 * length-only heuristic above lets through almost every real silent-echo
 * failure this project has actually hit (beta.29's investigation) — nav
 * labels, buttons, headings are nearly always well under 40 chars, and
 * Google's own silent-echo failure mode (200 OK, input returned
 * unchanged) disproportionately hits exactly these short strings.
 */
const NON_LATIN_SCRIPT = /[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/;
/** Same ranges as `NON_LATIN_SCRIPT`, global-flagged so `hasScriptMismatch` can count every match rather than just testing presence. */
const NON_LATIN_SCRIPT_GLOBAL = /[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/gu;
const LETTER_GLOBAL = /\p{L}/gu;

/**
 * Real regression this closed, a false positive introduced by the
 * `hasScriptMismatch` fix itself: the original version fired on any text
 * that merely CONTAINED at least one non-Latin character anywhere, so a
 * legitimately-unchanged string with one incidental non-Latin letter or
 * symbol mixed into otherwise-Latin prose — "Δt" (a physics delta), a
 * Cyrillic-spelled proper noun in an English sentence — got flagged as a
 * silent-echo failure even though there was nothing wrong with it,
 * costing a wasted repair request and up to 3 wasted requeue ticks (see
 * `batchedHttpProvider.ts`'s repair path) for text that was correct all
 * along. A genuinely non-Latin nav label/heading/button — the real
 * failure mode this exists to catch — is always ENTIRELY or almost
 * entirely non-Latin; requiring the overwhelming majority of the text's
 * actual letters (not digits/punctuation/whitespace) to be non-Latin,
 * rather than just "at least one," keeps catching that case while no
 * longer tripping on an incidental symbol or name embedded in Latin text.
 */
const NON_LATIN_MAJORITY_THRESHOLD = 0.8;

/**
 * Base (region-stripped) codes for languages that don't normally use Latin
 * script — if the target is one of these, an identical result could be a
 * real (if unusual) same-script no-op, not obviously a failure, so
 * `hasScriptMismatch` below only fires when the target is NOT one of
 * these. Deliberately generous (covers more than `languages.ts`'s curated
 * picker list) — a false negative here just falls through to the ordinary
 * length-based check, not a missed detection entirely.
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

  // Checked before the length gate and before trusting the provider's own
  // `detectedLanguage` signal below — a script mismatch is strong,
  // length-independent evidence, and a detector wrongly reporting the
  // TARGET language for genuinely non-Latin-script text is exactly the
  // known failure mode this project has already hit live (Google
  // auto-detect misreporting real Chinese text as English — see
  // beta.29's investigation) — trusting `detectedLanguage` over a direct
  // character-range mismatch here would just reproduce that bug.
  if (hasScriptMismatch(trimmedOriginal, targetLanguage)) return true;

  if (trimmedOriginal.length <= MIN_SUSPICIOUS_IDENTICAL_LENGTH) return false; // short identical string — likely legitimate

  // The provider's own detected source language says this text was
  // already in the target language — an identical result is then the
  // CORRECT no-op, not a failure.
  if (result.detectedLanguage) return result.detectedLanguage !== targetLanguage;
  // No detected-language signal from the provider — fall back to the
  // request's own declared languages. 'auto' means we don't actually know
  // the source, so there's no basis to call an identical result wrong.
  if (sourceLanguage === 'auto') return false;
  return sourceLanguage !== targetLanguage;
}
