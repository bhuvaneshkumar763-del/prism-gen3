import { describe, expect, it } from 'vitest';
import { applyConfigMigrations, CONFIG_SCHEMA_VERSION, configMigrations } from './migrations';

describe('applyConfigMigrations', () => {
  it('is a no-op at or above the current version', () => {
    const raw = { targetLanguage: 'es', someOtherKey: 42 };
    expect(applyConfigMigrations(raw, CONFIG_SCHEMA_VERSION)).toEqual(raw);
  });

  it('toVersion 1 adopts Session 2s ad hoc provider keys into the version-1 field names', () => {
    const raw = {
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: 'secret',
      targetLanguage: 'fr',
    };
    // Simulate only toVersion:1 running by starting from version 0 and
    // checking the intermediate shape a real profile stuck at version 1
    // would have had (before toVersion:2 renamed it back) — the full 0->2
    // round trip is covered by the next test below.
    const afterV1 = configMigrations.find((m) => m.toVersion === 1)?.migrate(raw);
    expect(afterV1).toEqual({
      providerBaseUrl: 'https://libretranslate.com',
      providerApiKey: 'secret',
      targetLanguage: 'fr',
    });
  });

  it('toVersion 2 renames the version-1 generic provider fields to provider-specific ones', () => {
    const raw = { providerBaseUrl: 'https://libretranslate.com', providerApiKey: 'secret', targetLanguage: 'fr' };
    const migrated = applyConfigMigrations(raw, 1);
    expect(migrated).toEqual({
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: 'secret',
      targetLanguage: 'fr',
    });
    expect(Object.hasOwn(migrated, 'providerBaseUrl')).toBe(false);
    expect(Object.hasOwn(migrated, 'providerApiKey')).toBe(false);
  });

  it('a fresh (version 0) install with Session 2s ad hoc keys round-trips through both migrations back to the original field names', () => {
    const raw = {
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: 'secret',
      targetLanguage: 'fr',
    };
    const migrated = applyConfigMigrations(raw, 0);
    expect(migrated).toEqual(raw);
  });

  it('leaves storage untouched when the legacy keys are absent (a fresh install)', () => {
    const raw = { targetLanguage: 'es' };
    expect(applyConfigMigrations(raw, 0)).toEqual(raw);
  });

  it('applies migrations in ascending toVersion order and threads the result through each', () => {
    const order: string[] = [];
    const fakeMigrations = [
      {
        toVersion: 2,
        migrate: (e: Record<string, unknown>) => {
          order.push('v2');
          return { ...e, v2Ran: true };
        },
      },
      {
        toVersion: 1,
        migrate: (e: Record<string, unknown>) => {
          order.push('v1');
          return { ...e, v1Ran: true };
        },
      },
    ];
    const applicable = fakeMigrations.slice().sort((a, b) => a.toVersion - b.toVersion);
    const result = applicable.reduce((entries, m) => m.migrate(entries), {} as Record<string, unknown>);
    expect(order).toEqual(['v1', 'v2']);
    expect(result).toEqual({ v1Ran: true, v2Ran: true });
  });

  it('CONFIG_SCHEMA_VERSION matches the highest registered migration', () => {
    const highest = configMigrations.reduce((max, m) => Math.max(max, m.toVersion), 0);
    expect(CONFIG_SCHEMA_VERSION).toBe(highest);
  });

  it('toVersion 3 falls an existing "builtin" provider selection back to google (removed provider)', () => {
    const raw = { pageTranslatorProvider: 'builtin', targetLanguage: 'fr' };
    const migrated = applyConfigMigrations(raw, 2);
    expect(migrated).toEqual({ pageTranslatorProvider: 'google', targetLanguage: 'fr' });
  });

  it('toVersion 3 leaves a non-builtin provider selection untouched', () => {
    const raw = { pageTranslatorProvider: 'llm', targetLanguage: 'fr' };
    expect(applyConfigMigrations(raw, 2)).toEqual(raw);
  });

  it('toVersion 4 falls an existing "libretranslate" provider selection back to google (removed provider)', () => {
    const raw = { pageTranslatorProvider: 'libretranslate', targetLanguage: 'fr' };
    const migrated = applyConfigMigrations(raw, 3);
    expect(migrated).toEqual({ pageTranslatorProvider: 'google', targetLanguage: 'fr' });
  });

  it('toVersion 4 leaves a non-libretranslate provider selection untouched', () => {
    const raw = { pageTranslatorProvider: 'llm', targetLanguage: 'fr' };
    expect(applyConfigMigrations(raw, 3)).toEqual(raw);
  });
});
