import { applyConfigMigrations, CONFIG_SCHEMA_VERSION } from '../shared/config/migrations';
import { type Config, type ConfigKey, configSchema, defaultConfig } from '../shared/config/schema';
import { localStorageBackend } from './storage/localBackend';
import type { StorageBackend } from './storage/types';

/**
 * The real config store (Gen 3 plan, Session 3) — replaces Session 2's ad
 * hoc `providerConfig.ts`. Public API shape (`get`/`set`/`onReady`/
 * `onChanged`/`export`/`import`) is a deliberate "keep the good part" from
 * the old repo's `twpConfig` — same proven surface, fresh implementation,
 * fresh name, and built on an injected `StorageBackend` instead of
 * `browser.storage` directly (see docs/decisions/0003-settings-sync-deferred.md
 * for why that seam exists).
 */

const VERSION_KEY = '__configSchemaVersion';

export function createConfigStore(backend: StorageBackend = localStorageBackend) {
  const state: Config = { ...defaultConfig };
  const listeners = new Set<(name: ConfigKey, value: unknown) => void>();

  let configIsReady = false;
  let readyPromise: Promise<void> | null = null;

  async function migrateIfNeeded(): Promise<void> {
    const raw = await backend.getAll();
    const storedVersion = typeof raw[VERSION_KEY] === 'number' ? (raw[VERSION_KEY] as number) : 0;
    if (storedVersion >= CONFIG_SCHEMA_VERSION) return;

    const migrated = applyConfigMigrations(raw, storedVersion);
    const changedEntries = Object.fromEntries(Object.entries(migrated).filter(([key, value]) => raw[key] !== value));
    if (Object.keys(changedEntries).length > 0) {
      await backend.set(changedEntries);
    }

    // A migration signals "delete this key" by omitting it from its
    // returned object — backend.set() above only ever merges, so anything
    // a migration dropped needs an explicit remove() or it just sits there
    // orphaned forever.
    const removedKeys = Object.keys(raw).filter((key) => key !== VERSION_KEY && !Object.hasOwn(migrated, key));
    if (removedKeys.length > 0) {
      await backend.remove(removedKeys);
    }

    await backend.set({ [VERSION_KEY]: CONFIG_SCHEMA_VERSION });
  }

  async function initConfig(): Promise<void> {
    await migrateIfNeeded();
    const raw = await backend.getAll();
    for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
      if (Object.hasOwn(raw, key)) {
        (state as Record<ConfigKey, unknown>)[key] = raw[key];
      }
    }
    configIsReady = true;
  }

  backend.onChanged((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key === VERSION_KEY) continue;
      if (!Object.hasOwn(defaultConfig, key)) continue;
      const configKey = key as ConfigKey;
      (state as Record<ConfigKey, unknown>)[configKey] = change.newValue;
      listeners.forEach((cb) => {
        cb(configKey, change.newValue);
      });
    }
  });

  return {
    onReady(): Promise<void> {
      if (!readyPromise) readyPromise = initConfig();
      return readyPromise;
    },
    isReady(): boolean {
      return configIsReady;
    },
    get<K extends ConfigKey>(key: K): Config[K] {
      return state[key];
    },
    async set<K extends ConfigKey>(key: K, value: Config[K]): Promise<void> {
      state[key] = value;
      await backend.set({ [key]: value });
      // backend.onChanged fires for this same write too (chrome.storage's
      // own onChanged event covers same-context writes), so listeners
      // aren't notified twice — see the localBackend doc comment.
    },
    /** Returns an unsubscribe function. */
    onChanged(callback: (name: ConfigKey, value: unknown) => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async export(): Promise<string> {
      return JSON.stringify(state, null, 2);
    },
    async import(json: string): Promise<void> {
      const parsed: unknown = JSON.parse(json);
      const validated = configSchema.partial().parse(parsed);
      await Promise.all(
        (Object.keys(validated) as ConfigKey[]).map((key) => {
          const value = validated[key];
          return value === undefined ? Promise.resolve() : backend.set({ [key]: value });
        }),
      );
      // Reflect the import immediately in this instance's own state too —
      // the onChanged round trip above will also eventually update it, but
      // callers that read get() right after import() shouldn't see stale
      // values while waiting on that.
      for (const key of Object.keys(validated) as ConfigKey[]) {
        const value = validated[key];
        if (value !== undefined) (state as Record<ConfigKey, unknown>)[key] = value;
      }
    },
  };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;

export const configStore = createConfigStore();
