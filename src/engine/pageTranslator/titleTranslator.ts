import type { Translator } from '../translator';

/**
 * Tab-bar title translation. The page walk starts at `document.body`, so it
 * never reaches `<title>` in `<head>`; this module covers that gap.
 */

const MAX_CACHE_ENTRIES = 50;
const POLL_MIN_MS = 1500;
const POLL_MAX_MS = 30000;
const POLL_BACKOFF_FACTOR = 1.5;

export interface TitleTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** True when the user picked the source language by hand; see `TranslateBatchRequest.sourceLanguageIsExplicit`. */
  isSourceLanguageExplicit?(): boolean;
  isPageVisible(): boolean;
}

/**
 * `'duplicate'` (an in-flight request for the same text) is not a failure
 * and must not affect poll backoff below; `'failed'` covers both a thrown
 * request and a resolved `ok: false` outcome — see `translateTitleString`.
 */
type TranslateTitleResult =
  | { status: 'translated'; text: string }
  | { status: 'unchanged' }
  | { status: 'duplicate' }
  | { status: 'failed' };

export function createTitleTranslator(options: TitleTranslatorOptions) {
  const cache = new Map<string, string>();

  let currentTargetLanguage = '';
  let originalPageTitle: string | null = null;
  let translatedPageTitle: string | null = null;
  let active = false;
  // Bumped by start()/restore(); a start() resuming under a stale cycle must not install the watcher.
  let cycle = 0;
  // Bumped per new title and by start()/restore(); a response from an older
  // generation is dropped, so a slow chapter-1 reply can't overwrite chapter 2.
  let titleGeneration = 0;
  // One title change can fire the observer several times before the first
  // request resolves (the cache fills only then); this stops duplicates.
  let inFlightKey: string | null = null;

  let headObserver: MutationObserver | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every startWatching()/stopWatching() — see schedulePoll below. */
  let watchGeneration = 0;
  // Grows on repeated 'failed' results so a broken provider isn't hammered;
  // resets once a poll succeeds or has nothing to do.
  let pollDelay: number = POLL_MIN_MS;

  function cacheKey(text: string): string {
    return `${options.getSourceLanguage()}>${currentTargetLanguage}:${text}`;
  }

  /**
   * Sends the title as a plain single-string piece. Don't pad it here:
   * `google.ts` pads single strings itself, and its reflow reconciliation
   * only engages for pieces it padded.
   */
  async function translateTitleString(text: string): Promise<TranslateTitleResult> {
    const key = cacheKey(text);
    const cached = cache.get(key);
    if (cached !== undefined) return { status: 'translated', text: cached };
    if (inFlightKey === key) return { status: 'duplicate' }; // a duplicate observer/poll tick for the same pending request

    inFlightKey = key;
    try {
      let outcomes: Awaited<ReturnType<Translator['translateBatch']>>;
      try {
        outcomes = await options.translator.translateBatch({
          sourceLanguage: options.getSourceLanguage(),
          sourceLanguageIsExplicit: options.isSourceLanguageExplicit?.() ?? false,
          targetLanguage: currentTargetLanguage,
          pieces: [[text]],
        });
      } catch (e) {
        console.error('[prism] title translation request failed', e);
        return { status: 'failed' };
      }

      const outcome = outcomes[0];
      if (!outcome?.ok) {
        console.error('[prism] title translation failed', outcome && !outcome.ok ? outcome.error : outcome);
        return { status: 'failed' };
      }

      const translated = outcome.value[0];
      if (!translated || translated === text) return { status: 'unchanged' };

      if (cache.size > MAX_CACHE_ENTRIES) cache.clear();
      cache.set(key, translated);
      return { status: 'translated', text: translated };
    } finally {
      if (inFlightKey === key) inFlightKey = null;
    }
  }

  /**
   * Writes both `document.title` and the `<title>` element, which can drift
   * apart (writing one can leave the tab stale); separate try/catch for each.
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

  // Loop guard: the <head> observer would otherwise fire on our own <title> write.
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
    const myGeneration = ++titleGeneration;
    const result = await translateTitleString(current);
    if (myGeneration !== titleGeneration) return;
    if (result.status === 'translated' && result.text !== current) {
      translatedPageTitle = result.text;
      applyTabTitle(result.text);
    }
  }

  async function maybeRetranslate(): Promise<void> {
    if (!active) return;
    if (!options.isPageVisible()) return;
    const current = document.title;
    if (!current || current.trim().length < 1) return;
    if (current === translatedPageTitle) return;

    // The same title again (a duplicate observer/poll tick) keeps its generation.
    if (current !== originalPageTitle) titleGeneration++;
    originalPageTitle = current;
    const myGeneration = titleGeneration;
    const result = await translateTitleString(current);
    if (myGeneration !== titleGeneration) return;

    if (result.status === 'failed') {
      pollDelay = Math.min(POLL_MAX_MS, Math.round(pollDelay * POLL_BACKOFF_FACTOR));
      return;
    }
    if (result.status !== 'duplicate') pollDelay = POLL_MIN_MS;
    if (result.status !== 'translated' || result.text === current) return;

    translatedPageTitle = result.text;
    if (document.title !== result.text) {
      applyTabTitle(result.text);
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
    // Polling fallback for title writes the observer misses; visible pages only.
    // Self-rescheduling (not setInterval) so pollDelay's backoff takes effect.
    pollDelay = POLL_MIN_MS;
    // A callback awaiting maybeRetranslate() when stopWatching() runs would
    // otherwise re-arm itself afterwards; the generation check stops that.
    watchGeneration++;
    const myGeneration = watchGeneration;
    const schedulePoll = (): void => {
      if (myGeneration !== watchGeneration) return;
      pollTimer = setTimeout(async () => {
        if (options.isPageVisible()) await maybeRetranslate();
        schedulePoll();
      }, pollDelay);
    };
    schedulePoll();
  }

  function stopWatching(): void {
    headObserver?.disconnect();
    headObserver = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    // Invalidate any in-flight poll callback so it can't re-arm after this.
    watchGeneration++;
  }

  /** Called on translatePage() — starts translating the title and watching for changes. */
  async function start(targetLanguage: string): Promise<void> {
    const myCycle = ++cycle;
    await translate(targetLanguage);
    if (myCycle !== cycle) return; // restored, or started again, during the await
    startWatching();
  }

  /** Called on restorePage() — stops watching and restores the original title. */
  function restore(): void {
    stopWatching();
    active = false;
    cycle++;
    titleGeneration++;
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
