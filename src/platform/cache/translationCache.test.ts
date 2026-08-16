import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKeyFor, createTranslationCache } from './translationCache';

describe('translationCache', () => {
  beforeEach(() => {
    // Fresh in-memory IndexedDB per test — fake-indexeddb persists across
    // tests in the same file otherwise, which would leak cache entries
    // between what should be independent test cases.
    globalThis.indexedDB = new IDBFactory();
  });

  it('returns null for a key that was never set', async () => {
    const cache = createTranslationCache();
    expect(await cache.get('missing')).toBeNull();
  });

  it('returns a value that was set', async () => {
    const cache = createTranslationCache();
    await cache.set('hello', 'hola');
    expect(await cache.get('hello')).toBe('hola');
  });

  it('overwrites an existing value on a second set() for the same key', async () => {
    const cache = createTranslationCache();
    await cache.set('hello', 'hola');
    await cache.set('hello', 'hola mundo');
    expect(await cache.get('hello')).toBe('hola mundo');
  });

  it("getMany() returns each key's value in the same order, null for a miss", async () => {
    const cache = createTranslationCache();
    await cache.set('a', '1');
    await cache.set('c', '3');

    expect(await cache.getMany(['a', 'missing', 'c'])).toEqual(['1', null, '3']);
  });

  it('getMany() returns one entry per key even for an empty key list', async () => {
    const cache = createTranslationCache();
    expect(await cache.getMany([])).toEqual([]);
  });

  it('setMany() writes every entry in one transaction — get() and getMany() see all of them afterward', async () => {
    const cache = createTranslationCache();
    await cache.setMany([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ]);

    expect(await cache.getMany(['a', 'b', 'c'])).toEqual(['1', '2', '3']);
  });

  it('setMany() runs exactly one cursor scan for the whole batch (the cold-start seed), not one per entry', async () => {
    const cache = createTranslationCache(100_000);
    let openCursorCalls = 0;
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args: Parameters<typeof originalOpenCursor>) {
      openCursorCalls++;
      return originalOpenCursor.apply(this, args);
    };
    try {
      await cache.setMany([
        { key: 'a', value: 'x'.repeat(1000) },
        { key: 'b', value: 'x'.repeat(1000) },
        { key: 'c', value: 'x'.repeat(1000) },
      ]);
      // Exactly one cursor scan for ensureRunningTotal()'s cold-start seed —
      // not one per entry, and no eviction scan on top since the batch is
      // well under the 100_000-byte budget.
      expect(openCursorCalls).toBe(1);
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it("setMany() adjusts the running total by each entry's size delta, matching N individual set() calls", async () => {
    const cacheA = createTranslationCache();
    await cacheA.setMany([
      { key: 'a', value: 'x'.repeat(1000) },
      { key: 'b', value: 'x'.repeat(2000) },
    ]);
    const sizeA = await cacheA.getSizeBytes();

    globalThis.indexedDB = new IDBFactory(); // independent storage — same keys, must not share cacheA's
    const cacheB = createTranslationCache();
    await cacheB.set('a', 'x'.repeat(1000));
    await cacheB.set('b', 'x'.repeat(2000));
    const sizeB = await cacheB.getSizeBytes();

    expect(sizeA).toBe(sizeB);
  });

  it('getSizeBytes() reflects the stored entries', async () => {
    const cache = createTranslationCache();
    expect(await cache.getSizeBytes()).toBe(0);
    await cache.set('a', 'b');
    expect(await cache.getSizeBytes()).toBeGreaterThan(0);
  });

  it('clear() removes all entries', async () => {
    const cache = createTranslationCache();
    await cache.set('a', '1');
    await cache.set('b', '2');
    await cache.clear();
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.getSizeBytes()).toBe(0);
  });

  it('evicts the oldest (least-recently-used) entries first once over budget', async () => {
    // Each entry here is ~2*(1+1000)=2002 bytes (key length 1 + value
    // length 1000, UTF-16 estimate). A 3000-byte budget fits one entry
    // comfortably but not two.
    const cache = createTranslationCache(3000);
    await cache.set('a', 'x'.repeat(1000));
    await cache.set('b', 'y'.repeat(1000));

    // "a" is now the least-recently-used (touched only at insert time,
    // while "b" was inserted after it) — should be the one evicted once
    // the budget is exceeded by adding a third entry.
    await cache.set('c', 'z'.repeat(1000));

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('c')).toBe('z'.repeat(1000));
  });

  it('a get() refreshes recency, protecting an entry from eviction', async () => {
    // Each entry is ~2002 bytes — a 5000-byte budget comfortably holds any
    // two of the three entries this test writes, but not all three, so
    // exactly one eviction happens and recency (not insertion order)
    // decides which entry it is.
    const cache = createTranslationCache(5000);
    await cache.set('a', 'x'.repeat(1000));
    await new Promise((resolve) => setTimeout(resolve, 5)); // ensure a distinct Date.now() per step
    await cache.set('b', 'y'.repeat(1000));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Touch "a" so it's now more recently used than "b".
    await cache.get('a');
    await new Promise((resolve) => setTimeout(resolve, 5));

    await cache.set('c', 'z'.repeat(1000));

    // "b" should be evicted instead of "a", since "a" was just touched.
    expect(await cache.get('a')).toBe('x'.repeat(1000));
    expect(await cache.get('b')).toBeNull();
  });

  it('evictUntilUnderBudget() can be called directly to enforce a smaller budget', async () => {
    const cache = createTranslationCache(100_000); // generous default, won't auto-evict on set()
    await cache.set('a', 'x'.repeat(1000));
    await cache.set('b', 'y'.repeat(1000));
    expect(await cache.getSizeBytes()).toBeGreaterThan(3000);

    await cache.evictUntilUnderBudget(3000);

    expect(await cache.getSizeBytes()).toBeLessThanOrEqual(3000);
  });

  it('reuses one IndexedDB connection across multiple calls instead of opening one per call', async () => {
    const openSpy = vi.spyOn(globalThis.indexedDB, 'open');
    const cache = createTranslationCache();

    await cache.set('a', '1');
    await cache.get('a');
    await cache.set('b', '2');
    await cache.get('b');
    await cache.getSizeBytes();

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('tracks size incrementally rather than re-scanning the whole store on every write', async () => {
    const cache = createTranslationCache();
    await cache.set('a', 'x'.repeat(1000));

    // Seed the running total with one real scan, then spy so a further
    // write can't silently fall back to a full re-scan.
    await cache.getSizeBytes();
    const openCursorCalls: number[] = [];
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args: Parameters<typeof originalOpenCursor>) {
      openCursorCalls.push(1);
      return originalOpenCursor.apply(this, args);
    };
    try {
      await cache.set('b', 'y'.repeat(1000));
      // A well-under-budget write shouldn't trigger any cursor scan at all
      // (no eviction needed, and the running total is already known).
      expect(openCursorCalls).toHaveLength(0);
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it('seeds the running total from whatever is already persisted from a prior session (real cursor-scan path)', async () => {
    // Write directly through a first cache instance (simulating a previous
    // service-worker lifetime), then create a genuinely FRESH instance —
    // its running total starts uninitialized and must be seeded by a real
    // scan that actually finds an existing entry, not an empty store.
    const first = createTranslationCache();
    await first.set('a', 'x'.repeat(1000));

    const second = createTranslationCache();
    const size = await second.getSizeBytes();

    expect(size).toBeGreaterThan(0);
    expect(await second.get('a')).toBe('x'.repeat(1000));
  });

  it('shares one scan across concurrent cold-start calls instead of each running its own (which would let one silently overwrite the other)', async () => {
    // Seed real persisted data through a first instance, then create a
    // genuinely fresh instance whose running total starts uninitialized —
    // same cold-start setup as the "seeds the running total..." test above,
    // but this time firing two calls concurrently before either scan
    // resolves.
    const first = createTranslationCache();
    await first.set('a', 'x'.repeat(1000));

    const second = createTranslationCache();
    const openCursorCalls: number[] = [];
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args: Parameters<typeof originalOpenCursor>) {
      openCursorCalls.push(1);
      return originalOpenCursor.apply(this, args);
    };
    try {
      const [sizeA, sizeB] = await Promise.all([second.getSizeBytes(), second.getSizeBytes()]);
      // Exactly one real cursor scan, not two independent ones.
      expect(openCursorCalls).toHaveLength(1);
      expect(sizeA).toBe(sizeB);
      expect(sizeA).toBeGreaterThan(0);
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it('overwriting an existing key adjusts the running total by the size delta, not by double-counting', async () => {
    const cache = createTranslationCache(100_000);
    await cache.set('a', 'x'.repeat(1000));
    const sizeAfterFirst = await cache.getSizeBytes();

    await cache.set('a', 'x'.repeat(2000));
    const sizeAfterOverwrite = await cache.getSizeBytes();

    // Roughly one entry's worth of growth (~2000 extra UTF-16 bytes), not
    // ~1000 (unchanged) or ~5000+ (double-counted as if both old and new
    // were still present).
    expect(sizeAfterOverwrite - sizeAfterFirst).toBeCloseTo(2000, -2);
  });

  describe('connection resilience (real user-reported bug: "Attempt to get a record from database without an in-progress transaction")', () => {
    /** Intercepts indexedDB.open() and returns the real IDBDatabase the cache ends up holding internally, so a test can simulate the browser closing it out from under the cache. */
    function captureNextOpenedDb(): { db: () => IDBDatabase | undefined } {
      let captured: IDBDatabase | undefined;
      const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((...args: Parameters<typeof originalOpen>) => {
        const request = originalOpen(...args);
        request.addEventListener('success', () => {
          captured = request.result;
        });
        return request;
      });
      return { db: () => captured };
    }

    it('transparently reopens after the browser closes the connection (memory pressure, low storage, etc.)', async () => {
      // fake-indexeddb's dispatchEvent() rejects synthetic 'close' events
      // (InvalidStateError — its FakeEventTarget only allows internally-
      // triggered dispatch for this event type), so this captures the
      // listener this module registers via addEventListener('close', ...)
      // and invokes it directly — exercising the exact same callback body
      // a real browser-initiated close would run, without depending on
      // fake-indexeddb's dispatch restriction.
      let closeListener: (() => void) | undefined;
      const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((...args: Parameters<typeof originalOpen>) => {
        const request = originalOpen(...args);
        request.addEventListener('success', () => {
          const db = request.result;
          const originalAddEventListener = db.addEventListener.bind(db);
          vi.spyOn(db, 'addEventListener').mockImplementation(
            (type: string, listener: EventListenerOrEventListenerObject) => {
              if (type === 'close' && typeof listener === 'function') closeListener = listener as () => void;
              return originalAddEventListener(type, listener);
            },
          );
        });
        return request;
      });

      const cache = createTranslationCache();
      await cache.set('a', 'hello');
      expect(closeListener).toBeDefined();

      // Simulate a browser-initiated close — this is exactly what mobile
      // browsers do more aggressively than desktop, and what the old
      // always-open-fresh/always-close design never lived long enough to
      // hit.
      closeListener?.();

      // The next call must transparently reopen, not keep failing forever.
      await expect(cache.get('a')).resolves.toBe('hello');
      await expect(cache.set('b', 'world')).resolves.toBeUndefined();
      await expect(cache.get('b')).resolves.toBe('world');
    });

    it('retries once with a fresh connection when a transaction fails mid-flight, without throwing', async () => {
      const capture = captureNextOpenedDb();
      const cache = createTranslationCache();
      await cache.set('warm', '1'); // establishes and caches a connection
      const db = capture.db();
      expect(db).toBeDefined();
      if (!db) throw new Error('unreachable');

      // Simulate the connection dying between getDb() resolving and the
      // transaction actually being created — db.onclose alone doesn't
      // cover this race, only withDb()'s retry does.
      let failedOnce = false;
      const originalTransaction = db.transaction.bind(db);
      vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof originalTransaction>) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('simulated: connection is closing');
        }
        return originalTransaction(...args);
      });

      await expect(cache.get('warm')).resolves.toBe('1');
      expect(failedOnce).toBe(true);
    });

    it('propagates a real error if the connection is unusable even after the retry (does not loop forever or hang)', async () => {
      const capture = captureNextOpenedDb();
      const cache = createTranslationCache();
      await cache.set('warm', '1');
      const db = capture.db();
      expect(db).toBeDefined();
      if (!db) throw new Error('unreachable');

      // The first attempt fails via the already-cached (now broken)
      // connection...
      vi.spyOn(db, 'transaction').mockImplementation(() => {
        throw new Error('simulated: connection is permanently unusable');
      });
      // ...and the retry's fresh reopen fails too, so there's genuinely no
      // way through — confirms withDb() gives up after one retry instead
      // of hanging or looping.
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        throw new Error('simulated: storage unavailable');
      });

      await expect(cache.get('warm')).rejects.toThrow();
    });
  });
});

describe('cacheKeyFor', () => {
  it('combines provider, language pair, and text into one key', () => {
    expect(cacheKeyFor('llm', 'en', 'es', 'hello')).toBe('llm>en>es:hello');
  });

  it('produces different keys for different providers or language pairs with the same text', () => {
    const a = cacheKeyFor('llm', 'en', 'es', 'hello');
    const b = cacheKeyFor('google', 'en', 'es', 'hello');
    const c = cacheKeyFor('llm', 'en', 'fr', 'hello');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
