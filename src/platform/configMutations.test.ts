import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { addSiteToAlwaysTranslate } from '../shared/config/listMutations';

async function freshStore() {
  const { createConfigStore } = await import('./configStore');
  return createConfigStore();
}

describe('applyListPatch / readListsSnapshot', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('reads the four list keys off the store', async () => {
    const { readListsSnapshot } = await import('./configMutations');
    const store = await freshStore();
    await store.onReady();
    await store.set('alwaysTranslateSites', ['example.com']);

    const snapshot = readListsSnapshot(store);
    expect(snapshot.alwaysTranslateSites).toEqual(['example.com']);
    expect(snapshot.neverTranslateSites).toEqual([]);
  });

  it('applies every key present in the patch', async () => {
    const { applyListPatch } = await import('./configMutations');
    const store = await freshStore();
    await store.onReady();

    await applyListPatch(store, { alwaysTranslateSites: ['a.com'], neverTranslateSites: ['b.com'] });

    expect(store.get('alwaysTranslateSites')).toEqual(['a.com']);
    expect(store.get('neverTranslateSites')).toEqual(['b.com']);
  });

  it('skips a key explicitly present in the patch with an undefined value', async () => {
    const { applyListPatch } = await import('./configMutations');
    const store = await freshStore();
    await store.onReady();
    await store.set('neverTranslateSites', ['kept.com']);

    await applyListPatch(store, { alwaysTranslateSites: ['a.com'], neverTranslateSites: undefined });

    expect(store.get('alwaysTranslateSites')).toEqual(['a.com']);
    expect(store.get('neverTranslateSites')).toEqual(['kept.com']);
  });

  it('leaves keys absent from the patch untouched', async () => {
    const { applyListPatch } = await import('./configMutations');
    const store = await freshStore();
    await store.onReady();
    await store.set('alwaysTranslateLangs', ['ja']);

    await applyListPatch(store, { alwaysTranslateSites: ['a.com'] });

    expect(store.get('alwaysTranslateLangs')).toEqual(['ja']);
  });

  it('applies a multi-key patch as one combined write, not one independent write per key', async () => {
    // Regression: applyListPatch used to Promise.all() N independent
    // store.set() calls — a patch touching both lists (e.g. moving a site
    // from never- to always-translate) issued two separate storage writes,
    // so a failure partway through could land only one of them, leaving a
    // site on both lists simultaneously (the exact state listMutations.ts's
    // cross-list cleanup exists to prevent).
    const { createConfigStore } = await import('./configStore');
    const { applyListPatch } = await import('./configMutations');
    const written: Array<Record<string, unknown>> = [];
    const backend = {
      async getAll() {
        return {};
      },
      async set(entries: Record<string, unknown>) {
        written.push(entries);
      },
      async remove() {},
      onChanged() {
        return () => {};
      },
    };
    const store = createConfigStore(backend);
    await store.onReady(); // its own version-migration write happens here, not counted below
    written.length = 0;

    await applyListPatch(store, { alwaysTranslateSites: ['a.com'], neverTranslateSites: ['b.com'] });

    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({ alwaysTranslateSites: ['a.com'], neverTranslateSites: ['b.com'] });
  });

  it('a rejected patch write does not land only some of its keys', async () => {
    const { createConfigStore } = await import('./configStore');
    const { applyListPatch } = await import('./configMutations');
    let failWrites = false;
    const backend = {
      async getAll() {
        return {};
      },
      async set() {
        if (failWrites) throw new Error('simulated storage failure');
      },
      async remove() {},
      onChanged() {
        return () => {};
      },
    };
    const store = createConfigStore(backend);
    await store.onReady(); // its own version-migration write succeeds
    failWrites = true;

    await expect(
      applyListPatch(store, { alwaysTranslateSites: ['a.com'], neverTranslateSites: ['b.com'] }),
    ).rejects.toThrow('simulated storage failure');
  });

  it('end to end: a pure mutation from listMutations applied via applyListPatch produces the cross-list cleanup', async () => {
    const { applyListPatch, readListsSnapshot } = await import('./configMutations');
    const store = await freshStore();
    await store.onReady();
    await store.set('neverTranslateSites', ['example.com']);

    const patch = addSiteToAlwaysTranslate(readListsSnapshot(store), 'example.com');
    await applyListPatch(store, patch);

    expect(store.get('alwaysTranslateSites')).toEqual(['example.com']);
    expect(store.get('neverTranslateSites')).toEqual([]);
  });
});
