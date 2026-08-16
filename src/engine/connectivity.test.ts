import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectivityWatcher } from './connectivity';

describe('createConnectivityWatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports online by default (navigator.onLine true)', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const watcher = createConnectivityWatcher();
    expect(watcher.isOnline()).toBe(true);
  });

  it('reports offline when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const watcher = createConnectivityWatcher();
    expect(watcher.isOnline()).toBe(false);
  });

  it('treats a missing navigator as online rather than blocking requests', () => {
    vi.stubGlobal('navigator', undefined);
    const watcher = createConnectivityWatcher();
    expect(watcher.isOnline()).toBe(true);
  });

  it('notifies subscribers on a real online/offline window event', () => {
    // Stubbed on globalThis directly, not a separate `window` object — in a
    // real browser/content-script realm `window === globalThis`, and (per
    // the MV3-service-worker fix below) this module now registers via
    // `globalThis.addEventListener` specifically so it also works in a
    // realm that has no `window` at all.
    const listeners: Record<string, Array<() => void>> = { online: [], offline: [] };
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('addEventListener', (type: string, cb: () => void) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    });

    const watcher = createConnectivityWatcher();
    const seen: boolean[] = [];
    watcher.onChange((online) => seen.push(online));

    listeners.offline?.forEach((cb) => {
      cb();
    });
    listeners.online?.forEach((cb) => {
      cb();
    });

    expect(seen).toEqual([false, true]);
  });

  it('unsubscribe stops future notifications', () => {
    const listeners: Record<string, Array<() => void>> = { online: [], offline: [] };
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('addEventListener', (type: string, cb: () => void) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    });

    const watcher = createConnectivityWatcher();
    const seen: boolean[] = [];
    const unsubscribe = watcher.onChange((online) => seen.push(online));
    unsubscribe();

    listeners.offline?.forEach((cb) => {
      cb();
    });

    expect(seen).toEqual([]);
  });

  it('registers online/offline listeners even in a realm with no `window` (an MV3 service worker)', () => {
    // Regression: this module used to gate registration on `typeof window
    // !== 'undefined'`, which is never true in a service worker (it has
    // `self`, not `window`) — the listeners silently never registered there.
    const listeners: Record<string, Array<() => void>> = { online: [], offline: [] };
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('addEventListener', (type: string, cb: () => void) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    });

    const watcher = createConnectivityWatcher();
    const seen: boolean[] = [];
    watcher.onChange((online) => seen.push(online));

    listeners.offline?.forEach((cb) => {
      cb();
    });

    expect(seen).toEqual([false]);
  });
});
