/**
 * IndexedDB-backed translation cache — avoids re-requesting a translation
 * for text this extension has already translated (identical provider +
 * source + target language + text), size-budgeted with oldest-first
 * eviction so it can't grow unbounded on a heavy browsing session.
 *
 * Deliberately simpler than the old repo's per-(service, sourceLanguage,
 * targetLanguage) database-per-triple design (`getDataBaseName` + a
 * separate `cacheList` database to enumerate them, since
 * `indexedDB.databases()` isn't implemented everywhere): one database, one
 * object store, the triple folded into the cache key by the caller. Real
 * engineering trade-off, not a corner cut — a single store makes
 * size-budget eviction a single cursor scan instead of a fan-out across N
 * per-triple databases, at the cost of not being able to cheaply drop just
 * one language pair's entries (not a real use case this project has).
 *
 * Standard Web APIs only (`indexedDB`) — no `chrome`/`browser` — but lives
 * in `src/platform/` rather than `src/engine/` anyway: it's an I/O
 * side-effecting adapter over a specific storage backend, the same category
 * of thing `src/platform/storage/localBackend.ts` already is, not
 * translation-domain logic.
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

export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getSizeBytes(): Promise<number>;
  evictUntilUnderBudget(maxBytes?: number): Promise<void>;
  clear(): Promise<void>;
}

export function createTranslationCache(defaultMaxBytes: number = DEFAULT_MAX_BYTES): TranslationCache {
  async function get(key: string): Promise<string | null> {
    const db = await openDb();
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as CacheRecord | undefined;
          if (!record) {
            resolve(null);
            return;
          }
          // Touch lastUsed so oldest-first eviction reflects real recency,
          // not just insertion order.
          store.put({ ...record, lastUsed: Date.now() });
          resolve(record.value);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async function set(key: string, value: string): Promise<void> {
    const db = await openDb();
    try {
      const record: CacheRecord = { key, value, size: estimateSize(key, value), lastUsed: Date.now() };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    await evictUntilUnderBudget(defaultMaxBytes);
  }

  async function getSizeBytes(): Promise<number> {
    const db = await openDb();
    try {
      return await new Promise<number>((resolve, reject) => {
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
    } finally {
      db.close();
    }
  }

  async function evictUntilUnderBudget(maxBytes: number = defaultMaxBytes): Promise<void> {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        let total = 0;
        const sizeRequest = store.openCursor();
        sizeRequest.onsuccess = () => {
          const cursor = sizeRequest.result;
          if (cursor) {
            total += (cursor.value as CacheRecord).size;
            cursor.continue();
            return;
          }
          if (total <= maxBytes) {
            resolve();
            return;
          }
          // Oldest-first eviction, via the lastUsed index.
          const index = store.index(LAST_USED_INDEX);
          const evictCursorRequest = index.openCursor();
          evictCursorRequest.onsuccess = () => {
            const evictCursor = evictCursorRequest.result;
            if (!evictCursor || total <= maxBytes) {
              resolve();
              return;
            }
            total -= (evictCursor.value as CacheRecord).size;
            evictCursor.delete();
            evictCursor.continue();
          };
          evictCursorRequest.onerror = () => reject(evictCursorRequest.error);
        };
        sizeRequest.onerror = () => reject(sizeRequest.error);
      });
    } finally {
      db.close();
    }
  }

  async function clear(): Promise<void> {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  return { get, set, getSizeBytes, evictUntilUnderBudget, clear };
}

export const translationCache = createTranslationCache();

/** Builds a cache key from the provider/language-pair/text tuple every cache-touching call site needs. */
export function cacheKeyFor(providerId: string, sourceLanguage: string, targetLanguage: string, text: string): string {
  return `${providerId}>${sourceLanguage}>${targetLanguage}:${text}`;
}
