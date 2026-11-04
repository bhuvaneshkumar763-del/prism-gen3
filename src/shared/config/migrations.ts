/**
 * Versioned config migrations: pure functions over raw storage entries,
 * applied in ascending order past the stored version marker.
 *
 * - v1: adopt the pre-versioning `libreTranslate*` keys as `provider*`.
 * - v2: rename `provider*` back to `libreTranslate*` (per-provider fields).
 * - v3/v4: the `builtin` and `libretranslate` providers were removed; a
 *   stored value falls back to `'google'`.
 * - v5: the `llm` provider was removed; falls back to `'google'`, and its
 *   fields are deleted because one of them is an API key.
 * - v6: the `libreTranslate*` fields are deleted, for the same reason.
 */

export interface ConfigMigration {
  /** The schema version this migration upgrades stored data TO. */
  toVersion: number;
  /**
   * Rewrites raw storage entries in place. A key present in the input but
   * absent from the returned object is treated as a deletion by the
   * caller (see configStore.ts) — actually removed from storage, not just
   * left stale.
   */
  migrate(rawEntries: Record<string, unknown>): Record<string, unknown>;
}

export const CONFIG_SCHEMA_VERSION = 6;

export const configMigrations: ConfigMigration[] = [
  {
    toVersion: 1,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      if (typeof next.libreTranslateBaseUrl === 'string') {
        next.providerBaseUrl = next.libreTranslateBaseUrl;
        delete next.libreTranslateBaseUrl;
      }
      if (typeof next.libreTranslateApiKey === 'string') {
        next.providerApiKey = next.libreTranslateApiKey;
        delete next.libreTranslateApiKey;
      }
      return next;
    },
  },
  {
    toVersion: 2,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      if (typeof next.providerBaseUrl === 'string') {
        next.libreTranslateBaseUrl = next.providerBaseUrl;
        delete next.providerBaseUrl;
      }
      if (typeof next.providerApiKey === 'string') {
        next.libreTranslateApiKey = next.providerApiKey;
        delete next.providerApiKey;
      }
      return next;
    },
  },
  {
    toVersion: 3,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      if (next.pageTranslatorProvider === 'builtin') {
        next.pageTranslatorProvider = 'google';
      }
      return next;
    },
  },
  {
    toVersion: 4,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      if (next.pageTranslatorProvider === 'libretranslate') {
        next.pageTranslatorProvider = 'google';
      }
      return next;
    },
  },
  {
    toVersion: 5,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      if (next.pageTranslatorProvider === 'llm') {
        next.pageTranslatorProvider = 'google';
      }
      delete next.llmBaseUrl;
      delete next.llmApiKey;
      delete next.llmModel;
      return next;
    },
  },
  {
    toVersion: 6,
    migrate(rawEntries) {
      const next = { ...rawEntries };
      delete next.libreTranslateBaseUrl;
      delete next.libreTranslateApiKey;
      return next;
    },
  },
];

/**
 * Applies every migration whose `toVersion` is above `storedVersion`, in
 * ascending order. Pure — no storage I/O — so it's directly unit-testable;
 * the storage adapter is responsible for reading/writing the actual raw
 * entries and the version marker around this call.
 */
export function applyConfigMigrations(
  rawEntries: Record<string, unknown>,
  storedVersion: number,
  /** Injectable for tests that need to verify the ordering/threading contract in isolation from the real, ever-growing migration list. Defaults to the real one. */
  migrations: ConfigMigration[] = configMigrations,
): Record<string, unknown> {
  return migrations
    .filter((m) => m.toVersion > storedVersion)
    .sort((a, b) => a.toVersion - b.toVersion)
    .reduce((entries, m) => m.migrate(entries), rawEntries);
}
