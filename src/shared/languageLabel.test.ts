import { describe, expect, it } from 'vitest';
import { languageLabel } from './languageLabel';

describe('languageLabel', () => {
  it('names a language from the common list', () => {
    expect(languageLabel('ja')).toBe('Japanese');
  });

  it('names the Chinese variants Google uses by script, not by country', () => {
    expect(languageLabel('zh-CN')).toBe('Chinese (Simplified)');
    expect(languageLabel('zh-TW')).toBe('Chinese (Traditional)');
    expect(languageLabel('zh-hans')).toBe('Chinese (Simplified)');
  });

  it('names a regional variant of a known language', () => {
    expect(languageLabel('pt-BR')).toMatch(/Portuguese/);
  });

  it('falls back to the code itself when the language is unknown', () => {
    expect(languageLabel('qq-zz')).toBe('qq-zz');
    expect(languageLabel('')).toBe('');
  });
});
