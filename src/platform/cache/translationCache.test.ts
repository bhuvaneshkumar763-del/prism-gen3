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
    //
    // Real-clock jumps (vi.setSystemTime), not just a few ms of real sleep:
    // touchLastUsed's own coarsening (LAST_USED_TOUCH_INTERVAL_MS, see its
    // doc comment) skips the rewrite for anything already fresh, so a
    // realistic-but-tiny gap between steps would make this test's own
    // get('a') a no-op and silently invert what it's checking. fake-indexeddb
    // is a pure in-memory implementation with no real timer/I-O dependency,
    // so only Date.now() needs to move — vi.useFakeTimers() (which would
    // also touch setTimeout scheduling) isn't needed.
    const now = Date.now();
    vi.setSystemTime(now);
    const cache = createTranslationCache(5000);
    await cache.set('a', 'x'.repeat(1000));
    vi.setSystemTime(now + 5000);
    await cache.set('b', 'y'.repeat(1000));
    vi.setSystemTime(now + 2 * 60 * 60 * 1000); // past the touch-coarsening interval

    // Touch "a" so it's now more recently used than "b".
    await cache.get('a');
    vi.setSystemTime(now + 2 * 60 * 60 * 1000 + 5000);

    await cache.set('c', 'z'.repeat(1000));
    vi.useRealTimers();

    // "b" should be evicted instead of "a", since "a" was just touched.
    expect(await cache.get('a')).toBe('x'.repeat(1000));
    expect(await cache.get('b')).toBeNull();
  });

  it("skips the lastUsed rewrite for a hit that was already touched recently — speed fix, found via a round-6 audit: touchLastUsed used to unconditionally re-put() the FULL record (translated value included, not just the timestamp) on every single hit, so repeatedly querying the same already-fresh entries within one session (a mutating page re-checking unchanged text, overlapping content across nearby getMany() calls) paid a real IndexedDB write for each one even though recency hadn't meaningfully changed", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const cache = createTranslationCache();

    let db: IDBDatabase | undefined;
    const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((...args: Parameters<typeof originalOpen>) => {
      const request = originalOpen(...args);
      request.addEventListener('success', () => {
        db = request.result;
      });
      return request;
    });

    await cache.set('hello', 'hola');
    expect(db).toBeDefined();
    if (!db) throw new Error('unreachable');

    let readwriteCount = 0;
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof originalTransaction>) => {
      if (args[1] === 'readwrite') readwriteCount++;
      return originalTransaction(...args);
    });

    // Past the coarsening interval since set()'s own insert — this hit's
    // touch is genuinely stale, so it SHOULD write.
    vi.setSystemTime(now + 2 * 60 * 60 * 1000);
    await cache.getMany(['hello']);
    await vi.waitFor(() => expect(readwriteCount).toBe(1));

    // Immediately after — this hit's lastUsed was JUST refreshed above, so
    // this one should be skipped entirely, not fire a second readwrite.
    await cache.getMany(['hello']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.restoreAllMocks();
    vi.useRealTimers();
    expect(readwriteCount).toBe(1);
  });

  it("getMany() reads through a 'readonly' transaction, real speed bug this closed: a fully-cached page revisit used to open the read as 'readwrite' purely so it could also touch lastUsed in the same transaction, forcing every cache HIT to pay for an IndexedDB write commit before the read it was piggybacking on could even resolve", async () => {
    const cache = createTranslationCache();

    // Spied BEFORE the cache's first call, so it observes the real
    // open() that lazily establishes and caches this instance's one
    // connection (see the module doc comment on connection reuse).
    let db: IDBDatabase | undefined;
    const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation((...args: Parameters<typeof originalOpen>) => {
      const request = originalOpen(...args);
      request.addEventListener('success', () => {
        db = request.result;
      });
      return request;
    });

    await cache.set('hello', 'hola');
    expect(db).toBeDefined();
    if (!db) throw new Error('unreachable');

    const modes: IDBTransactionMode[] = [];
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof originalTransaction>) => {
      modes.push(args[1] ?? 'readonly');
      return originalTransaction(...args);
    });

    await cache.getMany(['hello']);
    vi.restoreAllMocks();

    // The FIRST transaction opened for a getMany() call is the one whose
    // completion the caller is actually waiting on — it must be readonly.
    // (A second, later 'readwrite' transaction for the fire-and-forget
    // lastUsed touch is expected and fine — see the touchLastUsed doc
    // comment — this assertion is specifically about the read path.)
    expect(modes[0]).toBe('readonly');
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

    it('closes the connection it gives up on before retrying, so a failed operation does not leave it open', async () => {
      const capture = captureNextOpenedDb();
      const cache = createTranslationCache();
      await cache.set('warm', '1');
      const db = capture.db();
      if (!db) throw new Error('unreachable');

      const closeSpy = vi.spyOn(db, 'close');
      let failedOnce = false;
      const originalTransaction = db.transaction.bind(db);
      vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof originalTransaction>) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('simulated: a non-connection failure');
        }
        return originalTransaction(...args);
      });

      await expect(cache.get('warm')).resolves.toBe('1');
      expect(closeSpy).toHaveBeenCalled();
    });

    it('does not throw away a fresh connection that a concurrent retry already opened', async () => {
      const capture = captureNextOpenedDb();
      const cache = createTranslationCache();
      await cache.set('warm', '1');
      const db = capture.db();
      if (!db) throw new Error('unreachable');

      vi.spyOn(db, 'transaction').mockImplementation(() => {
        throw new Error('simulated: connection is closing');
      });
      const openSpy = vi.spyOn(globalThis.indexedDB, 'open');
      openSpy.mockClear();
      // Both operations fail on the same dead connection; one reopen should serve both retries.
      await expect(Promise.all([cache.get('warm'), cache.get('warm')])).resolves.toEqual(['1', '1']);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('gives up after one retry when the reopen fails too, and reads as a miss (does not loop forever or hang)', async () => {
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

      await expect(cache.get('warm')).resolves.toBeNull();
    });
  });

  describe('failed open (e.g. WebKit "Connection to Indexed Database server lost")', () => {
    function failNextOpen(): void {
      const originalOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
      vi.spyOn(globalThis.indexedDB, 'open')
        .mockImplementationOnce(() => {
          throw new Error('simulated: Connection to Indexed Database server lost');
        })
        .mockImplementation(originalOpen);
    }

    function failEveryOpen(): void {
      vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
        throw new Error('simulated: storage unavailable');
      });
    }

    it('retries the open on the next call instead of keeping the cache off for good', async () => {
      failNextOpen();
      const cache = createTranslationCache();
      await cache.get('a').catch(() => null);

      await cache.set('a', 'hola');
      expect(await cache.get('a')).toBe('hola');
    });

    it('reads as a cache miss and writes as a no-op, so translation never sees the error', async () => {
      failEveryOpen();
      const cache = createTranslationCache();
      await expect(cache.get('a')).resolves.toBeNull();
      await expect(cache.getMany(['a', 'b'])).resolves.toEqual([null, null]);
      await expect(cache.set('a', 'hola')).resolves.toBeUndefined();
      await expect(cache.setMany([{ key: 'b', value: 'adios' }])).resolves.toBeUndefined();
      await expect(cache.evictUntilUnderBudget(0)).resolves.toBeUndefined();
    });

    it('still rejects clear() and getSizeBytes(), whose callers report the failure to the user', async () => {
      failEveryOpen();
      const cache = createTranslationCache();
      await expect(cache.clear()).rejects.toThrow();
      await expect(cache.getSizeBytes()).rejects.toThrow();
    });
  });
});

