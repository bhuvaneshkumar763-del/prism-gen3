/**
 * Whether a page should be auto-translated once its source language is
 * known. Pure decision logic — no DOM, no browser APIs — so it's directly
 * unit-testable and lives in `src/engine/` alongside the rest of the
 * page-translation engine.
 *
 * A well-known third-party translation-output host (Google/Yandex/DeepL's
 * own translated-page views) is deliberately excluded, to avoid a
 * confusing recursive-translation UX — this project's own translator
 * output page (there isn't one; Prism translates in place) doesn't need a
 * carve-out, but visiting someone else's translate-result page would
 * otherwise get auto-translated again on top of their translation.
 */

const TRANSLATION_SERVICE_HOSTS = new Set([
  'translate.googleusercontent.com',
  'translate.google.com',
  'translate.yandex.com',
  'www.deepl.com',
  'translated.turbopages.org',
]);

export function isTranslationServiceHost(hostname: string): boolean {
  return TRANSLATION_SERVICE_HOSTS.has(hostname) || hostname.endsWith('translate.goog');
}

export interface AutoTranslateDecisionInput {
  originalLanguage: string;
  hostname: string;
  targetLanguage: string;
  pageLanguageState: 'original' | 'translated';
  alwaysTranslateSites: string[];
  neverTranslateSites: string[];
  alwaysTranslateLangs: string[];
  neverTranslateLangs: string[];
  isIncognito: boolean;
}

/**
 * An explicit "always translate this site" (or the never-translate-sites
 * list) is honored unconditionally — the user already told us what this
 * site is, which is just as explicit a signal as a language match. Absent
 * that, falls through to the detected-language allow/deny lists.
 */
export function shouldAutoTranslateOnLoad(input: AutoTranslateDecisionInput): boolean {
  if (input.pageLanguageState !== 'original') return false;
  if (input.isIncognito) return false;
  if (input.neverTranslateSites.includes(input.hostname)) return false;
  if (isTranslationServiceHost(input.hostname)) return false;

  if (input.alwaysTranslateSites.includes(input.hostname)) return true;

  if (input.originalLanguage === 'und') return false;
  if (input.originalLanguage === input.targetLanguage) return false;
  if (input.neverTranslateLangs.includes(input.originalLanguage)) return false;
  if (input.alwaysTranslateLangs.includes(input.originalLanguage)) return true;

  return false;
}
