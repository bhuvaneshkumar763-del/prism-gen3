import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
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