describe('translationCache: one size total shared by every context', () => {
  // Two cache instances on one IndexedDB stand in for two extension contexts
  // (the background worker and the Settings page).
  const ENTRY = 'x'.repeat(1000); // with a one-letter key, ~2002 bytes
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("Clear cache in another context resets this context's size total, so fresh entries aren't evicted afterwards", async () => {
    const background = createTranslationCache(5000);
    const settings = createTranslationCache(5000);
    await background.set('a', ENTRY);
    await background.set('b', ENTRY);

    await settings.clear();

    await background.set('c', ENTRY);
    await background.set('d', ENTRY);
    expect(await background.getMany(['c', 'd'])).toEqual([ENTRY, ENTRY]);
  });

  it("counts another context's writes toward the budget", async () => {
    const first = createTranslationCache(5000);
    const second = createTranslationCache(5000);
    await first.set('a', ENTRY);
    await second.set('b', ENTRY);
    await first.set('c', ENTRY);

    expect(await first.getSizeBytes()).toBeLessThanOrEqual(5000);
    expect(await first.get('a')).toBeNull();
    expect(await first.getMany(['b', 'c'])).toEqual([ENTRY, ENTRY]);
  });

  it('two contexts evicting at the same time delete only what the budget needs, not twice as much', async () => {
    const seed = createTranslationCache(100_000);
    await seed.set('a', ENTRY);
    await seed.set('b', ENTRY);
    await seed.set('c', ENTRY);
    const first = createTranslationCache(100_000);
    const second = createTranslationCache(100_000);
    // Both contexts have seen the store before the evictions race.
    await Promise.all([first.getSizeBytes(), second.getSizeBytes()]);
    await first.get('zz');
    await second.get('zz');

    await Promise.all([first.evictUntilUnderBudget(4500), second.evictUntilUnderBudget(4500)]);

    expect(await seed.get('a')).toBeNull();
    expect(await seed.getMany(['b', 'c'])).toEqual([ENTRY, ENTRY]);
  });

  it('recovers from a stored size total that is too high instead of emptying the cache on every write', async () => {
    const cache = createTranslationCache(5000);
    await cache.set('a', ENTRY);
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('prism-translation-cache');
      request.onsuccess = () => {
        const tx = request.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(1_000_000, 'totalBytes');
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    });

    await cache.set('b', ENTRY);
    await cache.set('c', ENTRY);
    expect(await cache.get('c')).toBe(ENTRY);
  });

  it("concurrent writes from two contexts don't lose each other's bytes", async () => {
    const first = createTranslationCache(7000);
    const second = createTranslationCache(7000);
    await Promise.all([first.set('a', ENTRY), second.set('b', ENTRY)]);
    await Promise.all([first.set('c', ENTRY), second.set('d', ENTRY)]);

    // Four entries (~8008 bytes) don't fit a 7000-byte budget, whichever
    // context wrote them.
    const stored = (await first.getMany(['a', 'b', 'c', 'd'])).filter((v) => v !== null);
    expect(stored.length).toBeLessThanOrEqual(3);
  });
});

