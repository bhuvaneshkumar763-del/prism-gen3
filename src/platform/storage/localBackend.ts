import type { StorageBackend, StorageChange } from './types';

/**
 * `browser.storage.local`, the only backend. `storage.sync` is deliberately
 * not implemented; see docs/decisions/0003-settings-sync-deferred.md.
 */
export const localStorageBackend: StorageBackend = {
  async getAll() {
    return browser.storage.local.get(null);
  },
  async set(entries) {
    await browser.storage.local.set(entries);
  },
  async remove(keys) {
    if (keys.length === 0) return;
    await browser.storage.local.remove(keys);
  },
  onChanged(callback) {
    const listener = (changes: Record<string, StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      callback(changes);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  },
};
