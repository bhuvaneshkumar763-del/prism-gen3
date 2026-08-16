import type { LanguageDetectionResult, LanguageDetector } from '../engine/languageDetector';
import { withTimeout } from '../shared/withTimeout';

/**
 * Implements the engine's `LanguageDetector` port against the real
 * `browser.i18n.detectLanguage()` — the same underlying API
 * `originalLanguageTracker.ts` already uses for the whole-page detection,
 * called here per block instead of once per page. Available directly in a
 * content-script context (no background message relay needed, unlike
 * `remoteTranslator.ts` — `i18n.detectLanguage` isn't gated to the
 * background the way the provider APIs are).
 *
 * Real bug, found testing against actual Firefox: `i18n.detectLanguage`
 * has long-standing upstream reliability problems there (Mozilla bug
 * 1712214) — it can simply never resolve or reject. `translateLoop.ts`
 * hard-`await`s `computeSkipElements()` (which calls this, once per
 * distinct container) before every translate pass, so an unbounded hang
 * here doesn't just skip the "already in target language" optimization —
 * it silently stalls translation entirely, on both the auto-translate and
 * the manual "translate this page" paths. `DETECT_LANGUAGE_TIMEOUT_MS`
 * bounds that; see `originalLanguageTracker.ts`'s identical fix for the
 * other call site of this same flaky API.
 */
const DETECT_LANGUAGE_TIMEOUT_MS = 3000;

export function createLanguageDetector(): LanguageDetector {
  return {
    async detect(text: string): Promise<LanguageDetectionResult | null> {
      try {
        if (!text || typeof browser.i18n?.detectLanguage !== 'function') return null;
        const result = await withTimeout(browser.i18n.detectLanguage(text), DETECT_LANGUAGE_TIMEOUT_MS);
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
