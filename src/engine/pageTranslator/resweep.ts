/**
 * Adaptive safety re-sweep. A MutationObserver on document.body cannot see
 * mutations made *inside* shadow roots after load, subtrees built detached
 * and re-attached, or very slow client-side renders. To guarantee nothing
 * stays untranslated, this periodically re-walks the page through the same
 * identity-deduped pipeline as the mutation watcher, so already-translated
 * nodes are never re-sent.
 *
 * Runs often right after load/becoming visible, then backs off on a static
 * page; a scroll, SPA navigation (detected via a cheap `location.href`
 * poll — a content script can't intercept the page's own
 * `history.pushState` directly), or returning to the tab resets the
 * cadence so freshly revealed content (lazy-load, infinite scroll, a new
 * chapter) is picked up promptly.
 *
 * Only standard Web APIs (`setTimeout`, `window`, `location`) — no
 * `chrome`/`browser` imports, so this lives in `src/engine/`.
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
}

export function createResweepScheduler(options: ResweepOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = RESWEEP_MIN_MS;
  let started = false;
  let lastHref = location.href;

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

  function start(): void {
    if (started) {
      bump();
      return;
    }
    started = true;

    let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener(
      'scroll',
      () => {
        if (!options.isTranslated()) return;
        if (scrollDebounce) clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(bump, 400);
      },
      { passive: true },
    );
    window.addEventListener('popstate', () => {
      if (options.isTranslated()) bump();
    });

    timer = setTimeout(run, delay);
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    started = false;
  }

  return { start, stop, bump };
}

export type ResweepScheduler = ReturnType<typeof createResweepScheduler>;
