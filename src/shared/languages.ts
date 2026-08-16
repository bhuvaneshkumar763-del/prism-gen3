/**
 * A small curated list of common languages for quick-pick UI (the popup's
 * target-language selector). Deliberately NOT the full generated
 * language-name table the Gen 3 plan schedules for Session 7 (derived from
 * what each provider actually supports, plus the old repo's 43 locale
 * files' translated string values as a bootstrap corpus) — this is just
 * enough for a usable dropdown today instead of a bare text input, scoped
 * to popup/options polish, not a substitute for that later session's work.
 */
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
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

export function languageName(code: string): string {
  return COMMON_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/**
 * Strips a region/script subtag ('pt-BR' -> 'pt', 'zh-Hans' -> 'zh') so
 * language-equality checks treat a regional variant the same as its base
 * language — without this, `autoTranslateDecision.ts`'s exact-string
 * comparisons treat "Portuguese" and "Brazilian Portuguese" as unrelated:
 * a pt-BR page against target 'pt' fails the same-language skip (so it gets
 * pointlessly "translated" into Portuguese), and a `neverTranslateLangs:
 * ['pt']` rule silently never matches it.
 */
export function baseLanguageTag(code: string): string {
  return code.split('-')[0]?.toLowerCase() ?? code;
}
