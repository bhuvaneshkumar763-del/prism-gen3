import { describe, expect, it } from 'vitest';
import { isSuspiciousOutcome } from './outputSanityCheck';

const LONG = 'This is a genuinely long sentence that exceeds the forty character threshold.';

describe('isSuspiciousOutcome', () => {
  it('flags an empty result when the original was not empty', () => {
    expect(isSuspiciousOutcome(LONG, { text: '', detectedLanguage: null }, 'en', 'fr')).toBe(true);
  });

  it('does not flag an empty result for an already-empty/whitespace-only original', () => {
    expect(isSuspiciousOutcome('   ', { text: '', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });

  it('flags a long result byte-identical to the original when languages genuinely differ', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'en', 'fr')).toBe(true);
  });

  it('does not flag a short identical result — numbers, acronyms, proper nouns are legitimately identical', () => {
    expect(isSuspiciousOutcome('2024', { text: '2024', detectedLanguage: null }, 'en', 'fr')).toBe(false);
    expect(isSuspiciousOutcome('NASA', { text: 'NASA', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });

  it('does not flag an identical result when the provider detected the source was already in the target language', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'fr' }, 'en', 'fr')).toBe(false);
  });

  it('flags an identical result when the detected language differs from the target', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'en' }, 'auto', 'fr')).toBe(true);
  });

  it('does not flag an identical result when sourceLanguage is "auto" and there is no detected-language signal', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'auto', 'fr')).toBe(false);
  });

  it('does not flag an identical result when source and target are genuinely the same language', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'en', 'en')).toBe(false);
  });

  it('does not flag a genuinely different (real) translation', () => {
    expect(isSuspiciousOutcome(LONG, { text: 'Ceci est une phrase.', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });
});
