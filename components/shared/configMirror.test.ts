import { fakeBrowser } from '@webext-core/fake-browser';
import { createMemo, createRoot } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConfigStore } from '../../src/platform/configStore';
import { type Config, type ConfigKey, defaultConfig } from '../../src/shared/config/schema';
import { type ConfigMirrorSource, createConfigMirror } from './configMirror';

/** A source whose readiness and change events the test drives by hand. */
function manualSource(stored: Partial<Config> = {}) {
  const state: Config = { ...defaultConfig, ...stored };
  const listeners = new Set<(name: ConfigKey, value: unknown) => void>();
  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const source: ConfigMirrorSource = {
    onReady: () => readyPromise,
    get: (key) => state[key],
    onChanged(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return {
    source,
    listeners,
    makeReady: async () => {
      resolveReady();
      await readyPromise;
      await Promise.resolve();
    },
    emit<K extends ConfigKey>(key: K, value: Config[K]) {
      state[key] = value;
      for (const cb of listeners) cb(key, value);
    },
  };
}

function mountMirror(source: ConfigMirrorSource) {
  return createRoot((dispose) => ({ mirror: createConfigMirror(source), dispose }));
}

describe('createConfigMirror', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('holds the defaults until ready, then the stored values', async () => {
    const fake = manualSource({ targetLanguage: 'vi', bubbleByHost: { 'a.com': false } });
    const { mirror, dispose } = mountMirror(fake.source);
    expect(mirror.ready()).toBe(false);
    expect(mirror.config.targetLanguage).toBe(defaultConfig.targetLanguage);

    await fake.makeReady();
    expect(mirror.ready()).toBe(true);
    expect(mirror.config.targetLanguage).toBe('vi');
    expect({ ...mirror.config.bubbleByHost }).toEqual({ 'a.com': false });
    dispose();
  });

  it('updates reactive readers when the config store reports a change', async () => {
    const fake = manualSource();
    const { mirror, dispose } = mountMirror(fake.source);
    await fake.makeReady();
    const label = createRoot(() =>
      createMemo(() => `${mirror.config.targetLanguage}:${mirror.config.targetLanguages.length}`),
    );
    expect(label()).toBe('en:0');

    fake.emit('targetLanguage', 'fr');
    fake.emit('targetLanguages', ['fr', 'de']);
    expect(label()).toBe('fr:2');
    dispose();
  });

  it('replaces record values, so a removed key is gone and key checks re-run', async () => {
    const fake = manualSource({ bubbleByHost: { 'a.com': false } });
    const { mirror, dispose } = mountMirror(fake.source);
    await fake.makeReady();
    // Object.hasOwn on a store proxy isn't tracked per key; replacing the
    // whole record is what makes this memo update.
    const hasB = createRoot(() => createMemo(() => Object.hasOwn(mirror.config.bubbleByHost, 'b.com')));
    expect(hasB()).toBe(false);

    fake.emit('bubbleByHost', { 'a.com': false, 'b.com': true });
    expect(hasB()).toBe(true);

    fake.emit('bubbleByHost', { 'b.com': true });
    expect(Object.keys(mirror.config.bubbleByHost)).toEqual(['b.com']);
    dispose();
  });

  it('setLocal changes the mirror without writing to the source', async () => {
    const fake = manualSource();
    const { mirror, dispose } = mountMirror(fake.source);
    await fake.makeReady();
    mirror.setLocal('theme', 'dark');
    expect(mirror.config.theme).toBe('dark');
    expect(fake.source.get('theme')).toBe('auto');
    dispose();
  });

  it('unsubscribes on cleanup and ignores later changes', async () => {
    const fake = manualSource();
    const { mirror, dispose } = mountMirror(fake.source);
    await fake.makeReady();
    expect(fake.listeners.size).toBe(1);

    dispose();
    expect(fake.listeners.size).toBe(0);
    fake.emit('targetLanguage', 'ja');
    expect(mirror.config.targetLanguage).toBe('en');
  });

  it('does not fill or turn ready when disposed before the store is ready', async () => {
    const fake = manualSource({ targetLanguage: 'vi' });
    const { mirror, dispose } = mountMirror(fake.source);
    dispose();
    await fake.makeReady();
    expect(mirror.ready()).toBe(false);
    expect(mirror.config.targetLanguage).toBe('en');
  });

  it('does not share nested default objects with defaultConfig', async () => {
    const fake = manualSource();
    const { mirror, dispose } = mountMirror(fake.source);
    expect(mirror.config.bubbleByHost).not.toBe(defaultConfig.bubbleByHost);
    dispose();
  });

  it('follows a real config store through storage', async () => {
    const store = createConfigStore();
    const { mirror, dispose } = mountMirror(store);
    await store.onReady();
    await Promise.resolve();
    expect(mirror.ready()).toBe(true);

    await store.set('hoverTooltipEnabled', false);
    expect(mirror.config.hoverTooltipEnabled).toBe(false);
    dispose();
  });
});
