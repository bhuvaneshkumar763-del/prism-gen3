import { describe, expect, it } from 'vitest';
import { addLangToAlwaysTranslate, removeLangFromAlwaysTranslate } from '../../src/shared/config/listMutations';
import { alwaysFromTogglePatch, offersAlwaysTranslateFrom, primaryButtonMode } from './popupLogic';

const empty = { alwaysTranslateSites: [], neverTranslateSites: [], alwaysTranslateLangs: [], neverTranslateLangs: [] };

describe('primaryButtonMode', () => {
  it('shows "Restoring…" (not "Translating…") while Show original is running', () => {
    expect(primaryButtonMode('translated', 'busy', 'restore')).toBe('restoring');
  });
  it('shows "Translating…" while a translate is running, even once the page reads translated', () => {
    expect(primaryButtonMode('translated', 'busy', 'translate')).toBe('translating');
    expect(primaryButtonMode('original', 'busy', 'translate')).toBe('translating');
  });
  it('offers Show original on a translated page and Translate otherwise', () => {
    expect(primaryButtonMode('translated', 'idle', 'translate')).toBe('restore');
    expect(primaryButtonMode('translated', 'error', 'restore')).toBe('restore');
    expect(primaryButtonMode('original', 'idle', 'restore')).toBe('translate');
  });
});

describe('offersAlwaysTranslateFrom', () => {
  it('hides the toggle when the page is a regional form of the target (pt-BR page, target pt)', () => {
    expect(offersAlwaysTranslateFrom('pt-BR', 'pt')).toBe(false);
    expect(offersAlwaysTranslateFrom('en', 'en-GB')).toBe(false);
  });
  it('hides it for an unknown language and shows it for a different one', () => {
    expect(offersAlwaysTranslateFrom('und', 'en')).toBe(false);
    expect(offersAlwaysTranslateFrom('ja', 'en')).toBe(true);
  });
});

describe('alwaysFromTogglePatch', () => {
  it('turning it off uses the same removal rule as Settings (the shared list helper)', () => {
    const snapshot = { ...empty, alwaysTranslateLangs: ['zh-TW', 'pt', 'fr'] };
    for (const lang of ['zh-CN', 'pt-BR', 'fr']) {
      expect(alwaysFromTogglePatch(snapshot, lang, true, 'example.com')).toEqual(
        removeLangFromAlwaysTranslate(snapshot, lang),
      );
    }
  });
  it('turning it on adds the language and lifts a never rule for this site', () => {
    const snapshot = { ...empty, neverTranslateSites: ['example.com'] };
    expect(alwaysFromTogglePatch(snapshot, 'ja', false, 'example.com')).toEqual(
      addLangToAlwaysTranslate(snapshot, 'ja', 'example.com'),
    );
    expect(alwaysFromTogglePatch(snapshot, 'ja', false, '').neverTranslateSites).toBeUndefined();
  });
});
