/**
 * The storage-adapter port: `configStore.ts` depends on this, never on
 * `browser.storage` directly, so a new backend is one new implementation.
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
