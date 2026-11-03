/**
 * Adaptive safety re-sweep: re-walks the page through the same deduped
 * pipeline as the mutation watcher, catching what a body MutationObserver
 * can't see (changes inside shadow roots, detached-then-attached subtrees).
 *
 * Fast after load, backs off on a static page; scroll, SPA navigation (a
 * `location.href` poll, since a content script can't hook the page's
 * `history.pushState`) or returning to the tab resets the cadence.
 */

const RESWEEP_MIN_MS = 1500;
const RESWEEP_MAX_MS = 10000;
const RESWEEP_BACKOFF_FACTOR = 1.6;

export interface ResweepOptions {
  isTranslated(): boolean;
  isPageVisible(): boolean;
  /** Re-walk the page; return true if new work was found (keeps the cadence fast). */
  onResweep(): boolean;
  /** Called once per tick when location.href changed since the last tick (SPA navigation). */
  onHrefChange?(): void;
  /** Debounced scroll notification (same debounce as `bump()`), so callers needn't add their own scroll listener. */
  onViewportChanged?(): void;
}

export function createResweepScheduler(options: ResweepOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = RESWEEP_MIN_MS;
  let started = false;
  let lastHref = location.href;
  let scrollDebounce: ReturnType<typeof setTimeout> | null = null;

  function run(): void {
    if (location.href !== lastHref) {
      lastHref = location.href;
      delay = RESWEEP_MIN_MS;
      options.onHrefChange?.();
    }

    if (options.isTranslated() && options.isPageVisible()) {
      const grew = options.onResweep();
      delay = grew ? RESWEEP_MIN_MS : Math.min(RESWEEP_MAX_MS, Math.round(delay * RESWEEP_BACKOFF_FACTOR));
    } else {
      delay = RESWEEP_MAX_MS;
    }

    timer = setTimeout(run, delay);
  }

  function bump(): void {
    if (!started) return;
    delay = RESWEEP_MIN_MS;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  function onScroll(): void {
    if (!options.isTranslated()) return;
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      bump();
      options.onViewportChanged?.();
    }, 400);
  }

  function onPopstate(): void {
    if (options.isTranslated()) bump();
  }

  function start(): void {
    if (started) {
      bump();
      return;
    }
    started = true;

    // Capture phase: 'scroll' on an element (an inner scroll pane) doesn't
    // bubble, but every scroll event still passes `window` while capturing.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('popstate', onPopstate);

    timer = setTimeout(run, delay);
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = null;
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('popstate', onPopstate);
    started = false;
  }

  return { start, stop, bump };
}

export type ResweepScheduler = ReturnType<typeof createResweepScheduler>;
