/**
 * Whether a page should be auto-translated once its source language is known.
 * Third-party translate-result pages (Google/Yandex/DeepL) are excluded so
 * their output isn't translated again on top.
 */

import { siteListIncludesHostname } from '../../shared/config/listMutations';
import { sameLanguage } from '../../shared/languages';

const TRANSLATION_SERVICE_HOSTS = new Set([
  'translate.googleusercontent.com',
  'translate.yandex.com',
  'www.deepl.com',
  'translated.turbopages.org',
]);

/** Matches every regional TLD (`translate.google.co.uk`, `.de`, ...), not just `.com`. */
const TRANSLATE_GOOGLE_SITE = /^translate\.google\.[a-z.]+$/;

export function isTranslationServiceHost(hostname: string): boolean {
  if (TRANSLATION_SERVICE_HOSTS.has(hostname)) return true;
  if (TRANSLATE_GOOGLE_SITE.test(hostname)) return true;
  // Dot-boundary the suffix so an unrelated "mytranslate.goog" doesn't match.
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
 * Site lists are honored before any language rule; absent a site match, falls
 * through to the detected-language allow/deny lists. A hostname on both site
 * lists is never-translated (checked first).
 */
export function shouldAutoTranslateOnLoad(input: AutoTranslateDecisionInput): boolean {
  if (input.pageLanguageState !== 'original') return false;
  if (input.isIncognito) return false;
  if (siteListIncludesHostname(input.neverTranslateSites, input.hostname)) return false;
  if (isTranslationServiceHost(input.hostname)) return false;

  if (siteListIncludesHostname(input.alwaysTranslateSites, input.hostname)) return true;

  if (input.originalLanguage === 'und') return false;
  // `sameLanguage`, so 'pt-BR' matches a plain 'pt' target or rule but
  // Simplified and Traditional Chinese stay apart.
  const original = input.originalLanguage;
  if (sameLanguage(original, input.targetLanguage)) return false;
  if (input.neverTranslateLangs.some((code) => sameLanguage(code, original))) return false;
  if (input.alwaysTranslateLangs.some((code) => sameLanguage(code, original))) return true;

  return false;
}