describe('translationCache: transaction failures settle', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  /** Resolves 'hung' if `promise` hasn't settled within `ms`. */
  function settlesWithin(promise: Promise<unknown>, ms = 500): Promise<'settled' | 'hung'> {
    return Promise.race([
      promise.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms)),
    ]);
  }

  /**
   * Makes every readwrite transaction fail at commit the way a full disk
   * does: every request succeeds, then the transaction aborts with a
   * QuotaExceededError instead of completing.
   */
  function failReadwriteCommits(): void {
    const original = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<typeof original>
    ) {
      const tx = original.apply(this, args);
      if (args[1] !== 'readwrite') return tx;
      const quota = new DOMException('simulated: quota exceeded', 'QuotaExceededError');
      const abortListeners: Array<(event: Event) => void> = [];
      let onabort: ((event: Event) => void) | null = null;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get: () => null, set: () => {} });
      Object.defineProperty(tx, 'onabort', {
        configurable: true,
        get: () => onabort,
        set: (handler) => {
          onabort = handler;
        },
      });
      let committing = false;
      Object.defineProperty(tx, 'error', { configurable: true, get: () => (committing ? quota : null) });
      const addEventListener = tx.addEventListener.bind(tx);
      tx.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'complete') return;
        if (type === 'abort' && typeof listener === 'function') {
          abortListeners.push(listener as (event: Event) => void);
          return;
        }
        addEventListener(type, listener);
      }) as typeof tx.addEventListener;
      addEventListener('complete', () => {
        committing = true;
        const event = new Event('abort');
        onabort?.call(tx, event);
        for (const listener of abortListeners) listener(event);
      });
      return tx;
    });
  }

  it('setMany() settles when the write aborts at commit (quota exceeded) instead of hanging', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = createTranslationCache();
    await cache.get('warm');
    failReadwriteCommits();
    try {
      expect(await settlesWithin(cache.setMany([{ key: 'a', value: 'hola' }]))).toBe('settled');
      expect(await settlesWithin(cache.clear())).toBe('settled');
    } finally {
      vi.restoreAllMocks();
      warn.mockRestore();
    }
  });
});

