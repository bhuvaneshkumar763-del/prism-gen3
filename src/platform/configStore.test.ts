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
    expect(store.get('googleCloudTranslateApiKey')).toBe(defaultConfig.googleCloudTranslateApiKey);
  });

  it('falls back to the default for a key whose stored value fails schema validation, real gap: only import() validated', async () => {
    // Simulate corrupted extension storage directly — bypassing store.set()
    // (which would itself reject an invalid value) is the point: this is
    // data that got into storage some other way (a bad migration, manual
    // tampering, a future bug) and must not be blindly trusted on load.
    await fakeBrowser.storage.local.set({ targetLanguage: 12345, sourceLanguage: 'vi' });

    const store = await freshStore();
    await expect(store.onReady()).resolves.toBeUndefined();

    expect(store.get('targetLanguage')).toBe(defaultConfig.targetLanguage);
    // A neighboring, validly-typed key is unaffected by the corrupted one.
    expect(store.get('sourceLanguage')).toBe('vi');
  });

  it("ignores an invalid live storage change instead of adopting it — real bug this closed, found via a round-6 audit: the backend.onChanged handler used to adopt change.newValue straight into state with NO validation at all, unlike initConfig (above) which validates every key and falls back to the existing value on failure. A value corrupted in storage by something OTHER than this store's own set() — another context, a bad migration, a stale shape from a different extension version — used to be trusted as-is on the live path even though the startup path already refused to trust it", async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'fr');
    expect(store.get('targetLanguage')).toBe('fr');

    let notified: unknown;
    store.onChanged((name, value) => {
      if (name === 'targetLanguage') notified = value;
    });

    // Simulate an external write landing directly in storage — bypassing
    // this store's own set() (which would itself reject an invalid value)
    // is the point: this is exactly the "some other origin wrote a bad
    // value" case initConfig already guards against on startup.
    await fakeBrowser.storage.local.set({ targetLanguage: 12345 });
    // Give the onChanged event a real task to propagate.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The invalid change must not have been adopted...
    expect(store.get('targetLanguage')).toBe('fr');
    // ...and no listener should have been told about it either.
    expect(notified).toBeUndefined();
  });

  it("ignores a live storage change to undefined (a real key removal) instead of adopting it — same fix as the invalid-value case above: change.newValue is undefined for a storage.remove(), and this store's own ConfigKey type guarantees every key always has a real value, so silently adopting undefined here would have violated that guarantee for the rest of this store instance's life", async () => {
    const store = await freshStore();
    await store.onReady();
    await store.set('targetLanguage', 'de');
    expect(store.get('targetLanguage')).toBe('de');

    await fakeBrowser.storage.local.remove('targetLanguage');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.get('targetLanguage')).toBe('de');
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

  it('import() validates against the schema and persists every field', async () => {
    const store = await freshStore();
    await store.onReady();

    await store.import(JSON.stringify({ targetLanguage: 'zh', googleCloudTranslateApiKey: 'abc123' }));

    expect(store.get('targetLanguage')).toBe('zh');
    expect(store.get('googleCloudTranslateApiKey')).toBe('abc123');
    const raw = await fakeBrowser.storage.local.get(null);
    expect(raw.targetLanguage).toBe('zh');
    expect(raw.googleCloudTranslateApiKey).toBe('abc123');
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

  it('retries on the next onReady() call after a transient failure, instead of wedging on the rejected promise forever', async () => {
    // Regression: onReady() cached whatever promise initConfig() first
    // returned, including a REJECTED one — a rejected promise is still
    // truthy, so a single transient storage failure poisoned every future
    // onReady() call in that context permanently.
    const { createConfigStore } = await import('./configStore');
    let failNextGetAll = true;
    const backend = {
      async getAll() {
        if (failNextGetAll) {
          failNextGetAll = false;
          throw new Error('transient storage failure');
        }
        return {};
      },
      async set() {},
      async remove() {},
      onChanged() {
        return () => {};
      },
    };
    const store = createConfigStore(backend);

    await expect(store.onReady()).rejects.toThrow('transient storage failure');
    // The next call must actually retry, not return the same dead rejection.
    await expect(store.onReady()).resolves.toBeUndefined();
  });
});

describe('configStore — startup race and failed writes', () => {
  /** A backend whose getAll() waits for `releaseGetAll`, so a test can land a live change mid-startup. */
  function controllableBackend(stored: Record<string, unknown>) {
    let changeListener: ((changes: Record<string, { newValue?: unknown }>) => void) | undefined;
    let releaseGetAll: () => void = () => {};
    const getAllGate = new Promise<void>((resolve) => {
      releaseGetAll = resolve;
    });
    let failWrites = false;
    const backend = {
      async getAll() {
        const snapshot = { ...stored };
        await getAllGate;
        return snapshot;
      },
      async set(entries: Record<string, unknown>) {
        if (failWrites) throw new Error('simulated: storage write failed');
        Object.assign(stored, entries);
      },
      async remove() {},
      onChanged(cb: (changes: Record<string, { newValue?: unknown }>) => void) {
        changeListener = cb;
        return () => {};
      },
    };
    return {
      backend,
      releaseGetAll: () => releaseGetAll(),
      emitChange: (key: string, newValue: unknown) => changeListener?.({ [key]: { newValue } }),
      failWrites: () => {
        failWrites = true;
      },
    };
  }

  it('keeps a change from another tab that lands while startup is still reading storage', async () => {
    const { createConfigStore } = await import('./configStore');
    const ctl = controllableBackend({ targetLanguage: 'fr', __configSchemaVersion: 99 });
    const store = createConfigStore(ctl.backend);

    const ready = store.onReady();
    ctl.emitChange('targetLanguage', 'de');
    ctl.releaseGetAll();
    await ready;

    expect(store.get('targetLanguage')).toBe('de');
  });

  it('set() puts the old value back when the storage write fails', async () => {
    const { createConfigStore } = await import('./configStore');
    const ctl = controllableBackend({ targetLanguage: 'fr', __configSchemaVersion: 99 });
    ctl.releaseGetAll();
    const store = createConfigStore(ctl.backend);
    await store.onReady();
    ctl.failWrites();

    await expect(store.set('targetLanguage', 'ja')).rejects.toThrow('simulated');
    expect(store.get('targetLanguage')).toBe('fr');
  });

  it('setMany() puts every old value back when the storage write fails', async () => {
    const { createConfigStore } = await import('./configStore');
    const ctl = controllableBackend({
      alwaysTranslateLangs: ['ja'],
      neverTranslateLangs: [],
      __configSchemaVersion: 99,
    });
    ctl.releaseGetAll();
    const store = createConfigStore(ctl.backend);
    await store.onReady();
    ctl.failWrites();

    await expect(store.setMany({ alwaysTranslateLangs: [], neverTranslateLangs: ['ja'] })).rejects.toThrow('simulated');
    expect(store.get('alwaysTranslateLangs')).toEqual(['ja']);
    expect(store.get('neverTranslateLangs')).toEqual([]);
  });
});

describe('configStore — migration (CONFIG_SCHEMA_VERSION 6)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('a fresh (version 0) profile with Session 2s ad hoc LibreTranslate keys ends with them deleted from storage', async () => {
    await fakeBrowser.storage.local.set({
      libreTranslateBaseUrl: 'https://my-instance.example',
      libreTranslateApiKey: 'old-key',
    });

    const store = await freshStore();
    await store.onReady();

    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'libreTranslateBaseUrl')).toBe(false);
    expect(Object.hasOwn(raw, 'libreTranslateApiKey')).toBe(false);
    expect(raw.__configSchemaVersion).toBe(6);
  });

  it('a profile stuck at version 1 (generic providerBaseUrl/providerApiKey) ends with none of those keys left', async () => {
    await fakeBrowser.storage.local.set({
      providerBaseUrl: 'https://v1-instance.example',
      providerApiKey: 'v1-key',
      __configSchemaVersion: 1,
    });

    const store = await freshStore();
    await store.onReady();

    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'libreTranslateBaseUrl')).toBe(false);
    expect(Object.hasOwn(raw, 'libreTranslateApiKey')).toBe(false);
    expect(Object.hasOwn(raw, 'providerBaseUrl')).toBe(false);
    expect(Object.hasOwn(raw, 'providerApiKey')).toBe(false);
    expect(raw.__configSchemaVersion).toBe(6);
  });

  it('a profile on the removed LLM provider moves to google, and its stored fields (API key included) are deleted', async () => {
    await fakeBrowser.storage.local.set({
      pageTranslatorProvider: 'llm',
      llmBaseUrl: 'https://api.example/v1',
      llmApiKey: 'sk-secret',
      llmModel: 'm',
      __configSchemaVersion: 4,
    });

    const store = await freshStore();
    await store.onReady();

    expect(store.get('pageTranslatorProvider')).toBe('google');
    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'llmApiKey')).toBe(false);
    expect(Object.hasOwn(raw, 'llmBaseUrl')).toBe(false);
    expect(Object.hasOwn(raw, 'llmModel')).toBe(false);
    expect(raw.__configSchemaVersion).toBe(6);
  });

  it('a profile at version 5 has its leftover LibreTranslate API key and URL deleted from storage', async () => {
    await fakeBrowser.storage.local.set({
      libreTranslateBaseUrl: 'https://my-instance.example',
      libreTranslateApiKey: 'old-key',
      targetLanguage: 'fr',
      __configSchemaVersion: 5,
    });

    const store = await freshStore();
    await store.onReady();

    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'libreTranslateApiKey')).toBe(false);
    expect(Object.hasOwn(raw, 'libreTranslateBaseUrl')).toBe(false);
    expect(store.get('targetLanguage')).toBe('fr');
  });

  it('is idempotent on a second load', async () => {
    await fakeBrowser.storage.local.set({ libreTranslateBaseUrl: 'https://x.example', targetLanguage: 'fr' });
    const first = await freshStore();
    await first.onReady();
    expect((await fakeBrowser.storage.local.get(null)).__configSchemaVersion).toBe(6);

    const second = await freshStore();
    await expect(second.onReady()).resolves.toBeUndefined();
    expect(second.get('targetLanguage')).toBe('fr');
    expect((await fakeBrowser.storage.local.get(null)).__configSchemaVersion).toBe(6);
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
