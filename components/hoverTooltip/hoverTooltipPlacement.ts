/**
 * Where the hover tooltip goes: above the hovered line when there's room
 * (below it otherwise), and always inside the viewport. Anchored by whichever
 * edges face the cursor, with max sizes for the room there, so the tooltip
 * never has to be measured on mousemove.
 */

export interface HoverTooltipPlacement {
  left: number | null;
  right: number | null;
  top: number | null;
  bottom: number | null;
  maxWidth: number;
  maxHeight: number;
}

const GAP = 6;
const EDGE_MARGIN = 8;
const MAX_WIDTH = 320;
/** Below this much room above the line, prefer whichever side has more. */
const MIN_COMFORTABLE_ROOM = 60;

/**
 * `lineHeight` is the hovered text's line height. The cursor can be anywhere
 * on its line, so a full line's clearance on the chosen side keeps the line
 * itself uncovered.
 */
export function placeHoverTooltip(
  pointer: { x: number; y: number },
  lineHeight: number,
  viewport: { width: number; height: number },
): HoverTooltipPlacement {
  const lineTopBound = pointer.y - lineHeight - GAP;
  const lineBottomBound = pointer.y + lineHeight + GAP;
  const roomAbove = lineTopBound - EDGE_MARGIN;
  const roomBelow = viewport.height - lineBottomBound - EDGE_MARGIN;
  const vertical =
    roomAbove >= MIN_COMFORTABLE_ROOM || roomAbove >= roomBelow
      ? { top: null, bottom: viewport.height - lineTopBound, maxHeight: Math.max(0, roomAbove) }
      : { top: lineBottomBound, bottom: null, maxHeight: Math.max(0, roomBelow) };

  const startX = Math.min(Math.max(pointer.x - EDGE_MARGIN, EDGE_MARGIN), viewport.width - EDGE_MARGIN);
  const roomRight = viewport.width - startX - EDGE_MARGIN;
  const roomLeft = startX - EDGE_MARGIN;
  const horizontal =
    roomRight >= MAX_WIDTH || roomRight >= roomLeft
      ? { left: startX, right: null, maxWidth: Math.min(MAX_WIDTH, roomRight) }
      : { left: null, right: viewport.width - startX, maxWidth: Math.min(MAX_WIDTH, roomLeft) };

  return { ...vertical, ...horizontal };
}
