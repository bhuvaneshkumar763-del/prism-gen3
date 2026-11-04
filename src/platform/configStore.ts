import { applyConfigMigrations, CONFIG_SCHEMA_VERSION } from '../shared/config/migrations';
import { type Config, type ConfigKey, defaultConfig } from '../shared/config/schema';
import { configValidators, parsePartialConfigOrThrow } from '../shared/config/validate';
import { localStorageBackend } from './storage/localBackend';
import type { StorageBackend } from './storage/types';

/**
 * The config store: `get`/`set`/`onReady`/`onChanged`/`import` over an
 * injected `StorageBackend` (see docs/decisions/0003-settings-sync-deferred.md
 * for why that seam exists).
 */

const VERSION_KEY = '__configSchemaVersion';

export function createConfigStore(backend: StorageBackend = localStorageBackend) {
  const state: Config = { ...defaultConfig };
  const listeners = new Set<(name: ConfigKey, value: unknown) => void>();

  let readyPromise: Promise<void> | null = null;
  /** Keys a live change updated while `initConfig()` was reading; its snapshot may be older than them. */
  const changedDuringInit = new Set<ConfigKey>();

  /**
   * Migrates stored config if it's behind the current schema version and
   * returns the resulting entries, so `initConfig()` needn't read storage again.
   */
  async function migrateIfNeeded(): Promise<Record<string, unknown>> {
    const raw = await backend.getAll();
    const storedVersion = typeof raw[VERSION_KEY] === 'number' ? (raw[VERSION_KEY] as number) : 0;
    if (storedVersion >= CONFIG_SCHEMA_VERSION) return raw;

    const migrated = applyConfigMigrations(raw, storedVersion);
    const changedEntries = Object.fromEntries(Object.entries(migrated).filter(([key, value]) => raw[key] !== value));
    if (Object.keys(changedEntries).length > 0) {
      await backend.set(changedEntries);
    }

    // A migration deletes a key by omitting it; backend.set() only merges,
    // so dropped keys need an explicit remove().
    const removedKeys = Object.keys(raw).filter((key) => key !== VERSION_KEY && !Object.hasOwn(migrated, key));
    if (removedKeys.length > 0) {
      await backend.remove(removedKeys);
    }

    await backend.set({ [VERSION_KEY]: CONFIG_SCHEMA_VERSION });
    return { ...migrated, [VERSION_KEY]: CONFIG_SCHEMA_VERSION };
  }

  /**
   * Adopts each stored value only if it passes its validator; otherwise the
   * default stays. Never throws on bad values, so startup can't fail on them.
   */
  async function initConfig(): Promise<void> {
    changedDuringInit.clear();
    const raw = await migrateIfNeeded();
    for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
      if (!Object.hasOwn(raw, key) || changedDuringInit.has(key)) continue;
      const result = configValidators[key](raw[key]);
      if (result.ok) {
        (state as Record<ConfigKey, unknown>)[key] = result.value;
      } else {
        console.warn(
          `[prism] stored value for config key "${key}" failed validation, using the default instead`,
          result.message,
        );
      }
    }
  }

  backend.onChanged((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key === VERSION_KEY) continue;
      if (!Object.hasOwn(defaultConfig, key)) continue;
      const configKey = key as ConfigKey;
      // Validate live changes too: storage may hold a shape from another
      // extension version, and a removal arrives as `newValue === undefined`.
      const result = configValidators[configKey](change.newValue);
      if (!result.ok) {
        console.warn(
          `[prism] live config change for key "${configKey}" failed validation, ignoring it`,
          result.message,
        );
        continue;
      }
      (state as Record<ConfigKey, unknown>)[configKey] = result.value;
      changedDuringInit.add(configKey);
      listeners.forEach((cb) => {
        cb(configKey, result.value);
      });
    }
  });

  /**
   * Updates state before the write so a get() right after sees it, and puts
   * the old values back if the write fails, unless a live change has since
   * replaced them.
   */
  async function writeThrough(entries: Partial<Config>): Promise<void> {
    const keys = Object.keys(entries) as ConfigKey[];
    const previous = keys.map((key) => [key, state[key]] as const);
    for (const key of keys) (state as Record<ConfigKey, unknown>)[key] = entries[key];
    try {
      await backend.set(entries);
    } catch (e) {
      for (const [key, value] of previous) {
        if (state[key] === entries[key]) (state as Record<ConfigKey, unknown>)[key] = value;
      }
      throw e;
    }
  }

  /** Shared by `import()` and `restoreToDefault()`; not called via `this` so neither depends on how the returned object is invoked. */
  async function applyValidatedConfig(json: string): Promise<void> {
    const parsed: unknown = JSON.parse(json);
    const validated = parsePartialConfigOrThrow(parsed);
    const entries = Object.fromEntries(
      (Object.keys(validated) as ConfigKey[])
        .filter((key) => validated[key] !== undefined)
        .map((key) => [key, validated[key]]),
    );
    if (Object.keys(entries).length > 0) await backend.set(entries);
    // Update local state now so a get() right after doesn't wait on the
    // onChanged round trip.
    for (const key of Object.keys(validated) as ConfigKey[]) {
      const value = validated[key];
      if (value !== undefined) (state as Record<ConfigKey, unknown>)[key] = value;
    }
  }

  return {
    onReady(): Promise<void> {
      if (!readyPromise) {
        readyPromise = initConfig().catch((e) => {
          // Clear the rejected promise so one transient storage failure
          // doesn't wedge every later onReady() call in this context.
          readyPromise = null;
          throw e;
        });
      }
      return readyPromise;
    },
    get<K extends ConfigKey>(key: K): Config[K] {
      return state[key];
    },
    async set<K extends ConfigKey>(key: K, value: Config[K]): Promise<void> {
      await writeThrough({ [key]: value } as Partial<Config>);
      // Listeners aren't notified here: backend.onChanged also fires for
      // same-context writes (see localBackend).
    },
    /**
     * Writes several keys as one storage operation, so a caller whose
     * invariant spans keys (e.g. the always/never-translate lists) can't be
     * left half-applied by a mid-sequence failure.
     */
    async setMany(entries: Partial<Config>): Promise<void> {
      if (Object.keys(entries).length === 0) return;
      await writeThrough(entries);
    },
    /** Returns an unsubscribe function. */
    onChanged(callback: (name: ConfigKey, value: unknown) => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async import(json: string): Promise<void> {
      await applyValidatedConfig(json);
    },
    /**
     * Writes every key back to `defaultConfig`. No extension reload: `import()`
     * already updates state and fires `onChanged`, and reloading would kill
     * the options page that called this.
     */
    async restoreToDefault(): Promise<void> {
      await applyValidatedConfig(JSON.stringify(defaultConfig));
    },
  };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;

export const configStore = createConfigStore();
