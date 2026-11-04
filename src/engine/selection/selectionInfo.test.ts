// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getSelectionInfo, isValidSelectionText, lastLineRect } from './selectionInfo';

function fakeSelection(overrides: Partial<Selection> & { text: string; rect: Partial<DOMRect> }): Selection {
  const base = { width: 10, height: 10, top: 0, left: 0, ...overrides.rect };
  // A real DOMRect always satisfies right = left + width (and bottom = top +
  // height) — derive them here so this fixture stays consistent the way
  // getBoundingClientRect()'s actual return value would be, unless a test
  // explicitly overrides right/bottom itself.
  const rect = {
    ...base,
    right: base.left + base.width,
    bottom: base.top + base.height,
    x: base.left,
    y: base.top,
    ...overrides.rect,
  } as DOMRect;
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => overrides.text,
    getRangeAt: () => ({ getBoundingClientRect: () => rect }) as unknown as Range,
    ...overrides,
  } as unknown as Selection;
}

describe('getSelectionInfo', () => {
  it('returns null for a null selection', () => {
    expect(getSelectionInfo(null)).toBeNull();
  });

  it('returns null for a collapsed selection', () => {
    expect(getSelectionInfo(fakeSelection({ text: 'hi', rect: {}, isCollapsed: true }))).toBeNull();
  });

  it('returns null when rangeCount is 0', () => {
    expect(getSelectionInfo(fakeSelection({ text: 'hi', rect: {}, rangeCount: 0 }))).toBeNull();
  });

  it('returns null for whitespace-only selected text', () => {
    expect(getSelectionInfo(fakeSelection({ text: '   ', rect: {} }))).toBeNull();
  });

  it('returns null when the selection has a zero-size bounding rect (e.g. a hidden node)', () => {
    expect(getSelectionInfo(fakeSelection({ text: 'hi', rect: { width: 0, height: 0 } }))).toBeNull();
  });

  it('returns the trimmed text and rect for a real selection', () => {
    const info = getSelectionInfo(fakeSelection({ text: '  Hello world  ', rect: { width: 50, height: 12 } }));
    expect(info?.text).toBe('Hello world');
    expect(info?.rect.width).toBe(50);
  });

  it('unions the rects of a multi-range selection instead of anchoring to only the first range', () => {
    // toString() already concatenates every range's text; the rect should
    // cover the whole selection too, not just the first fragment.
    const ranges = [
      { getBoundingClientRect: () => ({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }) },
      { getBoundingClientRect: () => ({ left: 5, top: 40, right: 90, bottom: 60, width: 85, height: 20 }) },
    ] as unknown as Range[];
    const selection = {
      isCollapsed: false,
      rangeCount: 2,
      toString: () => 'first  second',
      getRangeAt: (i: number) => ranges[i],
    } as unknown as Selection;

    const info = getSelectionInfo(selection);

    expect(info?.text).toBe('first  second');
    expect(info?.rect).toMatchObject({ left: 5, top: 10, right: 90, bottom: 60 });
  });

  it('ignores a zero-size range within a multi-range selection rather than letting it collapse the union', () => {
    // Zero-size range FIRST: getRangeAt(0) alone would see width/height 0.
    const ranges = [
      { getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) },
      { getBoundingClientRect: () => ({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }) },
    ] as unknown as Range[];
    const selection = {
      isCollapsed: false,
      rangeCount: 2,
      toString: () => 'visible',
      getRangeAt: (i: number) => ranges[i],
    } as unknown as Selection;

    const info = getSelectionInfo(selection);

    expect(info?.rect).toMatchObject({ left: 10, top: 10, right: 60, bottom: 30 });
  });
});

describe('isValidSelectionText', () => {
  it('rejects a selection shorter than 2 characters, real gap: TWP hides its trigger for these by default, ours previously showed it for any non-empty selection', () => {
    expect(isValidSelectionText('a')).toBe(false);
    expect(isValidSelectionText('')).toBe(false);
  });

  it('rejects a selection with no letters at all (punctuation/digits/whitespace only)', () => {
    expect(isValidSelectionText('123')).toBe(false);
    expect(isValidSelectionText('...')).toBe(false);
    expect(isValidSelectionText('  ')).toBe(false);
  });

  it('accepts an ordinary word or phrase', () => {
    expect(isValidSelectionText('hello')).toBe(true);
    expect(isValidSelectionText('a b')).toBe(true);
  });

  it("accepts non-Latin scripts, unlike TWP's own ASCII-only punctuation regex would", () => {
    expect(isValidSelectionText('你好')).toBe(true);
    expect(isValidSelectionText('こんにちは')).toBe(true);
  });

  it('accepts a single hanzi, kana, hangul or other non-Latin letter — one character is a whole word in Chinese', () => {
    expect(isValidSelectionText('字')).toBe(true);
    expect(isValidSelectionText('あ')).toBe(true);
    expect(isValidSelectionText('한')).toBe(true);
    expect(isValidSelectionText('я')).toBe(true);
  });

  it('still rejects a single Latin letter or a single non-letter (CJK punctuation included)', () => {
    expect(isValidSelectionText('é')).toBe(false);
    expect(isValidSelectionText('x')).toBe(false);
    expect(isValidSelectionText('。')).toBe(false);
    expect(isValidSelectionText('7')).toBe(false);
  });

  it('accepts text mixing letters with digits/punctuation', () => {
    expect(isValidSelectionText('Chapter 5')).toBe(true);
  });
});

describe('lastLineRect', () => {
  const rangeWith = (rects: Partial<DOMRect>[]) => ({ getClientRects: () => rects as DOMRect[] }) as unknown as Range;

  it("is the box of the selection's last line, where its end handle sits", () => {
    const range = rangeWith([
      { top: 100, bottom: 120, left: 40, right: 380, width: 340, height: 20 },
      { top: 120, bottom: 140, left: 16, right: 200, width: 184, height: 20 },
    ]);
    expect(lastLineRect([range])).toEqual({ top: 120, bottom: 140, left: 16, right: 200 });
  });

  it('skips empty boxes (a line break at the end of the selection)', () => {
    const range = rangeWith([
      { top: 100, bottom: 120, left: 40, right: 380, width: 340, height: 20 },
      { top: 120, bottom: 120, left: 0, right: 0, width: 0, height: 0 },
    ]);
    expect(lastLineRect([range])).toEqual({ top: 100, bottom: 120, left: 40, right: 380 });
  });

  it('is null with nothing visible selected', () => {
    expect(lastLineRect([rangeWith([])])).toBeNull();
  });
});
