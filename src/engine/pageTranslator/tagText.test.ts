import { describe, expect, it } from 'vitest';
import { isPureTagText } from './tagText';

describe('isPureTagText', () => {
  it('matches a single hashtag', () => {
    expect(isPureTagText('#travel')).toBe(true);
  });

  it('matches a single mention', () => {
    expect(isPureTagText('@user')).toBe(true);
  });

  it('matches chained tags with no separator — the reported example', () => {
    expect(isPureTagText('#go#be')).toBe(true);
  });

  it('matches several tags separated by spaces', () => {
    expect(isPureTagText('#A #B #C')).toBe(true);
  });

  it('matches several tags separated by commas', () => {
    expect(isPureTagText('#A, #B, #C')).toBe(true);
  });

  it('matches tags with hyphens, underscores, plus signs, and apostrophes', () => {
    expect(isPureTagText('#sci-fi')).toBe(true);
    expect(isPureTagText('#anime_2024')).toBe(true);
    expect(isPureTagText('#C++')).toBe(true);
  });

  it('matches CJK tag text and CJK delimiters', () => {
    expect(isPureTagText('#动作片')).toBe(true);
    expect(isPureTagText('#动作，#冒险')).toBe(true);
    expect(isPureTagText('#动作、#冒险')).toBe(true);
  });

  it('matches tags separated by middots or pipes', () => {
    expect(isPureTagText('#A·#B')).toBe(true);
    expect(isPureTagText('#A|#B')).toBe(true);
  });

  it('allows trailing punctuation/whitespace after the last tag', () => {
    expect(isPureTagText('#tag·')).toBe(true);
    expect(isPureTagText('#tag ')).toBe(true);
    expect(isPureTagText('#tag.')).toBe(true);
  });

  it('does not match a tag embedded inside real prose', () => {
    expect(isPureTagText('check out #go#be for updates')).toBe(false);
    expect(isPureTagText('Footnote #1 explains this.')).toBe(false);
  });

  it('does not match plain prose with no tag at all', () => {
    expect(isPureTagText('Hello world.')).toBe(false);
  });

  it('does not match an empty string', () => {
    expect(isPureTagText('')).toBe(false);
  });

  it('does not match a bare # or @ with no word characters', () => {
    expect(isPureTagText('#')).toBe(false);
    expect(isPureTagText('@')).toBe(false);
  });

  it('does not match two tags separated by a real word', () => {
    expect(isPureTagText('#A and #B')).toBe(false);
  });
});
