import { describe, expect, it } from 'vitest';
import { COMMON_LANGUAGES, languageName } from './languages';

describe('languageName', () => {
  it('returns the display name for a known code', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('ja')).toBe('Japanese');
  });

  it('falls back to the raw code for an unknown code', () => {
    expect(languageName('zz')).toBe('zz');
  });
});

describe('COMMON_LANGUAGES', () => {
  it('has no duplicate codes', () => {
    const codes = COMMON_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
