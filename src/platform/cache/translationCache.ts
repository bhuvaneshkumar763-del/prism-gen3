/**
 * IndexedDB-backed translation cache: one database, one object store, keyed
 * by provider + language pair + text, size-budgeted with oldest-first eviction
 * and a maximum entry age.
 * A single store keeps eviction to one cursor walk, at the cost of not being
 * able to cheaply drop one language pair's entries.
 *
 * The byte total is a record in the database, updated in the same
 * transaction as every write, eviction and clear, so every context (the
 * background, the Settings page) sees and maintains the same figure.
 *
 * The connection is opened lazily and reused; the browser may close it at any
 * time (common on mobile), so `close` resets it and `withDb()` retries once.
 */

const DB_NAME = 'prism-translation-cache';
const DB_VERSION = 2;
const STORE_NAME = 'entries';
const LAST_USED_INDEX = 'lastUsed';
/** Holds the byte total under TOTAL_BYTES_KEY. */
const META_STORE_NAME = 'meta';
const TOTAL_BYTES_KEY = 'totalBytes';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
/** Translations are re-fetched after this, so a provider's improvements reach cached pages. */
export const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheRecord {
  key: string;
  value: string;
  size: number;
  lastUsed: number;
  /** When the value was written. Missing on entries from database version 1. */
  storedAt?: number;
}

function isExpired(record: CacheRecord, now: number): boolean {
  return now - (record.storedAt ?? record.lastUsed) > MAX_ENTRY_AGE_MS;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex(LAST_USED_INDEX, LAST_USED_INDEX);
      }
      // Left empty: the first write counts the existing entries once.
      if (!db.objectStoreNames.contains(META_STORE_NAME)) db.createObjectStore(META_STORE_NAME);
    };
    request.onsuccess = () => {
      // Already given up on (see onblocked): don't keep a connection nobody uses.
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error);
    };
    // An older connection that ignores versionchange holds up the upgrade
    // until it closes. The cache is optional, so give up instead of making
    // the translation wait; the next call tries again.
    request.onblocked = () => {
      settled = true;
      reject(new Error('translation cache upgrade blocked by another open connection'));
    };
  });
}

/** Settles when `tx` commits, and rejects on an error or an abort (a commit-time quota failure fires only `abort`). */
function whenDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject((event.target as IDBRequest | null)?.error ?? tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/** Rough UTF-16 byte size estimate — exactness doesn't matter for a soft eviction budget. */
function estimateSize(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

/** Adds up every entry's size with one cursor walk inside `store`'s transaction. */
function sumSizes(store: IDBObjectStore, then: (total: number) => void): void {
  let total = 0;
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      then(total);
      return;
    }
    total += (cursor.value as CacheRecord).size;
    cursor.continue();
  };
}

/** Reads the stored byte total in `tx`, counting the entries once when there's no record yet. */
function readTotal(tx: IDBTransaction, then: (total: number) => void): void {
  const request = tx.objectStore(META_STORE_NAME).get(TOTAL_BYTES_KEY);
  request.onsuccess = () => {
    if (typeof request.result === 'number') then(request.result);
    else sumSizes(tx.objectStore(STORE_NAME), then);
  };
}

function writeTotal(tx: IDBTransaction, total: number): void {
  tx.objectStore(META_STORE_NAME).put(Math.max(0, total), TOTAL_BYTES_KEY);
}

/**
 * Inside `tx`: deletes expired entries, then the least recently used, until
 * the total fits `maxBytes`, and stores the new total. Walks the `lastUsed`
 * index, so an expired entry read recently is reached only under budget
 * pressure; reads treat it as a miss and its re-translation overwrites it.
 */
function evictAndWriteTotal(tx: IDBTransaction, total: number, maxBytes: number, now: number): void {
  let remaining = total;
  const cursorRequest = tx.objectStore(STORE_NAME).index(LAST_USED_INDEX).openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    // Past the last entry everything has been deleted, so the total is 0
    // whatever the record said.
    if (!cursor) {
      writeTotal(tx, 0);
      return;
    }
    const record = cursor.value as CacheRecord;
    if (remaining <= maxBytes && !isExpired(record, now)) {
      writeTotal(tx, remaining);
      return;
    }
    remaining -= record.size;
    cursor.delete();
    cursor.continue();
  };
}

export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Reads the whole batch in one IndexedDB transaction. */
  getMany(keys: string[]): Promise<Array<string | null>>;
  /** Writes the whole batch and runs one eviction pass, in one IndexedDB transaction. */
  setMany(entries: Array<{ key: string; value: string }>): Promise<void>;
  getSizeBytes(): Promise<number>;
  evictUntilUnderBudget(maxBytes?: number): Promise<void>;
  clear(): Promise<void>;
}

