import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT_VERSION, parseBackup, serializeBackup } from './backup';
import { defaultConfig } from './schema';

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
});
