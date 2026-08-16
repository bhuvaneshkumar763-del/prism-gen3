import { describe, expect, it } from 'vitest';
import {
  addLangToAlwaysTranslate,
  addLangToNeverTranslate,
  addRecentTargetLanguage,
  addSiteToAlwaysTranslate,
  addSiteToNeverTranslate,
  normalizeHostname,
  removeLangFromAlwaysTranslate,
  removeLangFromNeverTranslate,
  removeSiteFromAlwaysTranslate,
  removeSiteFromNeverTranslate,
} from './listMutations';

const emptySnapshot = {
  alwaysTranslateSites: [],
  neverTranslateSites: [],
  alwaysTranslateLangs: [],
  neverTranslateLangs: [],
};

describe('normalizeHostname', () => {
  it('lowercases a bare hostname', () => {
    expect(normalizeHostname('BBC.com')).toBe('bbc.com');
  });

  it('extracts the hostname from a pasted full URL, stripping scheme/path/query', () => {
    expect(normalizeHostname('https://BBC.com/news?x=1')).toBe('bbc.com');
  });

  it('extracts the hostname from a URL with no scheme', () => {
    expect(normalizeHostname('www.example.com/some/path')).toBe('www.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHostname('  example.com  ')).toBe('example.com');
  });

  it('leaves an empty string as empty rather than throwing', () => {
    expect(normalizeHostname('')).toBe('');
    expect(normalizeHostname('   ')).toBe('');
  });
});

describe('addSiteToAlwaysTranslate', () => {
  it('adds the host to always and does not touch never when absent', () => {
    const patch = addSiteToAlwaysTranslate(emptySnapshot, 'example.com');
    expect(patch.alwaysTranslateSites).toEqual(['example.com']);
    expect(patch.neverTranslateSites).toEqual([]);
  });

  it('normalizes a mixed-case hostname and a pasted URL to the same stored entry, matching real page hostnames', () => {
    // Regression: without normalization, "BBC.com" typed into the options
    // page never matches location.hostname ("bbc.com") at auto-translate
    // time — the rule silently never fires, while still displaying as active.
    const patch = addSiteToAlwaysTranslate(emptySnapshot, 'BBC.com');
    expect(patch.alwaysTranslateSites).toEqual(['bbc.com']);
  });

  it('normalizes a pasted full URL down to just its hostname', () => {
    const patch = addSiteToAlwaysTranslate(emptySnapshot, 'https://BBC.com/news');
    expect(patch.alwaysTranslateSites).toEqual(['bbc.com']);
  });

  it('deduplicates against an existing entry once both are normalized to the same hostname', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateSites: ['bbc.com'] };
    const patch = addSiteToAlwaysTranslate(snapshot, 'BBC.com');
    expect(patch.alwaysTranslateSites).toEqual(['bbc.com']);
  });
  it('removes the host from never-translate (the cross-list cleanup)', () => {
    const snapshot = { ...emptySnapshot, neverTranslateSites: ['example.com', 'other.com'] };
    const patch = addSiteToAlwaysTranslate(snapshot, 'example.com');
    expect(patch.neverTranslateSites).toEqual(['other.com']);
  });
  it('does not duplicate an already-present host', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateSites: ['example.com'] };
    const patch = addSiteToAlwaysTranslate(snapshot, 'example.com');
    expect(patch.alwaysTranslateSites).toEqual(['example.com']);
  });
});

describe('addSiteToNeverTranslate', () => {
  it('adds the host to never and removes it from always', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateSites: ['example.com'] };
    const patch = addSiteToNeverTranslate(snapshot, 'example.com');
    expect(patch.neverTranslateSites).toEqual(['example.com']);
    expect(patch.alwaysTranslateSites).toEqual([]);
  });
});

describe('removeSiteFromAlwaysTranslate / removeSiteFromNeverTranslate', () => {
  it('removes only the matching host', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateSites: ['a.com', 'b.com'] };
    expect(removeSiteFromAlwaysTranslate(snapshot, 'a.com').alwaysTranslateSites).toEqual(['b.com']);
  });
  it('is a no-op when the host is absent', () => {
    const snapshot = { ...emptySnapshot, neverTranslateSites: ['b.com'] };
    expect(removeSiteFromNeverTranslate(snapshot, 'a.com').neverTranslateSites).toEqual(['b.com']);
  });
});

describe('addLangToAlwaysTranslate', () => {
  it('adds the lang to always and removes it from never', () => {
    const snapshot = { ...emptySnapshot, neverTranslateLangs: ['ja'] };
    const patch = addLangToAlwaysTranslate(snapshot, 'ja');
    expect(patch.alwaysTranslateLangs).toEqual(['ja']);
    expect(patch.neverTranslateLangs).toEqual([]);
  });
  it('with a hostname, also removes that host from never-translate-sites', () => {
    const snapshot = { ...emptySnapshot, neverTranslateSites: ['example.com'] };
    const patch = addLangToAlwaysTranslate(snapshot, 'ja', 'example.com');
    expect(patch.neverTranslateSites).toEqual([]);
  });
  it('without a hostname, leaves neverTranslateSites untouched', () => {
    const snapshot = { ...emptySnapshot, neverTranslateSites: ['example.com'] };
    const patch = addLangToAlwaysTranslate(snapshot, 'ja');
    expect(patch.neverTranslateSites).toBeUndefined();
  });
});

describe('addLangToNeverTranslate', () => {
  it('adds the lang to never and removes it from always', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateLangs: ['ja'] };
    const patch = addLangToNeverTranslate(snapshot, 'ja');
    expect(patch.neverTranslateLangs).toEqual(['ja']);
    expect(patch.alwaysTranslateLangs).toEqual([]);
  });
  it('with a hostname, also removes that host from always-translate-sites', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateSites: ['example.com'] };
    const patch = addLangToNeverTranslate(snapshot, 'ja', 'example.com');
    expect(patch.alwaysTranslateSites).toEqual([]);
  });
});

describe('removeLangFromAlwaysTranslate / removeLangFromNeverTranslate', () => {
  it('removes only the matching lang', () => {
    const snapshot = { ...emptySnapshot, alwaysTranslateLangs: ['ja', 'fr'] };
    expect(removeLangFromAlwaysTranslate(snapshot, 'ja').alwaysTranslateLangs).toEqual(['fr']);
  });
  it('is a no-op when the lang is absent', () => {
    const snapshot = { ...emptySnapshot, neverTranslateLangs: ['fr'] };
    expect(removeLangFromNeverTranslate(snapshot, 'ja').neverTranslateLangs).toEqual(['fr']);
  });
});

describe('addRecentTargetLanguage', () => {
  it('prepends a new code', () => {
    expect(addRecentTargetLanguage(['es', 'fr'], 'ja', 5)).toEqual(['ja', 'es', 'fr']);
  });
  it('moves an existing code to the front instead of duplicating it', () => {
    expect(addRecentTargetLanguage(['es', 'fr', 'ja'], 'fr', 5)).toEqual(['fr', 'es', 'ja']);
  });
  it('caps the list at max entries', () => {
    expect(addRecentTargetLanguage(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});
