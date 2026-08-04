import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../shared/config/schema';

/**
 * `configStore.ts` holds module-level state per instance and reads the
 * `browser` global at import time (via localBackend.ts's `browser.storage`
 * calls happening as soon as `onChanged` is wired up in `createConfigStore`
 * — see tests/setup.ts for why the fake-browser shim has to live in a
 * setupFile, not a per-test vi.stubGlobal). Each test resets
 * fakeBrowser and constructs a fresh store via `createConfigStore()`
 * (exported specifically so tests aren't stuck sharing the one
 * module-level `configStore` singleton).
 */

async function freshStore() {
  const { createConfigStore } = await import('./configStore');
  return createConfigStore();
}

describe('configStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('loads defaults when storage is empty', async () => {
    const store = await freshStore();
    await store.onReady();
    expect(store.get('targetLanguage')).toBe(defaultConfig.targetLanguage);
    expect(store.get('libreTranslateBaseUrl')).toBe(defaultConfig.libreTranslateBaseUrl);
  });

  it('set() persists to browser.storage.local under the plain field name', async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'ja');
    expect(store.get('targetLanguage')).toBe('ja');

    const raw = await fakeBrowser.storage.local.get(null);
    expect(raw.targetLanguage).toBe('ja');
  });

  it('onChanged() fires with the new value when set() is called', async () => {
    const store = await freshStore();
    await store.onReady();
    const seen: Array<[string, unknown]> = [];
    const unsub = store.onChanged((name, value) => seen.push([name, value]));

    await store.set('targetLanguage', 'de');

    expect(seen).toContainEqual(['targetLanguage', 'de']);
    unsub();
  });

  it('onChanged() unsubscribe stops future notifications', async () => {
    const store = await freshStore();
    await store.onReady();
    const seen: Array<[string, unknown]> = [];
    const unsub = store.onChanged((name, value) => seen.push([name, value]));
    unsub();

    await store.set('targetLanguage', 'it');

    expect(seen).toEqual([]);
  });

  it('export() serializes the current state as JSON', async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'pt');

    const json = await store.export();
    const parsed = JSON.parse(json);
    expect(parsed.targetLanguage).toBe('pt');
  });

  it('import() validates against the schema and persists every field', async () => {
    const store = await freshStore();
    await store.onReady();

    await store.import(JSON.stringify({ targetLanguage: 'zh', libreTranslateApiKey: 'abc123' }));

    expect(store.get('targetLanguage')).toBe('zh');
    expect(store.get('libreTranslateApiKey')).toBe('abc123');
    const raw = await fakeBrowser.storage.local.get(null);
    expect(raw.targetLanguage).toBe('zh');
    expect(raw.libreTranslateApiKey).toBe('abc123');
  });

  it('import() rejects a value of the wrong type instead of silently corrupting storage', async () => {
    const store = await freshStore();
    await store.onReady();

    await expect(store.import(JSON.stringify({ targetLanguage: 42 }))).rejects.toThrow();
  });

  it('import() ignores unknown fields rather than throwing', async () => {
    const store = await freshStore();
    await store.onReady();

    await expect(store.import(JSON.stringify({ notARealField: 'x' }))).resolves.toBeUndefined();
  });

  it('restoreToDefault() writes every key back to defaultConfig, in memory and in storage', async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'zh');
    await store.set('alwaysTranslateSites', ['example.com']);

    await store.restoreToDefault();

    expect(store.get('targetLanguage')).toBe(defaultConfig.targetLanguage);
    expect(store.get('alwaysTranslateSites')).toEqual(defaultConfig.alwaysTranslateSites);
    const raw = await fakeBrowser.storage.local.get(null);
    expect(raw.targetLanguage).toBe(defaultConfig.targetLanguage);
  });

  it('restoreToDefault() notifies onChanged listeners', async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'zh');
    const seen: Array<[string, unknown]> = [];
    const unsub = store.onChanged((name, value) => seen.push([name, value]));

    await store.restoreToDefault();

    expect(seen).toContainEqual(['targetLanguage', defaultConfig.targetLanguage]);
    unsub();
  });

  it('onReady() reads storage exactly once when no migration is needed (not a separate read for migration-check + a second for the actual load)', async () => {
    await fakeBrowser.storage.local.set({ targetLanguage: 'ja' });
    const getSpy = vi.spyOn(fakeBrowser.storage.local, 'get');

    const store = await freshStore();
    await store.onReady();

    expect(store.get('targetLanguage')).toBe('ja');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe('configStore — migration (CONFIG_SCHEMA_VERSION 2)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('a fresh (version 0) profile with Session 2s ad hoc keys round-trips through both migrations, ending back at the same field names', async () => {
    await fakeBrowser.storage.local.set({
      libreTranslateBaseUrl: 'https://my-instance.example',
      libreTranslateApiKey: 'old-key',
    });

    const store = await freshStore();
    await store.onReady();

    expect(store.get('libreTranslateBaseUrl')).toBe('https://my-instance.example');
    expect(store.get('libreTranslateApiKey')).toBe('old-key');
    expect((await fakeBrowser.storage.local.get(null)).__configSchemaVersion).toBe(2);
  });

  it('a profile stuck at version 1 (generic providerBaseUrl/providerApiKey) migrates to the provider-specific names', async () => {
    await fakeBrowser.storage.local.set({
      providerBaseUrl: 'https://v1-instance.example',
      providerApiKey: 'v1-key',
      __configSchemaVersion: 1,
    });

    const store = await freshStore();
    await store.onReady();

    expect(store.get('libreTranslateBaseUrl')).toBe('https://v1-instance.example');
    expect(store.get('libreTranslateApiKey')).toBe('v1-key');
    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'providerBaseUrl')).toBe(false);
    expect(Object.hasOwn(raw, 'providerApiKey')).toBe(false);
    expect(raw.__configSchemaVersion).toBe(2);
  });

  it('is idempotent on a second load', async () => {
    await fakeBrowser.storage.local.set({ libreTranslateBaseUrl: 'https://x.example' });
    const first = await freshStore();
    await first.onReady();
    expect((await fakeBrowser.storage.local.get(null)).__configSchemaVersion).toBe(2);

    const second = await freshStore();
    await expect(second.onReady()).resolves.toBeUndefined();
    expect(second.get('libreTranslateBaseUrl')).toBe('https://x.example');
  });
});

