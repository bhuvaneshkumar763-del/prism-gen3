/**
 * Where the selection popup's trigger and result panel go, kept on screen.
 *
 * The panel used to sit at the selection's bottom-left with no clamping and
 * no height limit: next to the right edge its 280px width ran off the side,
 * and a long selection's translation grew below the fold with no way to
 * scroll to it.
 *
 * Deliberately NOT `bubblePosition.ts`'s `computePanelPosition`, which looks
 * like the obvious thing to reuse: that places a panel BESIDE its anchor,
 * vertically centred, and needs the panel's measured size. A translation
 * belongs under (or over) the text it translates. Anchoring by `bottom` when
 * flipping above, and bounding height with `maxHeight`, means this never has
 * to measure the rendered panel at all — no layout read, and no second pass
 * once the translation arrives and changes its size.
 */

export interface SelectionAnchor {
  top: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface SelectionPanelPlacement {
  left: number;
  /** Set when the panel sits below the selection. */
  top: number | null;
  /** Set when it flips above — distance from the viewport's bottom edge. */
  bottom: number | null;
  maxWidth: number;
  maxHeight: number;
}

const GAP = 6;
const EDGE_MARGIN = 8;
const PANEL_MAX_WIDTH = 280;
/** Below this much space under the selection, prefer whichever side has more. */
const MIN_COMFORTABLE_ROOM = 120;
export const SELECTION_TRIGGER_SIZE = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placeSelectionPanel(anchor: SelectionAnchor, viewport: Viewport): SelectionPanelPlacement {
  const maxWidth = Math.max(0, Math.min(PANEL_MAX_WIDTH, viewport.width - 2 * EDGE_MARGIN));
  const left = clamp(anchor.left, EDGE_MARGIN, viewport.width - maxWidth - EDGE_MARGIN);
  const roomBelow = viewport.height - anchor.bottom - GAP - EDGE_MARGIN;
  const roomAbove = anchor.top - GAP - EDGE_MARGIN;

  if (roomBelow >= MIN_COMFORTABLE_ROOM || roomBelow >= roomAbove) {
    return { left, top: anchor.bottom + GAP, bottom: null, maxWidth, maxHeight: Math.max(0, roomBelow) };
  }
  return {
    left,
    top: null,
    bottom: viewport.height - anchor.top + GAP,
    maxWidth,
    maxHeight: Math.max(0, roomAbove),
  };
}

export function placeSelectionTrigger(anchor: SelectionAnchor, viewport: Viewport): { top: number; left: number } {
  return {
    top: clamp(anchor.bottom + GAP, EDGE_MARGIN, viewport.height - SELECTION_TRIGGER_SIZE - EDGE_MARGIN),
    left: clamp(anchor.left, EDGE_MARGIN, viewport.width - SELECTION_TRIGGER_SIZE - EDGE_MARGIN),
  };
}
