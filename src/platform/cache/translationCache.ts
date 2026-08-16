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
 *
 * Post-launch speed pass: this used to open and close a fresh IndexedDB
 * connection on EVERY `get()`/`set()` call, and `set()` unconditionally ran
 * a full cursor-scan eviction sweep on every write — real, measured cost on
 * the critical path of every translated piece, every tick (see the CLAUDE.md
 * writeup for the investigation). Fixed two ways: (1) the connection is now
 * opened once, lazily, and kept alive for the life of this cache instance
 * — every call reuses it; (2) instead of debouncing eviction to "every N
 * writes" (which would make eviction non-deterministic and break the
 * existing recency/budget tests below, which rely on eviction happening
 * exactly when a write pushes the store over budget), an in-memory running
 * total is maintained and updated incrementally on every write/eviction —
 * `evictUntilUnderBudget()` checks that O(1) counter instead of re-scanning
 * the whole store, and only pays for a real cursor scan once, lazily, the
 * first time any method is called on a given instance (to seed the counter
 * from whatever's already persisted from a prior session).
 *
 * Real regression that speed pass introduced, found via a user report (not
 * caught by the earlier verification — that ran on desktop Chrome, which
 * doesn't reclaim idle IndexedDB connections nearly as aggressively as
 * mobile does): keeping ONE connection alive for the life of the module
 * means the browser can close it out from under us at any time (memory
 * pressure, low storage — far more common on mobile). Every call after
 * that kept trying to open a transaction on the now-dead connection,
 * surfacing as "Attempt to get a record from database without an
 * in-progress transaction" on every single translate for the rest of that
 * context's lifetime — the old always-open-fresh/always-close design never
 * kept a connection around long enough to hit this at all. Fixed with
 * `db.onclose` (resets the cached connection promise so the NEXT call
 * transparently reopens) plus `withDb()`'s one-retry-on-failure wrapper
 * (covers the race where the connection closes between `getDb()`
 * resolving and the transaction actually being created, since `onclose`
 * fires asynchronously).
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
  /** One IndexedDB transaction for the whole batch instead of one per key — see getMany's doc comment. */
  getMany(keys: string[]): Promise<Array<string | null>>;
  /** One IndexedDB transaction (and one eviction pass) for the whole batch instead of one per key — see setMany's doc comment. */
  setMany(entries: Array<{ key: string; value: string }>): Promise<void>;
  getSizeBytes(): Promise<number>;
  evictUntilUnderBudget(maxBytes?: number): Promise<void>;
  clear(): Promise<void>;
}

export function createTranslationCache(defaultMaxBytes: number = DEFAULT_MAX_BYTES): TranslationCache {
  let dbPromise: Promise<IDBDatabase> | null = null;
  /** Seeded lazily (once) from a real scan, then kept accurate incrementally — see the module header comment. */
  let runningTotalBytes: number | null = null;
  /**
   * Shares one in-flight `scanTotalBytes()` scan across concurrent callers
   * instead of each starting its own — without this, two `set()` calls
   * landing before the first scan resolves (e.g. a batch of cache misses
   * written via `Promise.all`) would each independently scan and then
   * independently overwrite `runningTotalBytes`, silently dropping
   * whichever one finished first.
   */
  let scanInFlight: Promise<number> | null = null;

  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDb().then((db) => {
        // The browser can close this connection at any time (memory
        // pressure, low storage) — reset the cached promise so the NEXT
        // call transparently reopens instead of every future call failing
        // for the rest of this context's lifetime. The running total is
        // also invalidated: a reopened connection may reflect state from
        // after other contexts wrote to it while this one was closed.
        db.addEventListener('close', () => {
          dbPromise = null;
          runningTotalBytes = null;
          // A scan in flight against the now-dead connection is doomed to
          // reject, but scanInFlight itself isn't cleared until that
          // rejection's own .finally() runs. A caller that calls
          // ensureRunningTotal() against the newly-reopened connection in
          // that window would otherwise see scanInFlight still set and
          // await — inheriting the OLD scan's failure even though a healthy
          // new connection now exists.
          scanInFlight = null;
        });
        return db;
      });
    }
    return dbPromise;
  }

  /**
   * Runs `operation` against a live connection, retrying ONCE with a fresh
   * connection if it fails. Covers the race where the connection closes
   * between `getDb()` resolving and the transaction actually being
   * created — `db.onclose` above only handles reopening on the NEXT call,
   * not a connection that dies mid-flight during THIS one.
   */
  async function withDb<T>(operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await getDb();
    try {
      return await operation(db);
    } catch (e) {
      console.warn('[prism] translation cache operation failed, retrying with a fresh connection', e);
      dbPromise = null;
      const freshDb = await getDb();
      return operation(freshDb);
    }
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
   * One IndexedDB transaction for the whole key list, instead of `keys.map(get)`
   * opening one transaction per key — a translatePieces tick with ~40 cache
   * lookups paid for ~40 separate transaction setups/commits for what's
   * conceptually one read. Same recency-touch and miss-on-failure behavior
   * as `get()`, just batched.
   */
  async function getMany(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    return withDb(
      (db) =>
        new Promise<Array<string | null>>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const results: Array<string | null> = new Array(keys.length).fill(null);
          keys.forEach((key, i) => {
            const request = store.get(key);
            request.onsuccess = () => {
              const record = request.result as CacheRecord | undefined;
              if (!record) return; // stays null — a real cache miss
              results[i] = record.value;
              // Touch lastUsed so oldest-first eviction reflects real
              // recency, not just insertion order. Best-effort, like get()'s
              // single-key touch — logged, not fatal to the read.
              const touchRequest = store.put({ ...record, lastUsed: Date.now() });
              touchRequest.onerror = () => {
                console.warn('[prism] translation cache recency touch failed', touchRequest.error);
              };
            };
          });
          tx.oncomplete = () => resolve(results);
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  async function get(key: string): Promise<string | null> {
    const [value] = await getMany([key]);
    return value ?? null;
  }

  /**
   * One IndexedDB transaction (and one `evictUntilUnderBudget()` eviction
   * pass) for the whole batch, instead of one transaction-pair-plus-eviction
   * PER entry — `set()`'s old per-key path was the dominant cost of a
   * translatePieces tick with several cache misses (up to 2N transactions
   * for N fresh pieces). Resolves on tx.oncomplete, same reasoning as the
   * single-key set() this replaces: crediting the byte counter before the
   * write is actually confirmed lets a failed write (e.g. quota exceeded)
   * drift the counter from what's really on disk.
   */
  async function setMany(entries: Array<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) return;
    await withDb(async (db) => {
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
    });
    await evictUntilUnderBudget(defaultMaxBytes);
  }

  async function set(key: string, value: string): Promise<void> {
    await setMany([{ key, value }]);
  }

  async function getSizeBytes(): Promise<number> {
    return withDb((db) => ensureRunningTotal(db));
  }

  async function evictUntilUnderBudget(maxBytes: number = defaultMaxBytes): Promise<void> {
    await withDb(async (db) => {
      const total = await ensureRunningTotal(db);
      if (total <= maxBytes) return;

      // Track the walk's progress locally and only commit it to
      // runningTotalBytes once tx.oncomplete confirms every delete in this
      // walk actually landed — cursor.delete() has no error handler of its
      // own, and an aborted transaction rolls back every delete performed in
      // it (including earlier ones in the same walk) without undoing any
      // JS-side decrement already applied. Decrementing eagerly, per
      // cursor.delete() call, let a mid-walk failure permanently under-count
      // the real total.
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
    });
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
