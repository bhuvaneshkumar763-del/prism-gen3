// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getSelectionInfo } from './selectionInfo';

function fakeSelection(overrides: Partial<Selection> & { text: string; rect: Partial<DOMRect> }): Selection {
  const rect = {
    width: 10,
    height: 10,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
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
});
