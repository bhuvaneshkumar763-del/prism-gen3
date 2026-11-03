import { describe, expect, it } from 'vitest';
import { HAS_LETTER, hasLetter } from './text';

describe('hasLetter', () => {
  it('is true for text with a letter in any script', () => {
    expect(hasLetter('a')).toBe(true);
    expect(hasLetter('Chương 12')).toBe(true);
    expect(hasLetter('第十二章')).toBe(true);
  });

  it('is false for empty, digit-only and punctuation-only text', () => {
    expect(hasLetter('')).toBe(false);
    expect(hasLetter('192673')).toBe(false);
    expect(hasLetter(' | » … ')).toBe(false);
  });

  it('gives the same answer on repeated calls (no global-regex lastIndex state)', () => {
    expect(HAS_LETTER.test('a')).toBe(true);
    expect(HAS_LETTER.test('a')).toBe(true);
  });
});