export function createTranslationCache(defaultMaxBytes: number = DEFAULT_MAX_BYTES): TranslationCache {
  let dbPromise: Promise<IDBDatabase> | null = null;
  /** The connection `dbPromise` resolved to, so a failed operation can tell whether it's still the current one. */
  let currentDb: IDBDatabase | null = null;
  /** Shares one in-flight `getSizeBytes()` count across concurrent callers. */
  let sizeScanInFlight: Promise<number> | null = null;

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      const opening = openDb().then((db) => {
        const forget = () => {
          if (dbPromise === opening) dbPromise = null;
          if (currentDb === db) currentDb = null;
          // A count on the dead connection will reject; callers on the next
          // connection shouldn't inherit that failure.
          sizeScanInFlight = null;
        };
        // The browser can close this connection at any time. Reset so the
        // next call reopens.
        db.addEventListener('close', forget);
        // Another context needs to upgrade the database: step aside rather
        // than block it. The next call reopens (and fails if it's now newer).
        db.onversionchange = () => {
          db.close();
          forget();
        };
        currentDb = db;
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
      // Close the failed connection rather than just dropping it, and only
      // forget it if a concurrent retry hasn't already replaced it.
      db.close();
      if (currentDb === db) {
        currentDb = null;
        dbPromise = null;
        sizeScanInFlight = null;
      }
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

  /**
   * Batched `get()`. Reads run in a `readonly` transaction and resolve as soon
   * as they finish; the recency touch is a separate, un-awaited `readwrite`
   * transaction so a warm-cache read never waits on a write.
   */
  async function getMany(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    return withDb(
      async (db) => {
        const now = Date.now();
        const hits: CacheRecord[] = [];
        const results: Array<string | null> = new Array(keys.length).fill(null);
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        keys.forEach((key, i) => {
          const request = store.get(key);
          request.onsuccess = () => {
            const record = request.result as CacheRecord | undefined;
            if (!record || isExpired(record, now)) return; // stays null — a miss
            results[i] = record.value;
            hits.push(record);
          };
        });
        await whenDone(tx);
        if (hits.length > 0) touchLastUsed(db, hits);
        return results;
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
   * Batched `set()`: the writes, the size-total update and one eviction pass
   * share one transaction, so a concurrent write or eviction in any context
   * runs before or after it, never in between.
   */
  async function setMany(entries: Array<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) return;
    // Last value wins for a key repeated in the batch, as it would on disk.
    const values = new Map(entries.map(({ key, value }) => [key, value]));
    await withDb((db) => {
      const now = Date.now();
      const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      readTotal(tx, (total) => {
        let running = total;
        let pending = values.size;
        values.forEach((value, key) => {
          const size = estimateSize(key, value);
          const existingRequest = store.get(key);
          existingRequest.onsuccess = () => {
            running += size - ((existingRequest.result as CacheRecord | undefined)?.size ?? 0);
            store.put({ key, value, size, lastUsed: now, storedAt: now } satisfies CacheRecord);
            pending--;
            if (pending === 0) evictAndWriteTotal(tx, running, defaultMaxBytes, now);
          };
        });
      });
      return whenDone(tx);
    }, treatAsMiss(undefined));
  }

  async function set(key: string, value: string): Promise<void> {
    await setMany([{ key, value }]);
  }

  /** Counted from the entries themselves rather than the stored total, for the figure Settings shows. */
  async function getSizeBytes(): Promise<number> {
    return withDb((db) => {
      if (!sizeScanInFlight) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        let total = 0;
        sumSizes(tx.objectStore(STORE_NAME), (sum) => {
          total = sum;
        });
        const scan = whenDone(tx).then(() => total);
        const reset = () => {
          if (sizeScanInFlight === scan) sizeScanInFlight = null;
        };
        scan.then(reset, reset);
        sizeScanInFlight = scan;
      }
      return sizeScanInFlight;
    }, rethrow);
  }

  async function evictUntilUnderBudget(maxBytes: number = defaultMaxBytes): Promise<void> {
    await withDb((db) => {
      const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      readTotal(tx, (total) => evictAndWriteTotal(tx, total, maxBytes, Date.now()));
      return whenDone(tx);
    }, treatAsMiss(undefined));
  }

  async function clear(): Promise<void> {
    await withDb((db) => {
      const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      writeTotal(tx, 0);
      return whenDone(tx);
    }, rethrow);
  }

  return { get, set, getMany, setMany, getSizeBytes, evictUntilUnderBudget, clear };
}

export const translationCache = createTranslationCache();

/** Builds a cache key from the provider/language-pair/text tuple every cache-touching call site needs. */
export function cacheKeyFor(providerId: string, sourceLanguage: string, targetLanguage: string, text: string): string {
  return `${providerId}>${sourceLanguage}>${targetLanguage}:${text}`;
}
