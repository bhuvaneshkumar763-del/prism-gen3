import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLanguageDetector } from './languageDetector';

/** See originalLanguageTracker.test.ts's identical helper for why the cast is needed. */
function spyOnDetectLanguage() {
  return vi.spyOn(browser.i18n, 'detectLanguage') as unknown as ReturnType<
    typeof vi.fn<() => Promise<{ isReliable: boolean; languages: Array<{ language: string; percentage: number }> }>>
  >;
}

describe('createLanguageDetector', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the top language, reliability, and percentage', async () => {
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 92 }],
    });

    const detector = createLanguageDetector();
    const result = await detector.detect('History Sorting Chapters');

    expect(result).toEqual({ language: 'en', isReliable: true, percentage: 92 });
  });

  it('returns null for empty text without calling the API', async () => {
    const detectLanguage = spyOnDetectLanguage();

    const detector = createLanguageDetector();
    const result = await detector.detect('');

    expect(result).toBeNull();
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when detectLanguage rejects', async () => {
    spyOnDetectLanguage().mockRejectedValue(new Error('not supported'));

    const detector = createLanguageDetector();
    await expect(detector.detect('some text')).resolves.toBeNull();
  });

  it('returns null when detectLanguage is unavailable (falsy, not just a throwing function)', async () => {
    const original = browser.i18n.detectLanguage;
    // @ts-expect-error deliberately simulating an engine without this API
    browser.i18n.detectLanguage = undefined;
    try {
      const detector = createLanguageDetector();
      await expect(detector.detect('some text')).resolves.toBeNull();
    } finally {
      browser.i18n.detectLanguage = original;
    }
  });

  it('returns null when the detector reports no languages at all', async () => {
    spyOnDetectLanguage().mockResolvedValue({ isReliable: false, languages: [] });

    const detector = createLanguageDetector();
    const result = await detector.detect('ambiguous text');

    expect(result).toBeNull();
  });
});
