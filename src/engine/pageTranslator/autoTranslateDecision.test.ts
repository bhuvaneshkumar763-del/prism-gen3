import { describe, expect, it } from 'vitest';
import { isTranslationServiceHost, shouldAutoTranslateOnLoad } from './autoTranslateDecision';

function baseInput(overrides: Partial<Parameters<typeof shouldAutoTranslateOnLoad>[0]> = {}) {
  return {
    originalLanguage: 'fr',
    hostname: 'example.com',
    targetLanguage: 'en',
    pageLanguageState: 'original' as const,
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    alwaysTranslateLangs: [],
    neverTranslateLangs: [],
    isIncognito: false,
    ...overrides,
  };
}

describe('shouldAutoTranslateOnLoad', () => {
  it('is false while already translated', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ pageLanguageState: 'translated' }))).toBe(false);
  });

  it('is false in incognito, regardless of other signals', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ isIncognito: true, alwaysTranslateSites: ['example.com'] }))).toBe(
      false,
    );
  });

  it('is false when the hostname is on the never-translate-sites list', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ neverTranslateSites: ['example.com'] }))).toBe(false);
  });

  it('is false on a known third-party translation-output host', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ hostname: 'translate.google.com' }))).toBe(false);
    expect(shouldAutoTranslateOnLoad(baseInput({ hostname: 'example-com.translate.goog' }))).toBe(false);
  });

  it('is true when the hostname is on the always-translate-sites list, even with an unknown language', () => {
    expect(
      shouldAutoTranslateOnLoad(baseInput({ alwaysTranslateSites: ['example.com'], originalLanguage: 'und' })),
    ).toBe(true);
  });

  it('always-translate-sites takes priority over never-translate-sites being absent, but never wins if also never-listed', () => {
    // Same host on both lists is a contradictory config; never-translate wins (checked first).
    expect(
      shouldAutoTranslateOnLoad(
        baseInput({ alwaysTranslateSites: ['example.com'], neverTranslateSites: ['example.com'] }),
      ),
    ).toBe(false);
  });

  it('is false when the detected language is unknown ("und")', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ originalLanguage: 'und' }))).toBe(false);
  });

  it('is false when the detected language already matches the target language', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ originalLanguage: 'en', targetLanguage: 'en' }))).toBe(false);
  });

  it('is false when the detected language is on the never-translate-langs list', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ neverTranslateLangs: ['fr'] }))).toBe(false);
  });

  it('is true when the detected language is on the always-translate-langs list', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ alwaysTranslateLangs: ['fr'] }))).toBe(true);
  });

  it('is false when the detected language matches no list at all', () => {
    expect(shouldAutoTranslateOnLoad(baseInput())).toBe(false);
  });

  it('skips a regional variant matching the target by base tag, even when it also exactly matches an always-translate-langs entry', () => {
    // alwaysTranslateLangs matches 'pt-BR' EXACTLY, so this would return true
    // if the same-language base-tag check above it didn't fire first —
    // proving the skip is real, not just a fallthrough default.
    expect(
      shouldAutoTranslateOnLoad(
        baseInput({ originalLanguage: 'pt-BR', targetLanguage: 'pt', alwaysTranslateLangs: ['pt-BR'] }),
      ),
    ).toBe(false);
  });

  it('honors a never-translate-langs rule against a regional variant, even when it also exactly matches an always-translate-langs entry', () => {
    // Same structure: alwaysTranslateLangs matches exactly and would return
    // true if the never-list's base-tag check didn't catch it first.
    expect(
      shouldAutoTranslateOnLoad(
        baseInput({ originalLanguage: 'pt-BR', neverTranslateLangs: ['pt'], alwaysTranslateLangs: ['pt-BR'] }),
      ),
    ).toBe(false);
  });

  it('honors an always-translate-langs rule against a regional variant of the listed base language', () => {
    expect(shouldAutoTranslateOnLoad(baseInput({ originalLanguage: 'fr-CA', alwaysTranslateLangs: ['fr'] }))).toBe(
      true,
    );
  });
});

describe('isTranslationServiceHost', () => {
  it('recognizes each known third-party translation host', () => {
    expect(isTranslationServiceHost('translate.googleusercontent.com')).toBe(true);
    expect(isTranslationServiceHost('translate.google.com')).toBe(true);
    expect(isTranslationServiceHost('translate.yandex.com')).toBe(true);
    expect(isTranslationServiceHost('www.deepl.com')).toBe(true);
    expect(isTranslationServiceHost('translated.turbopages.org')).toBe(true);
  });

  it('recognizes any *.translate.goog host', () => {
    expect(isTranslationServiceHost('some-site-com.translate.goog')).toBe(true);
  });

  it('recognizes the bare translate.goog host itself', () => {
    expect(isTranslationServiceHost('translate.goog')).toBe(true);
  });

  it('recognizes regional Google Translate TLDs, real gap: translate.google.co.uk was unrecognized', () => {
    expect(isTranslationServiceHost('translate.google.co.uk')).toBe(true);
    expect(isTranslationServiceHost('translate.google.de')).toBe(true);
  });

  it('does not false-positive on a hostname that merely ends with the .goog suffix string with no subdomain boundary', () => {
    expect(isTranslationServiceHost('mytranslate.goog')).toBe(false);
  });

  it('is false for an ordinary hostname', () => {
    expect(isTranslationServiceHost('example.com')).toBe(false);
  });
});
