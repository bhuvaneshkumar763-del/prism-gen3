/**
 * IndexedDB-backed translation cache: one database, one object store, keyed
 * by provider + language pair + text, size-budgeted with oldest-first eviction.
 * A single store keeps eviction to one cursor scan, at the cost of not being
 * able to cheaply drop one language pair's entries.
 *
 * The connection is opened lazily and reused; the browser may close it at any
 * time (common on mobile), so `close` resets it and `withDb()` retries once.
 * The byte total is seeded by one scan, then maintained incrementally.
 */

const DB_NAME = 'prism-translation-cache';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const LAST_USED_INDEX = 'lastUsed';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

interface CacheRecord {
  key: string;
  value: string;
  size: number;
  lastUsed: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex(LAST_USED_INDEX, LAST_USED_INDEX);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Rough UTF-16 byte size estimate — exactness doesn't matter for a soft eviction budget. */
function estimateSize(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

function scanTotalBytes(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const cursorRequest = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      total += (cursor.value as CacheRecord).size;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Reads the whole batch in one IndexedDB transaction. */
  getMany(keys: string[]): Promise<Array<string | null>>;
  /** Writes the whole batch in one IndexedDB transaction, then runs one eviction pass. */
  setMany(entries: Array<{ key: string; value: string }>): Promise<void>;
  getSizeBytes(): Promise<number>;
  evictUntilUnderBudget(maxBytes?: number): Promise<void>;
  clear(): Promise<void>;
}

export function createTranslationCache(defaultMaxBytes: number = DEFAULT_MAX_BYTES): TranslationCache {
  let dbPromise: Promise<IDBDatabase> | null = null;
  /** Seeded lazily from one scan, then kept accurate incrementally; null means "rescan". */
  let runningTotalBytes: number | null = null;
  /**
   * Shares one in-flight scan across concurrent callers, so parallel writes
   * don't each scan and overwrite `runningTotalBytes` with a stale result.
   */
  let scanInFlight: Promise<number> | null = null;

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      const opening = openDb().then((db) => {
        // The browser can close this connection at any time. Reset so the
        // next call reopens, and drop the total: other contexts may have
        // written while this one was closed.
        db.addEventListener('close', () => {
          dbPromise = null;
          runningTotalBytes = null;
          // A scan on the dead connection will reject, but scanInFlight is
          // only cleared in its .finally(); clear it now so callers on the
          // reopened connection don't inherit that failure.
          scanInFlight = null;
        });
        return db;
      });
      // Forget a failed open so one transient failure doesn't turn the
      // cache off until the background restarts; the next call retries.
      opening.catch(() => {
        if (dbPromise === opening) dbPromise = null;
      });
      dbPromise = opening;
    }
    return dbPromise;
  }

  /**
   * Runs `operation`, retrying once on a fresh connection. Covers a connection
   * that closes between `getDb()` resolving and the transaction starting,
   * which the `close` listener alone can't catch. A failed open, first or on
   * the retry, goes to `onOpenFailure`.
   */
  async function withDb<T>(
    operation: (db: IDBDatabase) => Promise<T>,
    onOpenFailure: (error: unknown) => T,
  ): Promise<T> {
    let db: IDBDatabase;
    try {
      db = await getDb();
    } catch (e) {
      return onOpenFailure(e);
    }
    try {
      return await operation(db);
    } catch (e) {
      console.warn('[prism] translation cache operation failed, retrying with a fresh connection', e);
      dbPromise = null;
      let freshDb: IDBDatabase;
      try {
        freshDb = await getDb();
      } catch (openError) {
        return onOpenFailure(openError);
      }
      return operation(freshDb);
    }
  }

  /** The cache is best-effort: on the translation path a failed open is a miss or a no-op, never an error. */
  function treatAsMiss<T>(fallback: T): (error: unknown) => T {
    return (error) => {
      console.warn('[prism] translation cache unavailable, continuing without it', error);
      return fallback;
    };
  }

  /** For `clear` and `getSizeBytes`, whose callers show the failure to the user. */
  function rethrow(error: unknown): never {
    throw error;
  }

  async function ensureRunningTotal(db: IDBDatabase): Promise<number> {
    if (runningTotalBytes !== null) return runningTotalBytes;
    if (!scanInFlight) {
      scanInFlight = scanTotalBytes(db).finally(() => {
        scanInFlight = null;
      });
    }
    const total = await scanInFlight;
    runningTotalBytes = total;
    return total;
  }

