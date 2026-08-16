import type { LanguageDetectionResult, LanguageDetector } from '../engine/languageDetector';

/**
 * Implements the engine's `LanguageDetector` port against the real
 * `browser.i18n.detectLanguage()` — the same underlying API
 * `originalLanguageTracker.ts` already uses for the whole-page detection,
 * called here per block instead of once per page. Available directly in a
 * content-script context (no background message relay needed, unlike
 * `remoteTranslator.ts` — `i18n.detectLanguage` isn't gated to the
 * background the way the provider APIs are).
 */
export function createLanguageDetector(): LanguageDetector {
  return {
    async detect(text: string): Promise<LanguageDetectionResult | null> {
      try {
        if (!text || typeof browser.i18n?.detectLanguage !== 'function') return null;
        const result = await browser.i18n.detectLanguage(text);
        const top = result?.languages?.[0];
        if (!top) return null;
        return {
          language: top.language,
          isReliable: result.isReliable,
          percentage: top.percentage,
        };
      } catch (e) {
        console.warn('[prism] block-level language detection failed', e);
        return null;
      }
    },
  };
}
