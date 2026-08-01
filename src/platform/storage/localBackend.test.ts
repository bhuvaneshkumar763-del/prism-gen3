import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { localStorageBackend } from './localBackend';

describe('localStorageBackend', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('set() then getAll() round-trips a value', async () => {
    await localStorageBackend.set({ foo: 'bar' });
    const all = await localStorageBackend.getAll();
    expect(all.foo).toBe('bar');
  });

  it('remove() deletes a key', async () => {
    await localStorageBackend.set({ foo: 'bar', baz: 1 });
    await localStorageBackend.remove(['foo']);
    const all = await localStorageBackend.getAll();
    expect(Object.hasOwn(all, 'foo')).toBe(false);
    expect(all.baz).toBe(1);
  });

  it('remove() with an empty array is a no-op', async () => {
    await localStorageBackend.set({ foo: 'bar' });
    await localStorageBackend.remove([]);
    expect((await localStorageBackend.getAll()).foo).toBe('bar');
  });

  it('onChanged() fires when a value changes in the local area', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const unsub = localStorageBackend.onChanged((changes) => seen.push(changes));

    await localStorageBackend.set({ foo: 'baz' });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.foo).toMatchObject({ newValue: 'baz' });
    unsub();
  });

  it('onChanged() unsubscribe stops future notifications', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const unsub = localStorageBackend.onChanged((changes) => seen.push(changes));
    unsub();

    await localStorageBackend.set({ foo: 'baz' });

    expect(seen).toEqual([]);
  });

  it('onChanged() ignores changes from a non-local storage area', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const unsub = localStorageBackend.onChanged((changes) => seen.push(changes));

    // Simulate an onChanged event from a different area (e.g. "sync") —
    // localStorageBackend must filter these out, not just relay everything.
    await fakeBrowser.storage.sync.set({ foo: 'from-sync' });

    expect(seen).toEqual([]);
    unsub();
  });
});
