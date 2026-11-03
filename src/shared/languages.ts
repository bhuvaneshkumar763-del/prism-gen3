/** A small curated list of common languages for quick-pick UI (the popup's target-language selector). */
export interface LanguageOption {
  code: string;
  name: string;
}

export const COMMON_LANGUAGES: LanguageOption[] = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ms', name: 'Malay' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ta', name: 'Tamil' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

export function languageName(code: string): string {
  return COMMON_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Google reports these legacy ISO 639 codes; mapped so they compare equal to the current ones. */
const LEGACY_BASE_LANGUAGE_CODES = new Map<string, string>([
  ['iw', 'he'],
  ['ji', 'yi'],
  ['in', 'id'],
  ['jw', 'jv'],
]);

/**
 * Strips a region/script subtag ('pt-BR' -> 'pt', 'zh-Hans' -> 'zh') and maps
 * legacy codes, so a regional variant compares equal to its base language
 * (e.g. a pt-BR page matches a `neverTranslateLangs: ['pt']` rule).
 */
export function baseLanguageTag(code: string): string {
  const base = code.split('-')[0]?.toLowerCase() ?? code;
  return LEGACY_BASE_LANGUAGE_CODES.get(base) ?? base;
}

/**
 * "Vietnamese → English" — which way a translated page went, or null when
 * that can't be said honestly: the source language is unknown, or the page
 * is already in the target language (where "English → English" would be
 * noise). Callers fall back to a plain "Translated" in that case.
 */
export function translationDirection(originalLanguage: string, targetLanguage: string): string | null {
  if (!originalLanguage || originalLanguage === 'und' || originalLanguage === 'auto') return null;
  if (baseLanguageTag(originalLanguage) === baseLanguageTag(targetLanguage)) return null;
  return `${languageName(originalLanguage)} → ${languageName(targetLanguage)}`;
}