  /**
   * Batched `get()`. Reads run in a `readonly` transaction and resolve as soon
   * as they finish; the recency touch is a separate, un-awaited `readwrite`
   * transaction so a warm-cache read never waits on a write.
   */
  async function getMany(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    return withDb(
      (db) => {
        const hits: CacheRecord[] = [];
        return new Promise<Array<string | null>>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const results: Array<string | null> = new Array(keys.length).fill(null);
          keys.forEach((key, i) => {
            const request = store.get(key);
            request.onsuccess = () => {
              const record = request.result as CacheRecord | undefined;
              if (!record) return; // stays null — a real cache miss
              results[i] = record.value;
              hits.push(record);
            };
          });
          tx.oncomplete = () => resolve(results);
          tx.onerror = () => reject(tx.error);
        }).then((results) => {
          if (hits.length > 0) touchLastUsed(db, hits);
          return results;
        });
      },
      treatAsMiss(new Array<string | null>(keys.length).fill(null)),
    );
  }

  /**
   * How stale `lastUsed` must be before a hit is re-written. Eviction only
   * needs rough recency, and skipping fresh hits avoids re-writing every
   * cached value on each warm-cache page load.
   */
  const LAST_USED_TOUCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Fire-and-forget: bumps `lastUsed` so eviction reflects real recency. A
   * failure only makes that entry an earlier eviction candidate, so it's
   * logged rather than surfaced.
   */
  function touchLastUsed(db: IDBDatabase, hits: CacheRecord[]): void {
    const now = Date.now();
    const stale = hits.filter((record) => now - record.lastUsed >= LAST_USED_TOUCH_INTERVAL_MS);
    if (stale.length === 0) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      stale.forEach((record) => {
        store.put({ ...record, lastUsed: now });
      });
      tx.onerror = () => {
        console.warn('[prism] translation cache recency touch failed', tx.error);
      };
    } catch (e) {
      console.warn('[prism] translation cache recency touch failed', e);
    }
  }

  async function get(key: string): Promise<string | null> {
    const [value] = await getMany([key]);
    return value ?? null;
  }

  /**
   * Batched `set()`: one transaction and one eviction pass for the whole batch.
   * The byte counter is credited only after tx.oncomplete, so a failed write
   * (e.g. quota exceeded) can't drift it from what's on disk.
   */
  async function setMany(entries: Array<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) return;
    const written = await withDb(async (db) => {
      await ensureRunningTotal(db);
      const sizes = entries.map(({ key, value }) => estimateSize(key, value));

      const previousSizes = await new Promise<number[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const existingSizes: number[] = new Array(entries.length).fill(0);
        entries.forEach(({ key, value }, i) => {
          const getRequest = store.get(key);
          getRequest.onsuccess = () => {
            const existing = getRequest.result as CacheRecord | undefined;
            existingSizes[i] = existing?.size ?? 0;
            store.put({ key, value, size: sizes[i] ?? 0, lastUsed: Date.now() });
          };
          getRequest.onerror = () => reject(getRequest.error);
        });
        tx.oncomplete = () => resolve(existingSizes);
        tx.onerror = () => reject(tx.error);
      });

      const delta = sizes.reduce((sum, size, i) => sum + size - (previousSizes[i] ?? 0), 0);
      runningTotalBytes = (runningTotalBytes ?? 0) + delta;
      return true;
    }, treatAsMiss(false));
    if (written) await evictUntilUnderBudget(defaultMaxBytes);
  }

  async function set(key: string, value: string): Promise<void> {
    await setMany([{ key, value }]);
  }

  async function getSizeBytes(): Promise<number> {
    return withDb((db) => ensureRunningTotal(db), rethrow);
  }

  async function evictUntilUnderBudget(maxBytes: number = defaultMaxBytes): Promise<void> {
    await withDb(async (db) => {
      const total = await ensureRunningTotal(db);
      if (total <= maxBytes) return;

      // Commit the decrement only after tx.oncomplete: cursor.delete() has no
      // error handler, and an aborted transaction rolls back every delete in
      // the walk without undoing a JS-side decrement.
      let remaining = total;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index(LAST_USED_INDEX);
        const evictCursorRequest = index.openCursor();
        evictCursorRequest.onsuccess = () => {
          const cursor = evictCursorRequest.result;
          if (!cursor || remaining <= maxBytes) return; // let the transaction complete
          remaining -= (cursor.value as CacheRecord).size;
          cursor.delete();
          cursor.continue();
        };
        evictCursorRequest.onerror = () => reject(evictCursorRequest.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      runningTotalBytes = remaining;
    }, treatAsMiss(undefined));
  }

  async function clear(): Promise<void> {
    await withDb(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
      rethrow,
    );
    runningTotalBytes = 0;
  }

  return { get, set, getMany, setMany, getSizeBytes, evictUntilUnderBudget, clear };
}

export const translationCache = createTranslationCache();

/** Builds a cache key from the provider/language-pair/text tuple every cache-touching call site needs. */
export function cacheKeyFor(providerId: string, sourceLanguage: string, targetLanguage: string, text: string): string {
  return `${providerId}>${sourceLanguage}>${targetLanguage}:${text}`;
}
