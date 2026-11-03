/**
 * Where the selection popup's trigger and result panel go, kept on screen.
 *
 * Not `bubblePosition.ts`'s `computePanelPosition`, which places a panel
 * beside its anchor and needs its measured size. Anchoring by `bottom` when
 * flipping above, and bounding height with `maxHeight`, means the rendered
 * panel never has to be measured, even after the translation changes its size.
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
