import { describe, expect, it } from 'vitest';
import { applyConfigMigrations, CONFIG_SCHEMA_VERSION, configMigrations } from './migrations';

describe('applyConfigMigrations', () => {
  it('is a no-op at or above the current version', () => {
    const raw = { targetLanguage: 'es', someOtherKey: 42 };
    expect(applyConfigMigrations(raw, CONFIG_SCHEMA_VERSION)).toEqual(raw);
  });

  it('toVersion 1 adopts Session 2s ad hoc provider keys into the real schema field names', () => {
    const raw = {
      libreTranslateBaseUrl: 'https://libretranslate.com',
      libreTranslateApiKey: 'secret',
      targetLanguage: 'fr',
    };
    const migrated = applyConfigMigrations(raw, 0);
    expect(migrated).toEqual({
      providerBaseUrl: 'https://libretranslate.com',
      providerApiKey: 'secret',
      targetLanguage: 'fr',
    });
    expect(Object.hasOwn(migrated, 'libreTranslateBaseUrl')).toBe(false);
    expect(Object.hasOwn(migrated, 'libreTranslateApiKey')).toBe(false);
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
});