describe('configStore — cross-context consistency (Session 3 settings-sync precondition)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('a write through one store instance is visible to a second, independent instance', async () => {
    // Simulates two different extension contexts (e.g. the options page
    // and a content script) each holding their own configStore instance —
    // exactly the shape of the real WebKit split-brain bug the old repo
    // hit with chrome.storage.sync (see docs/decisions/0003-settings-sync-deferred.md).
    // This test is the concrete gate that ADR requires any future sync
    // backend to pass.
    const contextA = await freshStore();
    const contextB = await freshStore();
    await Promise.all([contextA.onReady(), contextB.onReady()]);

    let observedInB: unknown;
    const seenInB = new Promise<void>((resolve) => {
      contextB.onChanged((name, value) => {
        if (name === 'targetLanguage') {
          observedInB = value;
          resolve();
        }
      });
    });

    await contextA.set('targetLanguage', 'ko');

    await vi.waitFor(() => seenInB, { timeout: 1000 });
    expect(observedInB).toBe('ko');
    expect(contextB.get('targetLanguage')).toBe('ko');
  });

  it('a store created AFTER a write still loads the current value (no stale-read-on-init)', async () => {
    const contextA = await freshStore();
    await contextA.onReady();
    await contextA.set('targetLanguage', 'ru');

    const contextB = await freshStore();
    await contextB.onReady();

    expect(contextB.get('targetLanguage')).toBe('ru');
  });
});
