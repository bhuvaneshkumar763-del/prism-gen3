import { describe, expect, it } from 'vitest';
import { placeHoverTooltip } from './hoverTooltipPlacement';

const VIEWPORT = { width: 1000, height: 800 };

describe('placeHoverTooltip', () => {
  it('sits above the hovered line, a full line clear of the cursor, sized to the room above', () => {
    const p = placeHoverTooltip({ x: 100, y: 300 }, 20, VIEWPORT);
    expect(p.top).toBeNull();
    expect(p.bottom).toBe(800 - (300 - 20 - 6));
    expect(p.maxHeight).toBe(300 - 20 - 6 - 8);
    expect(p.left).toBe(92);
    expect(p.right).toBeNull();
    expect(p.maxWidth).toBe(320);
  });

  it('goes below the line when there is too little room above it', () => {
    const p = placeHoverTooltip({ x: 100, y: 30 }, 20, VIEWPORT);
    expect(p.bottom).toBeNull();
    expect(p.top).toBe(30 + 20 + 6);
    expect(p.maxHeight).toBe(800 - 56 - 8);
  });

  it('ends at the cursor instead of running off the right edge', () => {
    const p = placeHoverTooltip({ x: 990, y: 300 }, 20, VIEWPORT);
    expect(p.left).toBeNull();
    expect(p.right as number).toBeGreaterThanOrEqual(8);
    expect(1000 - (p.right as number) - p.maxWidth).toBeGreaterThanOrEqual(8);
  });

  it('shrinks to fit a narrow viewport', () => {
    const p = placeHoverTooltip({ x: 150, y: 300 }, 20, { width: 300, height: 600 });
    const left = p.left ?? 300 - (p.right as number) - p.maxWidth;
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + p.maxWidth).toBeLessThanOrEqual(300 - 8);
  });

  it('never reports a negative size', () => {
    const p = placeHoverTooltip({ x: -50, y: -50 }, 20, { width: 10, height: 10 });
    expect(p.maxWidth).toBeGreaterThanOrEqual(0);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
