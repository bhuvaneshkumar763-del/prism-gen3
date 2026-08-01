/**
 * Versioned config migrations — the pattern itself is a "keep the good
 * part" from the old repo (pure functions over raw storage entries,
 * applied ascending, gated on a stored version marker), rebuilt fresh here
 * rather than retrofitted later, per the Gen 3 plan's design principle #2
 * (coverage/correctness infrastructure from day one, not backfilled).
 *
 * `CONFIG_SCHEMA_VERSION` starts at 1 with one real migration, not zero —
 * Session 2's `src/platform/providerConfig.ts` wrote two un-versioned raw
 * keys (`libreTranslateBaseUrl`, `libreTranslateApiKey`) directly to
 * `browser.storage.local` before this versioned system existed. Anyone who
 * ran that build has those keys sitting on disk; this migration adopts
 * them into the real schema's field names (`providerBaseUrl`/
 * `providerApiKey`) instead of leaving them orphaned or silently losing a
 * dev profile's settings the first time the real config store loads.
 *
 * Version 2 (Session 4): the generic `providerBaseUrl`/`providerApiKey`
 * fields from version 1 turned out to be the wrong shape once more than
 * one provider existed (LLM needs a model name too; Google Cloud needs
 * just a key; Google/Builtin need nothing) — a real, not contrived,
 * course correction. Renames them back to a provider-specific name
 * (`libreTranslateBaseUrl`/`libreTranslateApiKey`, since that's what they
 * were actually holding — the store only ever configured LibreTranslate
 * before Session 4 added the others).
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

export const CONFIG_SCHEMA_VERSION = 2;

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
): Record<string, unknown> {
  return configMigrations
    .filter((m) => m.toVersion > storedVersion)
    .sort((a, b) => a.toVersion - b.toVersion)
    .reduce((entries, m) => m.migrate(entries), rawEntries);
}
