import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewportSize } from './viewport';

describe('viewportSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the visual viewport, which shrinks with pinch-zoom and the iOS keyboard', () => {
    vi.stubGlobal('window', { visualViewport: { width: 390, height: 500 }, innerWidth: 1024, innerHeight: 768 });
    expect(viewportSize()).toMatchObject({ width: 390, height: 500 });
  });

  it('reports where the visual viewport sits in the layout viewport, and its zoom, for position: fixed UI', () => {
    vi.stubGlobal('window', {
      visualViewport: { width: 187.5, height: 350, offsetLeft: 120, offsetTop: 260, scale: 2 },
      innerWidth: 375,
      innerHeight: 700,
    });
    expect(viewportSize()).toEqual({ width: 187.5, height: 350, offsetLeft: 120, offsetTop: 260, scale: 2 });
  });

  it('falls back to the layout viewport without a visual viewport', () => {
    vi.stubGlobal('window', { visualViewport: null, innerWidth: 1024, innerHeight: 768 });
    expect(viewportSize()).toEqual({ width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 });
  });

  it('falls back to the layout viewport when the visual viewport reports 0', () => {
    vi.stubGlobal('window', {
      visualViewport: { width: 0, height: 0, offsetLeft: 0, offsetTop: 0, scale: 0 },
      innerWidth: 1024,
      innerHeight: 768,
    });
    expect(viewportSize()).toEqual({ width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 });
  });
});
