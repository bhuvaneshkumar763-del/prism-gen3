import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ConfigStore } from '../../src/platform/configStore';
import { type Config, type ConfigKey, defaultConfig } from '../../src/shared/config/schema';

export type ConfigMirrorSource = Pick<ConfigStore, 'onReady' | 'get' | 'onChanged'>;

export interface ConfigMirror {
  /** Every config key, reactive: read it in JSX/memos instead of `configStore.get()`. */
  readonly config: Config;
  /** True once `onReady()` has resolved and `config` holds the stored values. */
  readonly ready: Accessor<boolean>;
  /** Changes the mirror only, not storage: for optimistic updates and rollbacks. */
  setLocal<K extends ConfigKey>(key: K, value: Config[K]): void;
}

/**
 * A Solid store that mirrors the whole config and follows
 * `source.onChanged`. Holds the defaults until `ready()`. Call it inside a
 * component or root: it unsubscribes on cleanup.
 */
export function createConfigMirror(source: ConfigMirrorSource): ConfigMirror {
  const [config, setConfig] = createStore<Config>(structuredClone(defaultConfig));
  const [ready, setReady] = createSignal(false);
  let disposed = false;

  // Top-level `setConfig({ key })` replaces the value; `setConfig(key, obj)`
  // would merge into the old object, keeping removed per-host keys.
  function setLocal<K extends ConfigKey>(key: K, value: Config[K]): void {
    setConfig({ [key]: value } as Partial<Config>);
  }

  const unsubscribe = source.onChanged((name, value) => {
    setLocal(name, value as never);
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
  });

  void source.onReady().then(() => {
    if (disposed) return;
    const keys = Object.keys(defaultConfig) as ConfigKey[];
    setConfig(Object.fromEntries(keys.map((key) => [key, source.get(key)])) as Partial<Config>);
    setReady(true);
  });

  return { config, ready, setLocal };
}
