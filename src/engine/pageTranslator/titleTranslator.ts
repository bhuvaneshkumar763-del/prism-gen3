import type { Translator } from '../translator';

/**
 * Tab-bar title translation. Kept as its own module (not folded into
 * `translateLoop.ts`) so the cache and the dual-write are unit-testable
 * without a DOM-walking full page. `collectTextNodes` in `translateLoop.ts`
 * never reaches `<title>` (it walks from `document.body`, and `<title>`
 * lives in `<head>`), so page translation alone never touches the tab
 * title — this module exists to cover that gap.
 *
 * Session 7 originally worked around a real Google quirk here directly
 * (`transformPiece` only wraps a piece in `<a i=N>` markers when it has
 * more than one string, and a bare single-string request doesn't
 * translate reliably) by hand-padding `pieces: [[text, ' ']]`. `google.ts`
 * has since grown that same padding automatically for every caller
 * (Session 4+/beta.28), including the reconciliation fix for content
 * Google reflows into the padding slot — this module now just sends an
 * ordinary single-string piece and lets the provider handle it, rather
 * than duplicating (and, as an audit later found, silently bypassing) that
 * logic here.
 */

const MAX_CACHE_ENTRIES = 50;
const POLL_MIN_MS = 1500;
const POLL_MAX_MS = 30000;
const POLL_BACKOFF_FACTOR = 1.5;

export interface TitleTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
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
  // A single DOM change (e.g. a site's own document.title assignment) can
  // fire the MutationObserver below more than once before the first
  // resulting request resolves — without this guard, each of those ticks
  // would race a duplicate request for the exact same text, since the
  // cache is only populated once the first one finishes.
  let inFlightKey: string | null = null;

  let headObserver: MutationObserver | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every startWatching()/stopWatching() — see schedulePoll below. */
  let watchGeneration = 0;
  // Mirrors translateLoop.ts's own surfaced-error backoff: a provider that's
  // confirmed broken/rate-limited (repeated 'failed' results) grows the
  // polling interval instead of being hammered every POLL_MIN_MS forever.
  // Resets to the fast interval the moment a poll succeeds (or has nothing
  // to do) again.
  let pollDelay: number = POLL_MIN_MS;

  function cacheKey(text: string): string {
    return `${options.getSourceLanguage()}>${currentTargetLanguage}:${text}`;
  }

  /**
   * Sends the title as an ordinary single-string piece — `google.ts`'s own
   * `translateBatch` already pads any single-string piece with a throwaway
   * second string itself now (Session 7+, see its header comment for why a
   * plain single-string request would silently fail), and reconciles the
   * result correctly on the way back (including a later fix for content
   * Google reflows into the padding slot). This function used to hand-roll
   * its own `[text, ' ']` padding to work around the same problem — real
   * bug, found via an audit: because that made the piece already 2 items
   * long, it silently bypassed `google.ts`'s (now-fixed) reconciliation
   * logic entirely, which only engages for pieces it padded itself. Any
   * reflowed content Google put in the throwaway slot was then just
   * dropped at the `outcome.value[0]` read below, unlike regular page
   * text. Letting the provider pad instead of doing it here fixes that for
   * free and removes the duplicate logic.
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
          targetLanguage: currentTargetLanguage,
          pieces: [[text]],
          dontSortResults: false,
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

    originalPageTitle = current;
    const result = await translateTitleString(current);
    if (!active) return;

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
    // Some sites' title writes don't reliably fire the observer — a polling
    // fallback catches those too. Only runs while the page is visible;
    // visibilitychange handling in translateLoop.ts does one catch-up check
    // on refocus. Self-reschedules (rather than setInterval) so pollDelay's
    // backoff, grown in maybeRetranslate() on a 'failed' result, actually
    // takes effect between ticks instead of firing at a fixed cadence
    // regardless of how many consecutive requests have failed.
    pollDelay = POLL_MIN_MS;
    // Captured per startWatching() run. A self-rescheduling timer can
    // otherwise resurrect itself: stopWatching() clears the pending timer,
    // but a callback already awaiting maybeRetranslate() resumes afterwards
    // and re-arms, leaving a timer running for the life of the page. The
    // generation check makes a stopped (or restarted) watcher's in-flight
    // callback a no-op.
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
