import { describe, expect, it } from 'vitest';
import { baseLanguageTag, COMMON_LANGUAGES, languageName } from './languages';

describe('languageName', () => {
  it('returns the display name for a known code', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('ja')).toBe('Japanese');
  });

  it('falls back to the raw code for an unknown code', () => {
    expect(languageName('zz')).toBe('zz');
  });
});

describe('baseLanguageTag', () => {
  it('strips a region subtag', () => {
    expect(baseLanguageTag('pt-BR')).toBe('pt');
    expect(baseLanguageTag('en-US')).toBe('en');
  });

  it('strips a script subtag', () => {
    expect(baseLanguageTag('zh-Hans')).toBe('zh');
  });

  it('lowercases the result', () => {
    expect(baseLanguageTag('EN-us')).toBe('en');
  });

  it('leaves a bare code unchanged', () => {
    expect(baseLanguageTag('fr')).toBe('fr');
  });
});

describe('COMMON_LANGUAGES', () => {
  it('has no duplicate codes', () => {
    const codes = COMMON_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
