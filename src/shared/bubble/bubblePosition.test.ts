import { describe, expect, it } from 'vitest';
import {
  BALL_SIZE,
  clamp,
  clampDragPoint,
  computePanelPosition,
  DEFAULT_BUBBLE_POSITION,
  DRAG_THRESHOLD_PX,
  exceededDragThreshold,
  isRightEdge,
  normalizeBubblePosition,
  positionFromDragPoint,
  resolveDockedPoint,
} from './bubblePosition';

describe('clamp', () => {
  it('passes values inside the range through unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps below the minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('clamps above the maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('normalizeBubblePosition', () => {
  it('returns the default for null/undefined', () => {
    expect(normalizeBubblePosition(null)).toEqual(DEFAULT_BUBBLE_POSITION);
    expect(normalizeBubblePosition(undefined)).toEqual(DEFAULT_BUBBLE_POSITION);
  });
  it('returns the default for a malformed object', () => {
    expect(normalizeBubblePosition({ side: 'up', yFrac: 'nope' })).toEqual(DEFAULT_BUBBLE_POSITION);
  });
  it('passes through a valid side', () => {
    expect(normalizeBubblePosition({ side: 'left', yFrac: 0.3 })).toEqual({ side: 'left', yFrac: 0.3 });
  });
  it('clamps an out-of-range yFrac', () => {
    expect(normalizeBubblePosition({ side: 'right', yFrac: 1.5 })).toEqual({ side: 'right', yFrac: 1 });
    expect(normalizeBubblePosition({ side: 'right', yFrac: -0.5 })).toEqual({ side: 'right', yFrac: 0 });
  });
  it('falls back to the default yFrac when only side is valid', () => {
    expect(normalizeBubblePosition({ side: 'left' })).toEqual({ side: 'left', yFrac: DEFAULT_BUBBLE_POSITION.yFrac });
  });
});

describe('resolveDockedPoint', () => {
  const viewport = { width: 1000, height: 800 };

  it('docks to the right edge', () => {
    const point = resolveDockedPoint({ side: 'right', yFrac: 0 }, viewport);
    expect(point.x).toBe(viewport.width - BALL_SIZE - 6);
  });
  it('docks to the left edge', () => {
    const point = resolveDockedPoint({ side: 'left', yFrac: 0 }, viewport);
    expect(point.x).toBe(6);
  });
  it('uses maxY = height - BALL - 4 (distinct from clampDragPoint)', () => {
    const point = resolveDockedPoint({ side: 'right', yFrac: 1 }, viewport);
    expect(point.y).toBe(viewport.height - BALL_SIZE - 4);
  });
  it('clamps y to a minimum of 4', () => {
    const point = resolveDockedPoint({ side: 'right', yFrac: 0 }, viewport);
    expect(point.y).toBe(4);
  });
  it('handles a zero-size viewport without throwing', () => {
    const point = resolveDockedPoint({ side: 'right', yFrac: 0.5 }, { width: 0, height: 0 });
    expect(point.y).toBe(4);
  });
});

describe('clampDragPoint', () => {
  const viewport = { width: 1000, height: 800 };

  it('passes an in-bounds point through', () => {
    expect(clampDragPoint({ x: 500, y: 400 }, viewport)).toEqual({ x: 500, y: 400 });
  });
  it('clamps to maxX = width - BALL - 2', () => {
    const point = clampDragPoint({ x: 9999, y: 400 }, viewport);
    expect(point.x).toBe(viewport.width - BALL_SIZE - 2);
  });
  it('clamps to maxY = height - BALL - 2 (distinct from resolveDockedPoint)', () => {
    const point = clampDragPoint({ x: 500, y: 9999 }, viewport);
    expect(point.y).toBe(viewport.height - BALL_SIZE - 2);
  });
  it('clamps negative coordinates to the 2px minimum', () => {
    expect(clampDragPoint({ x: -50, y: -50 }, viewport)).toEqual({ x: 2, y: 2 });
  });
});

describe('positionFromDragPoint', () => {
  const viewport = { width: 1000, height: 800 };

  it('snaps to the right when the center is past the midpoint', () => {
    const pos = positionFromDragPoint({ x: 900, y: 0 }, viewport);
    expect(pos.side).toBe('right');
  });
  it('snaps to the left when the center is before the midpoint', () => {
    const pos = positionFromDragPoint({ x: 10, y: 0 }, viewport);
    expect(pos.side).toBe('left');
  });
  it('computes yFrac from maxY = height - BALL - 4', () => {
    const maxY = viewport.height - BALL_SIZE - 4;
    const pos = positionFromDragPoint({ x: 10, y: maxY }, viewport);
    expect(pos.yFrac).toBe(1);
  });
  it('round-trips through resolveDockedPoint at the same yFrac (rotation-stable)', () => {
    const original = { side: 'left' as const, yFrac: 0.3 };
    const docked = resolveDockedPoint(original, viewport);
    const rotated = { width: 800, height: 1000 };
    const dockedAfterRotation = resolveDockedPoint(original, rotated);
    expect(docked.y).not.toBe(dockedAfterRotation.y);
    const snappedBack = positionFromDragPoint(dockedAfterRotation, rotated);
    expect(snappedBack.yFrac).toBeCloseTo(original.yFrac, 2);
  });
});

describe('isRightEdge', () => {
  it('is true once the ball center passes the viewport midpoint', () => {
    expect(isRightEdge(900, 1000)).toBe(true);
  });
  it('is false before the viewport midpoint', () => {
    expect(isRightEdge(10, 1000)).toBe(false);
  });
});

describe('exceededDragThreshold', () => {
  it('is false for tiny movement', () => {
    expect(exceededDragThreshold(1, 1)).toBe(false);
  });
  it('is true once either axis exceeds the threshold', () => {
    expect(exceededDragThreshold(5, 0)).toBe(true);
    expect(exceededDragThreshold(0, 5)).toBe(true);
  });
  it('is false exactly at the threshold (strictly greater-than)', () => {
    expect(exceededDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(false);
  });
});

describe('computePanelPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const panelSize = { width: 296, height: 200 };

  it('places the panel to the right when there is more room there', () => {
    const ballRect = { left: 100, top: 100, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize, viewport });
    expect(point.x).toBe(140 + 10);
  });
  it('places the panel to the left when there is more room there', () => {
    const ballRect = { left: 900, top: 100, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize, viewport });
    expect(point.x).toBe(900 - 10 - 296);
  });
  it('clamps the left edge to the 8px viewport gap', () => {
    const ballRect = { left: 950, top: 100, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize, viewport });
    expect(point.x).toBeGreaterThanOrEqual(8);
  });
  it('vertically centers on the ball, clamped to the viewport', () => {
    const ballRect = { left: 100, top: 400, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize, viewport });
    expect(point.y).toBe(Math.round(400 + 20 - 100));
  });
  it('clamps the top edge when the ball is near the top', () => {
    const ballRect = { left: 100, top: 0, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize, viewport });
    expect(point.y).toBeGreaterThanOrEqual(8);
  });
  it('falls back to default panel size when offsetWidth/Height are 0', () => {
    const ballRect = { left: 100, top: 100, width: 40, height: 40 };
    const point = computePanelPosition({ ballRect, panelSize: { width: 0, height: 0 }, viewport });
    expect(point.x).toBe(140 + 10);
  });
});
