/**
 * Online/offline awareness from `navigator.onLine` and its events, used to
 * skip known-futile work (radio off, airplane mode) and react to reconnects.
 * `onLine` can be a false positive (captive portal); the normal fetch-failure
 * path still handles that.
 */

export interface ConnectivityWatcher {
  isOnline(): boolean;
  /** Registers a callback for online/offline transitions. Returns an unsubscribe function. */
  onChange(cb: (online: boolean) => void): () => void;
}

export function createConnectivityWatcher(): ConnectivityWatcher {
  const listeners = new Set<(online: boolean) => void>();

  function isOnline(): boolean {
    // Where `navigator.onLine` is absent (tests/SSR), treat it as online so
    // this never blocks a request.
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function notify(online: boolean): void {
    listeners.forEach((cb) => {
      cb(online);
    });
  }

  // `globalThis`, not `window`: an MV3 service worker has no `window`.
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

/** Shared per-realm singleton, so every caller in a realm agrees on one state. */
export const connectivity = createConnectivityWatcher();
