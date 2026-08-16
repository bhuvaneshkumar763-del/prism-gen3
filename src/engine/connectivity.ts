/**
 * Connectivity awareness — engine-pure (only `navigator.onLine` and
 * `window.addEventListener('online'/'offline', ...)`, standard Web APIs,
 * no `chrome`/`browser` imports), so it lives in `src/engine/` per the
 * purity boundary.
 *
 * Real gap this closes: before this file existed, nothing in this codebase
 * had any connectivity awareness at all — a page with no internet burned
 * through `batchedHttpProvider.ts`'s full retry budget (3 attempts, up to
 * ~1.6s of sleeping) on every single doomed request, and `translateLoop.ts`
 * kept dispatching new batches every tick regardless, all guaranteed to
 * fail the same way. Reconnection was only ever noticed on the next
 * scheduled tick (up to 8s away once an error had surfaced), not
 * immediately.
 *
 * `navigator.onLine` has a real, known limitation: it can report `true` on
 * a captive portal or a connection that's technically "up" but not actually
 * reaching the internet (false positive). This module does not attempt to
 * work around that — it only exists to skip *known-futile* work in the
 * common case (radio off, cable unplugged, airplane mode), and the
 * existing fetch-failure/retry path in `batchedHttpProvider.ts` remains the
 * correct fallback for the false-positive case, exactly as it already
 * handles every other kind of request failure.
 *
 * One shared singleton (`connectivity`) rather than a factory per call site —
 * every caller within the SAME realm agrees on one online/offline state
 * instead of each maintaining its own `online`/`offline` listener that could
 * momentarily disagree. (Note: `batchedHttpProvider.ts` and `translateLoop.ts`
 * actually run in different realms — the provider in the MV3 background
 * service worker, the loop in the content script — so they're already
 * separate module instances regardless; the singleton's value is within each
 * realm, not across the two.)
 */

export interface ConnectivityWatcher {
  isOnline(): boolean;
  /** Registers a callback for online/offline transitions. Returns an unsubscribe function. */
  onChange(cb: (online: boolean) => void): () => void;
}

export function createConnectivityWatcher(): ConnectivityWatcher {
  const listeners = new Set<(online: boolean) => void>();

  function isOnline(): boolean {
    // `navigator.onLine` is undefined in some non-browser test/SSR
    // environments — treat "unknown" as online so this never blocks a
    // request in a context where the API simply isn't present, rather
    // than defaulting to the more surprising "always looks offline."
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function notify(online: boolean): void {
    listeners.forEach((cb) => {
      cb(online);
    });
  }

  // `globalThis`, not `window`: an MV3 service worker has no `window` (it
  // has `self`), so this previously never registered there at all — harmless
  // today since only `isOnline()` is read in that realm, but silently inert
  // the moment anything in the background subscribes via onChange().
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('online', () => notify(true));
    globalThis.addEventListener('offline', () => notify(false));
  }

  return {
    isOnline,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Shared singleton — see this file's header comment for why this isn't a per-caller factory. */
export const connectivity = createConnectivityWatcher();
