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

  /**
   * Returns the raw entries `initConfig()` should read from — the snapshot
   * this function already fetched to check the version, whether or not a
   * migration actually ran. Post-launch speed pass: this used to only
   * migrate, and `initConfig()` did its own separate `backend.getAll()`
   * right after — a second full `browser.storage.local.get(null)` round
   * trip on every fresh content-script load and background service-worker
   * wake, even in the common case (already at the current version) where
   * nothing changed between the two reads. `applyConfigMigrations()`
   * already returns the complete post-migration key set (not a patch), so
   * it can be handed straight to the caller instead of re-reading it back
   * from storage.
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

    // A migration signals "delete this key" by omitting it from its
    // returned object — backend.set() above only ever merges, so anything
    // a migration dropped needs an explicit remove() or it just sits there
    // orphaned forever.
    const removedKeys = Object.keys(raw).filter((key) => key !== VERSION_KEY && !Object.hasOwn(migrated, key));
    if (removedKeys.length > 0) {
      await backend.remove(removedKeys);
    }

    await backend.set({ [VERSION_KEY]: CONFIG_SCHEMA_VERSION });
    return { ...migrated, [VERSION_KEY]: CONFIG_SCHEMA_VERSION };
  }

  async function initConfig(): Promise<void> {
    const raw = await migrateIfNeeded();
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

  /** Shared by `import()` and `restoreToDefault()` — not called via `this` so neither depends on how the returned object is invoked. */
  async function applyValidatedConfig(json: string): Promise<void> {
    const parsed: unknown = JSON.parse(json);
    const validated = configSchema.partial().parse(parsed);
    const entries = Object.fromEntries(
      (Object.keys(validated) as ConfigKey[])
        .filter((key) => validated[key] !== undefined)
        .map((key) => [key, validated[key]]),
    );
    if (Object.keys(entries).length > 0) await backend.set(entries);
    // Reflect the change immediately in this instance's own state too — the
    // onChanged round trip above will also eventually update it, but
    // callers that read get() right after shouldn't see stale values while
    // waiting on that.
    for (const key of Object.keys(validated) as ConfigKey[]) {
      const value = validated[key];
      if (value !== undefined) (state as Record<ConfigKey, unknown>)[key] = value;
    }
  }

  return {
    onReady(): Promise<void> {
      if (!readyPromise) {
        readyPromise = initConfig().catch((e) => {
          // A rejected promise is still truthy, so without clearing it here
          // a single transient failure (a storage API hiccup, a quota edge
          // case) would wedge every future onReady() call in this context
          // onto the same dead rejection forever — including this store's
          // own diagnostics tool, whose whole job is to help debug exactly
          // this kind of failure. Clearing it lets the next call retry.
          readyPromise = null;
          throw e;
        });
      }
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
    /**
     * Writes several keys as ONE storage operation instead of N independent
     * `set()` calls. Needed anywhere a caller's own invariant spans more than
     * one key — e.g. `configMutations.ts`'s `applyListPatch`, which can touch
     * both the always- and never-translate lists in a single site-list patch.
     * N separate `backend.set()` calls means a mid-sequence failure can land
     * only some of them, leaving the two lists in a state neither surface
     * ever intended (a site on both simultaneously). One combined call
     * either fully applies or fully fails.
     */
    async setMany(entries: Partial<Config>): Promise<void> {
      const keys = Object.keys(entries) as ConfigKey[];
      if (keys.length === 0) return;
      for (const key of keys) (state as Record<ConfigKey, unknown>)[key] = entries[key];
      await backend.set(entries);
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
      await applyValidatedConfig(json);
    },
    /**
     * Writes every key back to `defaultConfig`'s value. Implemented as
     * `import(JSON.stringify(defaultConfig))` — deliberately NOT followed by
     * a `browser.runtime.reload()` the way the pre-rewrite fork's equivalent
     * did: this store's `import()` already updates in-memory state and
     * fires `onChanged` on its own, and reloading the extension mid-write
     * from inside the options page that called this would just kill the
     * page. Callers that want a visible "defaults restored" confirmation
     * show it themselves (see `entrypoints/options/App.tsx`).
     */
    async restoreToDefault(): Promise<void> {
      await applyValidatedConfig(JSON.stringify(defaultConfig));
    },
  };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;

export const configStore = createConfigStore();
