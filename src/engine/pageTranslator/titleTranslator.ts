import type { Translator } from '../translator';

/**
 * Tab-bar title translation. Kept as its own module (not folded into
 * `translateLoop.ts`) so the cache, the batching workaround, and the
 * dual-write are unit-testable without a DOM-walking full page.
 *
 * Why this needs a workaround at all: `google.ts`'s `transformPiece` only
 * wraps a piece in `<a i=N>` markers when it has more than one string
 * (`arr.length > 1`) — Google's endpoint does not reliably translate a
 * single bare string sent without that wrapper. `collectTextNodes` in
 * `translateLoop.ts` never reaches `<title>` (it walks from
 * `document.body`, and `<title>` lives in `<head>`), so page translation
 * alone never touches the tab title, and a naive one-off single-string
 * translation call for the title would hit exactly that `arr.length > 1`
 * gap and silently come back untranslated on Google.
 *
 * The fix, scoped to just this module rather than a global change to every
 * single-text translation path (which would be a much bigger blast
 * radius for one narrow provider quirk): send the title alongside a
 * throwaway second string (`pieces: [[text, ' ']]`), which reliably lands
 * on the `arr.length > 1` branch, then keep only the first result and
 * discard the second.
 */

const MAX_CACHE_ENTRIES = 50;
const POLL_INTERVAL_MS = 1500;

export interface TitleTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  isPageVisible(): boolean;
}

export function createTitleTranslator(options: TitleTranslatorOptions) {
  const cache = new Map<string, string>();

  let currentTargetLanguage = '';
  let originalPageTitle: string | null = null;
  let translatedPageTitle: string | null = null;
  let active = false;
  // A single DOM change (e.g. a site's own document.title assignment) can
  // fire the MutationObserver below more than once before the first
  // resulting request resolves — without this guard, each of those ticks
  // would race a duplicate request for the exact same text, since the
  // cache is only populated once the first one finishes.
  let inFlightKey: string | null = null;

  let headObserver: MutationObserver | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  function cacheKey(text: string): string {
    return `${options.getSourceLanguage()}>${currentTargetLanguage}:${text}`;
  }

  /**
   * Sends the title through the same multi-item batching path every other
   * piece of page text uses (via a throwaway second string), so it reliably
   * gets the `<a i=N>` wrapping Google's endpoint needs. See the module
   * header for why a plain single-string request would silently fail.
   */
  async function translateTitleString(text: string): Promise<string | null> {
    const key = cacheKey(text);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (inFlightKey === key) return null; // a duplicate observer/poll tick for the same pending request

    inFlightKey = key;
    try {
      let outcomes: Awaited<ReturnType<Translator['translateBatch']>>;
      try {
        outcomes = await options.translator.translateBatch({
          sourceLanguage: options.getSourceLanguage(),
          targetLanguage: currentTargetLanguage,
          pieces: [[text, ' ']],
          dontSortResults: false,
        });
      } catch (e) {
        console.error('[prism] title translation request failed', e);
        return null;
      }

      const outcome = outcomes[0];
      const translated = outcome?.ok ? outcome.value[0] : undefined;
      if (!translated || translated === text) return null;

      if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
      cache.set(key, translated);
      return translated;
    } finally {
      if (inFlightKey === key) inFlightKey = null;
    }
  }

  /**
   * A page's title is really two things — the `<title>` element and the
   * browser-visible `document.title` — and they can drift out of sync.
   * Writing only one of them is why the tab bar can keep showing stale text
   * even after translation succeeds. Write both, each in its own try/catch
   * so a failure on one doesn't block the other.
   */
  function applyTabTitle(text: string): void {
    try {
      document.title = text;
    } catch (e) {
      console.debug(e);
    }
    try {
      let titleEl = document.querySelector('title');
      if (!titleEl) {
        titleEl = document.createElement('title');
        (document.head || document.documentElement).prepend(titleEl);
      }
      if (titleEl.textContent !== text) {
        noteOwnHeadWrite();
        titleEl.textContent = text;
      }
    } catch (e) {
      console.debug(e);
    }
  }

  // Loop guard: the MutationObserver below watches <head>, and applyTabTitle
  // writes into <title> (inside <head>) — without this, every translated
  // write would immediately re-trigger maybeRetranslate on our own change.
  let suppressNextObserverTick = false;
  function noteOwnHeadWrite(): void {
    suppressNextObserverTick = true;
  }

  async function translate(targetLanguage: string): Promise<void> {
    currentTargetLanguage = targetLanguage;
    active = true;

    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    const current = document.title;
    if (!current || current.trim().length < 1) return;

    originalPageTitle = current;
    const result = await translateTitleString(current);
    if (!active) return; // restored/torn down while the request was in flight
    if (result && result !== current) {
      translatedPageTitle = result;
      applyTabTitle(result);
    }
  }

  async function maybeRetranslate(): Promise<void> {
    if (!active) return;
    if (!options.isPageVisible()) return;
    const current = document.title;
    if (!current || current.trim().length < 1) return;
    if (current === translatedPageTitle) return;

    originalPageTitle = current;
    const result = await translateTitleString(current);
    if (!active) return;
    if (!result || result === current) return;
    translatedPageTitle = result;
    if (document.title !== result) {
      applyTabTitle(result);
    }
  }

  function startWatching(): void {
    stopWatching();
    headObserver = new MutationObserver(() => {
      if (suppressNextObserverTick) {
        suppressNextObserverTick = false;
        return;
      }
      void maybeRetranslate();
    });
    const head = document.head || document.querySelector('head');
    if (head) {
      headObserver.observe(head, { childList: true, subtree: true, characterData: true });
    }
    // Some sites' title writes don't reliably fire the observer — a polling
    // fallback catches those too. Only runs while the page is visible;
    // visibilitychange handling in translateLoop.ts does one catch-up check
    // on refocus.
    pollHandle = setInterval(() => {
      if (options.isPageVisible()) void maybeRetranslate();
    }, POLL_INTERVAL_MS);
  }

  function stopWatching(): void {
    headObserver?.disconnect();
    headObserver = null;
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
  }

  /** Called on translatePage() — starts translating the title and watching for changes. */
  async function start(targetLanguage: string): Promise<void> {
    await translate(targetLanguage);
    startWatching();
  }

  /** Called on restorePage() — stops watching and restores the original title. */
  function restore(): void {
    stopWatching();
    active = false;
    if (originalPageTitle !== null) {
      applyTabTitle(originalPageTitle);
    }
    originalPageTitle = null;
    translatedPageTitle = null;
  }

  /** One catch-up check, e.g. on tab refocus — no point polling a backgrounded tab. */
  function catchUp(): void {
    if (active) void maybeRetranslate();
  }

  return { start, restore, catchUp };
}

export type TitleTranslator = ReturnType<typeof createTitleTranslator>;
