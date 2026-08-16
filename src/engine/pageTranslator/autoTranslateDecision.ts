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
import { baseLanguageTag } from '../../shared/languages';

const TRANSLATION_SERVICE_HOSTS = new Set([
  'translate.googleusercontent.com',
  'translate.yandex.com',
  'www.deepl.com',
  'translated.turbopages.org',
]);

/**
 * `translate.google.com` alone missed every regional TLD Google Translate's
 * own site actually uses (`translate.google.co.uk`, `translate.google.de`,
 * ...) — real bug, matched by pattern instead of one entry per TLD.
 */
const TRANSLATE_GOOGLE_SITE = /^translate\.google\.[a-z.]+$/;

export function isTranslationServiceHost(hostname: string): boolean {
  if (TRANSLATION_SERVICE_HOSTS.has(hostname)) return true;
  if (TRANSLATE_GOOGLE_SITE.test(hostname)) return true;
  // Dot-boundary the .goog suffix: a bare endsWith('translate.goog') also
  // matches a hostname like "mytranslate.goog" (the substring "translate.goog"
  // is a suffix even with no subdomain dot before it) — false-positive
  // service-host match on an unrelated site. Require an exact match or a
  // real subdomain boundary.
  return hostname === 'translate.goog' || hostname.endsWith('.translate.goog');
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
 *
 * If a hostname somehow ends up on BOTH site lists at once, never wins (it's
 * checked first, below) — `src/shared/config/listMutations.ts`'s add/remove
 * helpers exist specifically so normal UI use can't produce that state.
 */
export function shouldAutoTranslateOnLoad(input: AutoTranslateDecisionInput): boolean {
  if (input.pageLanguageState !== 'original') return false;
  if (input.isIncognito) return false;
  if (input.neverTranslateSites.includes(input.hostname)) return false;
  if (isTranslationServiceHost(input.hostname)) return false;

  if (input.alwaysTranslateSites.includes(input.hostname)) return true;

  if (input.originalLanguage === 'und') return false;
  // Compared by base tag (see baseLanguageTag's doc comment) — a regional
  // variant like 'pt-BR' should match a plain 'pt' target/rule the same way
  // a user would expect "Portuguese" to.
  const originalBase = baseLanguageTag(input.originalLanguage);
  if (originalBase === baseLanguageTag(input.targetLanguage)) return false;
  if (input.neverTranslateLangs.some((code) => baseLanguageTag(code) === originalBase)) return false;
  if (input.alwaysTranslateLangs.some((code) => baseLanguageTag(code) === originalBase)) return true;

  return false;
}
