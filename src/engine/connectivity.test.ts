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
    const listeners: Record<string, Array<() => void>> = { online: [], offline: [] };
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(cb);
      },
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
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(cb);
      },
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
});
