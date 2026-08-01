/**
 * The storage-adapter port (Gen 3 plan, Session 3's settings-sync
 * decision): `configStore.ts` depends on this interface, never on
 * `browser.storage` directly. Swapping backends — local (the only one
 * implemented so far), a future sync backend, a future account-based sync
 * — is one new file implementing this interface, not a rewrite of the
 * config store itself.
 */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StorageBackend {
  getAll(): Promise<Record<string, unknown>>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Returns an unsubscribe function. Fires for changes from ANY context, including this one's own writes. */
  onChanged(callback: (changes: Record<string, StorageChange>) => void): () => void;
}
