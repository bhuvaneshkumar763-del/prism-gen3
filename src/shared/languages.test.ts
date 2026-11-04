import { describe, expect, it } from 'vitest';
import { baseLanguageTag, COMMON_LANGUAGES, languageName, sameLanguage, translationDirection } from './languages';

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

  it("maps Google's legacy Hebrew code to the current one, so iw and he compare equal", () => {
    expect(baseLanguageTag('iw')).toBe('he');
    expect(baseLanguageTag('iw-IL')).toBe('he');
  });

  it('maps the other legacy codes Google can report to their current equivalents', () => {
    expect(baseLanguageTag('ji')).toBe('yi');
    expect(baseLanguageTag('in')).toBe('id');
    expect(baseLanguageTag('jw')).toBe('jv');
  });

  it('treats zh-CN and zh as the same base language', () => {
    expect(baseLanguageTag('zh-CN')).toBe('zh');
    expect(baseLanguageTag('pt-BR')).toBe('pt');
    expect(baseLanguageTag('EN')).toBe('en');
  });
});

describe('COMMON_LANGUAGES', () => {
  it('has no duplicate codes', () => {
    const codes = COMMON_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('translationDirection', () => {
  it('names both languages', () => {
    expect(translationDirection('vi', 'en')).toBe('Vietnamese → English');
  });

  it('says nothing when the source language is unknown, rather than guessing', () => {
    expect(translationDirection('und', 'en')).toBeNull();
    expect(translationDirection('auto', 'en')).toBeNull();
    expect(translationDirection('', 'en')).toBeNull();
  });

  it('says nothing for a page already in the target language — "English → English" is noise', () => {
    expect(translationDirection('en', 'en')).toBeNull();
    expect(translationDirection('en-GB', 'en')).toBeNull();
  });

  it('names a Simplified-to-Traditional Chinese translation instead of calling it the same language', () => {
    expect(translationDirection('zh-CN', 'zh-TW')).not.toBeNull();
  });
});

describe('sameLanguage', () => {
  it('matches regional variants and legacy codes of one language', () => {
    expect(sameLanguage('pt-BR', 'pt')).toBe(true);
    expect(sameLanguage('iw', 'he-IL')).toBe(true);
    expect(sameLanguage('en', 'fr')).toBe(false);
  });
  it('keeps Simplified and Traditional Chinese apart, whichever way the script is written', () => {
    expect(sameLanguage('zh-CN', 'zh-TW')).toBe(false);
    expect(sameLanguage('zh-Hans', 'zh-Hant-TW')).toBe(false);
    expect(sameLanguage('zh-CN', 'zh-Hans')).toBe(true);
    expect(sameLanguage('zh-TW', 'zh-HK')).toBe(true);
  });
  it('lets a plain zh match either script, since it names no script', () => {
    expect(sameLanguage('zh', 'zh-CN')).toBe(true);
    expect(sameLanguage('zh-TW', 'zh')).toBe(true);
  });
});
