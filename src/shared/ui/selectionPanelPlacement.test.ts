import { describe, expect, it } from 'vitest';
import { placeSelectionPanel, placeSelectionTrigger, SELECTION_TRIGGER_SIZE } from './selectionPanelPlacement';

const VIEWPORT = { width: 1000, height: 800 };

describe('placeSelectionPanel', () => {
  it('sits just below a selection with room beneath it, sized to the room that is actually there', () => {
    const p = placeSelectionPanel({ top: 100, bottom: 120, left: 50 }, VIEWPORT);
    expect(p.top).toBe(126);
    expect(p.bottom).toBeNull();
    expect(p.left).toBe(50);
    // Bounded by the space below, so a long translation scrolls instead of
    // running past the bottom of the screen — the reported off-screen case.
    expect(p.maxHeight).toBe(800 - 120 - 6 - 8);
  });

  it('flips ABOVE a selection near the bottom of the screen, anchored by its bottom edge so it never needs measuring', () => {
    const p = placeSelectionPanel({ top: 740, bottom: 760, left: 50 }, VIEWPORT);
    expect(p.top).toBeNull();
    expect(p.bottom).toBe(800 - 740 + 6);
    expect(p.maxHeight).toBe(740 - 6 - 8);
  });

  it('pulls the panel back inside the right edge instead of letting it overflow sideways', () => {
    const p = placeSelectionPanel({ top: 100, bottom: 120, left: 900 }, VIEWPORT);
    // 280 wide, 8px margin: rightmost legal left is 1000 - 280 - 8.
    expect(p.left).toBe(712);
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });

  it('never starts left of the margin, e.g. a selection scrolled partly off the left edge', () => {
    expect(placeSelectionPanel({ top: 100, bottom: 120, left: -40 }, VIEWPORT).left).toBe(8);
  });

  it('shrinks to fit a viewport narrower than its normal width (a phone)', () => {
    const p = placeSelectionPanel({ top: 100, bottom: 120, left: 10 }, { width: 250, height: 600 });
    expect(p.maxWidth).toBe(250 - 16);
    expect(p.left).toBe(8);
  });

  it('never reports a negative max-height when there is no room at all', () => {
    const p = placeSelectionPanel({ top: 2, bottom: 798, left: 50 }, VIEWPORT);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});

describe('placeSelectionTrigger', () => {
  it('sits just below the selection', () => {
    expect(placeSelectionTrigger({ top: 100, bottom: 120, left: 50 }, VIEWPORT)).toEqual({ top: 126, left: 50 });
  });

  it('stays on screen for a selection at the very bottom or right edge', () => {
    const t = placeSelectionTrigger({ top: 790, bottom: 799, left: 995 }, VIEWPORT);
    expect(t.top + SELECTION_TRIGGER_SIZE).toBeLessThanOrEqual(VIEWPORT.height - 8);
    expect(t.left + SELECTION_TRIGGER_SIZE).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });
});
