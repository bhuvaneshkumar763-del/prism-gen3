import { describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT_VERSION, parseBackup, serializeBackup } from './backup';
import type * as Migrations from './migrations';
import { defaultConfig } from './schema';
import { validatePartialConfig } from './validate';

// Adds one inert migration on top of the real list, to show a migration added
// to migrations.ts reaches backups without a second copy here.
vi.mock('./migrations', async (importOriginal) => {
  const actual = await importOriginal<typeof Migrations>();
  const retiredLanguageMigration: Migrations.ConfigMigration = {
    toVersion: actual.CONFIG_SCHEMA_VERSION + 1,
    migrate: (entries) =>
      entries.targetLanguage === 'retired-test-code' ? { ...entries, targetLanguage: 'fr' } : entries,
  };
  return {
    ...actual,
    applyConfigMigrations: (rawEntries: Record<string, unknown>, storedVersion: number) =>
      actual.applyConfigMigrations(rawEntries, storedVersion, [...actual.configMigrations, retiredLanguageMigration]),
  };
});

const { applyConfigMigrations: realApplyConfigMigrations } = await vi.importActual<typeof Migrations>('./migrations');

describe('serializeBackup', () => {
  it('wraps the config with version and timestamp metadata', () => {
    const json = serializeBackup(defaultConfig, 12345);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(BACKUP_FORMAT_VERSION);
    expect(parsed.timestamp).toBe(12345);
    expect(parsed.config.targetLanguage).toBe(defaultConfig.targetLanguage);
  });
});

describe('parseBackup', () => {
  it('round-trips a real serialized backup', () => {
    const json = serializeBackup({ ...defaultConfig, targetLanguage: 'ja' }, 1);
    const result = parseBackup(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetLanguage).toBe('ja');
  });

  it("accepts a bare config object (configStore.export()'s own shape)", () => {
    const json = JSON.stringify({ ...defaultConfig, targetLanguage: 'fr' });
    const result = parseBackup(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetLanguage).toBe('fr');
  });

  it('returns a real error for malformed JSON, does not throw', () => {
    const result = parseBackup('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('valid JSON');
  });

  it('an object with only unrecognized keys parses as an empty (no-op) partial config, same as configStore.import()', () => {
    // configSchema.partial() validates every known field as optional, so an
    // object with zero matching keys is a legitimately empty (but valid)
    // partial config, not a validation failure — same behavior
    // configStore.ts's own "ignores unknown fields rather than throwing"
    // test documents for import(). A real error only happens when a KNOWN
    // key has the wrong type (see the next test).
    const result = parseBackup(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('returns a real error when a known key has the wrong type', () => {
    const result = parseBackup(JSON.stringify({ targetLanguage: 42 }));
    expect(result.ok).toBe(false);
  });

  it('accepts a partial config (only some keys present)', () => {
    const result = parseBackup(JSON.stringify({ targetLanguage: 'de' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetLanguage).toBe('de');
      expect(result.value.sourceLanguage).toBeUndefined();
    }
  });

  it('accepts an empty object', () => {
    const result = parseBackup('{}');
    expect(result.ok).toBe(true);
  });

  it('falls back a legacy pageTranslatorProvider value (builtin/libretranslate) to google, same as the stored-config migration path, instead of rejecting the whole backup', () => {
    for (const legacy of ['builtin', 'libretranslate']) {
      const result = parseBackup(JSON.stringify({ ...defaultConfig, pageTranslatorProvider: legacy }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.pageTranslatorProvider).toBe('google');
    }
  });

  it('restores a backup from before the LLM provider was removed: provider falls back to google, its fields are dropped', () => {
    const old = {
      ...defaultConfig,
      pageTranslatorProvider: 'llm',
      llmBaseUrl: 'http://x',
      llmApiKey: 'k',
      llmModel: 'm',
    };
    const result = parseBackup(JSON.stringify(old));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageTranslatorProvider).toBe('google');
      expect(result.value).not.toHaveProperty('llmApiKey');
    }
  });

  it('runs a backup through the same migrations as stored config, so a new migration needs no copy here', () => {
    const result = parseBackup(JSON.stringify({ targetLanguage: 'retired-test-code' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetLanguage).toBe('fr');
  });

  it('imports an old-version backup to the same settings that stored config of that version migrates to', () => {
    const oldConfigs: Array<{ storedVersion: number; raw: Record<string, unknown> }> = [
      { storedVersion: 0, raw: { libreTranslateBaseUrl: 'https://lt.example', targetLanguage: 'de' } },
      { storedVersion: 1, raw: { providerBaseUrl: 'https://lt.example', providerApiKey: 'k', targetLanguage: 'de' } },
      { storedVersion: 2, raw: { ...defaultConfig, pageTranslatorProvider: 'builtin' } },
      { storedVersion: 3, raw: { ...defaultConfig, pageTranslatorProvider: 'libretranslate', targetLanguage: 'ja' } },
      {
        storedVersion: 4,
        raw: { ...defaultConfig, pageTranslatorProvider: 'llm', llmBaseUrl: 'http://x', llmApiKey: 'k', llmModel: 'm' },
      },
    ];
    for (const { storedVersion, raw } of oldConfigs) {
      const stored = validatePartialConfig(realApplyConfigMigrations({ ...raw }, storedVersion));
      const imported = parseBackup(JSON.stringify({ version: BACKUP_FORMAT_VERSION, timestamp: 1, config: raw }));
      expect(stored.ok).toBe(true);
      expect(imported.ok).toBe(true);
      if (stored.ok && imported.ok) expect(imported.value).toEqual(stored.value);
    }
  });
});
