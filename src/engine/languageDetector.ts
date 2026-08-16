/**
 * The port `blockLanguageFilter.ts` depends on — same shape/reasoning as
 * `translator.ts`'s `Translator` port: a thin interface engine code calls
 * through, with the real browser-API-touching implementation living in
 * `src/platform/` (see `src/engine/README.md` for the zero-chrome/browser
 * boundary this exists to preserve).
 */
export interface LanguageDetectionResult {
  /** ISO language code the detector is most confident about. */
  language: string;
  /**
   * True only when one language emerged with confidence clearly higher
   * than the next candidate — mirrors `browser.i18n.detectLanguage`'s own
   * `isReliable` flag. A caller should never skip translation on an
   * unreliable result; the safe default is always "translate anyway."
   */
  isReliable: boolean;
  /** 0-100 confidence in `language`. */
  percentage: number;
}

export interface LanguageDetector {
  /** Never throws — returns `null` if detection is unavailable or fails, same "degrade to unknown, not silence" contract as `originalLanguageTracker.ts`. */
  detect(text: string): Promise<LanguageDetectionResult | null>;
}