describe('translationCache: other connections and versions', () => {
  const DB_NAME = 'prism-translation-cache';
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  function open(
    version: number,
    onUpgrade?: (db: IDBDatabase) => void,
  ): Promise<{ db: IDBDatabase | null; blocked: boolean }> {
    return new Promise((resolve) => {
      let blocked = false;
      const request = indexedDB.open(DB_NAME, version);
      request.onupgradeneeded = () => onUpgrade?.(request.result);
      request.onblocked = () => {
        blocked = true;
      };
      request.onsuccess = () => resolve({ db: request.result, blocked });
      setTimeout(() => resolve({ db: null, blocked }), 500);
    });
  }

  it("closes its connection when another context needs to upgrade the database, so that upgrade isn't blocked", async () => {
    const cache = createTranslationCache();
    await cache.set('a', 'hola');

    const newer = await open(1000);
    newer.db?.close();
    expect(newer.blocked).toBe(false);
    expect(newer.db).not.toBeNull();
  });

  it("doesn't hang when an older connection blocks its upgrade: reads miss and writes are dropped", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const older = await open(1, (db) => {
      db.createObjectStore('entries', { keyPath: 'key' }).createIndex('lastUsed', 'lastUsed');
    });
    // The old connection deliberately ignores versionchange.
    if (older.db) older.db.onversionchange = null;
    const cache = createTranslationCache();
    try {
      const read = cache.get('a');
      const outcome = await Promise.race([
        read.then((value) => ({ value })),
        new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
      ]);
      expect(outcome).toEqual({ value: null });

      // Once the old connection goes, the next call upgrades and works.
      older.db?.close();
      await cache.set('a', 'hola');
      expect(await cache.get('a')).toBe('hola');
    } finally {
      older.db?.close();
      warn.mockRestore();
    }
  });

  it('keeps entries written by the previous database version and counts them toward the budget', async () => {
    const lastUsed = Date.now();
    const older = await open(1, (db) => {
      const store = db.createObjectStore('entries', { keyPath: 'key' });
      store.createIndex('lastUsed', 'lastUsed');
      store.put({ key: 'a', value: 'x'.repeat(1000), size: 2002, lastUsed });
      store.put({ key: 'b', value: 'y'.repeat(1000), size: 2002, lastUsed: lastUsed + 1 });
    });
    older.db?.close();

    const cache = createTranslationCache(5000);
    expect(await cache.get('a')).toBe('x'.repeat(1000));
    expect(await cache.getSizeBytes()).toBe(4004);
    await cache.set('c', 'z'.repeat(1000));
    expect(await cache.get('a')).toBeNull();
    expect(await cache.getMany(['b', 'c'])).toEqual(['y'.repeat(1000), 'z'.repeat(1000)]);
  });
});

describe('translationCache: 30-day maximum entry age', () => {
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('reads an entry older than 30 days as a miss', async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    try {
      const cache = createTranslationCache();
      await cache.set('a', 'hola');
      vi.setSystemTime(now + 29 * DAY);
      expect(await cache.get('a')).toBe('hola');
      vi.setSystemTime(now + 31 * DAY);
      expect(await cache.get('a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts age from when the entry was written, not when it was last read', async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    try {
      const cache = createTranslationCache();
      await cache.set('a', 'hola');
      vi.setSystemTime(now + 20 * DAY);
      expect(await cache.get('a')).toBe('hola'); // refreshes lastUsed
      vi.setSystemTime(now + 31 * DAY);
      expect(await cache.get('a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes expired entries on the next write even when the cache is under budget', async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    try {
      const cache = createTranslationCache();
      await cache.set('a', 'x'.repeat(1000));
      vi.setSystemTime(now + 31 * DAY);
      await cache.set('b', 'y'.repeat(10));
      expect(await cache.getSizeBytes()).toBe((1 + 10) * 2);
    } finally {
      vi.useRealTimers();
    }
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
