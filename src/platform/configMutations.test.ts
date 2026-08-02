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
