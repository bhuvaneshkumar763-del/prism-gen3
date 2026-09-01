// @vitest-environment happy-dom
import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onMessage } from './messaging/protocol';
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

  it('resolves to "und" instead of hanging forever when detectLanguage never settles, real bug: Firefox\'s implementation can hang indefinitely (Mozilla bug 1712214)', async () => {
    vi.useFakeTimers();
    spyOnDetectLanguage().mockReturnValue(new Promise(() => {})); // never resolves or rejects

    const tracker = createOriginalLanguageTracker();
    const startPromise = tracker.start();

    await vi.advanceTimersByTimeAsync(3000); // past the 3s detect timeout
    await startPromise;

    expect(tracker.get()).toBe('und');
  });

  it("prefers a successful tabs.detectLanguage relay over the text-sample fallback, real gap this closed: previously never called tabs.detectLanguage at all, matching TWP's fallback-only path instead of its actual primary one", async () => {
    const unsub = onMessage('detectTabLanguage', () => 'pt');
    // If the fallback were used instead, this would report the mocked
    // i18n.detectLanguage language below, not 'pt' — proves the relay
    // result wins without ever falling through.
    const detectLanguage = spyOnDetectLanguage();
    detectLanguage.mockResolvedValue({ isReliable: true, languages: [{ language: 'fr', percentage: 90 }] });

    try {
      const tracker = createOriginalLanguageTracker();
      await tracker.start();

      expect(tracker.get()).toBe('pt');
      expect(detectLanguage).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });

  it('falls back to the text-sample method when the tabs.detectLanguage relay reports "und"', async () => {
    const unsub = onMessage('detectTabLanguage', () => 'und');
    spyOnDetectLanguage().mockResolvedValue({ isReliable: true, languages: [{ language: 'es', percentage: 92 }] });

    try {
      const tracker = createOriginalLanguageTracker();
      await tracker.start();

      expect(tracker.get()).toBe('es');
    } finally {
      unsub();
    }
  });

  it('falls back to the text-sample method when nothing answers the tabs.detectLanguage relay at all', async () => {
    // No onMessage('detectTabLanguage', ...) handler registered — simulates
    // the message going unanswered (e.g. background not ready yet).
    spyOnDetectLanguage().mockResolvedValue({ isReliable: true, languages: [{ language: 'it', percentage: 91 }] });

    const tracker = createOriginalLanguageTracker();
    await tracker.start();

    expect(tracker.get()).toBe('it');
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
    // No 5s visibility-wait timeout hit — resolves promptly.
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

    // Flip visibility on a delay so this test actually exercises the
    // "wait for visibilitychange" branch inside waitUntilVisible(),
    // instead of racing its own "already visible" short-circuit check.
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
