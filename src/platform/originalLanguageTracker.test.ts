// @vitest-environment happy-dom
import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOriginalLanguageTracker } from './originalLanguageTracker';

/**
 * `browser.i18n.detectLanguage`'s type is an overloaded
 * (Promise-returning / callback-returning-void) signature from
 * webextension-polyfill's types — `vi.spyOn` resolves to the callback
 * overload's `void` return type in that situation, so `mockResolvedValue`
 * needs a cast to accept a real detection result. Centralized here rather
 * than repeated at every call site.
 */
function spyOnDetectLanguage() {
  return vi.spyOn(browser.i18n, 'detectLanguage') as unknown as ReturnType<
    typeof vi.fn<() => Promise<{ isReliable: boolean; languages: Array<{ language: string; percentage: number }> }>>
  >;
}

describe('createOriginalLanguageTracker', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    document.body.innerHTML = '<p>Some page text</p>';
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts at "und" before start() is called', () => {
    const tracker = createOriginalLanguageTracker();
    expect(tracker.get()).toBe('und');
  });

  it('reports the top detected language after start() resolves', async () => {
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'fr', percentage: 90 }],
    });

    const tracker = createOriginalLanguageTracker();
    await tracker.start();

    expect(tracker.get()).toBe('fr');
  });

  it('resolves to "und" (never throws) when detectLanguage rejects', async () => {
    spyOnDetectLanguage().mockRejectedValue(new Error('not supported'));

    const tracker = createOriginalLanguageTracker();
    await expect(tracker.start()).resolves.toBeUndefined();

    expect(tracker.get()).toBe('und');
  });

  it('resolves to "und" when detectLanguage is unavailable (falsy, not just a throwing function)', async () => {
    const original = browser.i18n.detectLanguage;
    // @ts-expect-error deliberately simulating an engine without this API
    browser.i18n.detectLanguage = undefined;
    try {
      const tracker = createOriginalLanguageTracker();
      await tracker.start();
      expect(tracker.get()).toBe('und');
    } finally {
      browser.i18n.detectLanguage = original;
    }
  });

  it('resolves to "und" when the page has no meaningful body text', async () => {
    document.body.innerHTML = '';
    const detectLanguage = spyOnDetectLanguage();

    const tracker = createOriginalLanguageTracker();
    await tracker.start();

    expect(tracker.get()).toBe('und');
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it('resolves to "und" when the detector reports no languages at all', async () => {
    spyOnDetectLanguage().mockResolvedValue({ isReliable: false, languages: [] });

    const tracker = createOriginalLanguageTracker();
    await tracker.start();

    expect(tracker.get()).toBe('und');
  });

  it('does not wait for visibility when the page is already visible', async () => {
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'de', percentage: 80 }],
    });

    const tracker = createOriginalLanguageTracker();
    const start = Date.now();
    await tracker.start();

    expect(tracker.get()).toBe('de');
    // Only the fixed ~150ms settle delay, no 5s visibility-wait timeout.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('waits for the page to become visible before detecting, but not forever', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'ja', percentage: 95 }],
    });

    const tracker = createOriginalLanguageTracker();
    const start = Date.now();
    const startPromise = tracker.start();

    // start() itself awaits a fixed ~150ms settle delay before it even
    // calls waitUntilVisible() — flip visibility well after that, so this
    // test actually exercises the "wait for visibilitychange" branch
    // instead of racing the short-circuit "already visible" check before
    // waitUntilVisible() is even invoked.
    setTimeout(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, 300);

    await startPromise;
    expect(tracker.get()).toBe('ja');
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
  });

  it('gives up waiting for visibility after the timeout cap and detects anyway', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'ko', percentage: 88 }],
    });

    // Page never becomes visible — the tracker must still resolve rather
    // than hang forever waiting for a visibilitychange that never fires.
    const tracker = createOriginalLanguageTracker();
    await tracker.start();

    expect(tracker.get()).toBe('ko');
  }, 10000);
});
