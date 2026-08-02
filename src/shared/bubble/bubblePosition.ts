/**
 * Pure geometry for the floating bubble's drag/edge-docking behavior —
 * extracted from the pre-rewrite fork's `FloatingBubble.tsx` (see that
 * repo's `applyState`/`previewAt`/`positionPanel`/pointerup-snap logic) so
 * it's testable without a DOM. happy-dom has no `visualViewport`, stubs
 * `setPointerCapture`, and returns zeros from `getBoundingClientRect()` —
 * a DOM-level drag test would be theatre. `components/bubble/FloatingBubble.tsx`
 * calls these functions from real pointer event handlers and only writes
 * the returned coordinates to `style.left`/`style.top`.
 *
 * Position is stored as a dock side + vertical fraction (`BubblePosition`),
 * not raw x/y, so the ball stays pinned to a screen edge regardless of
 * viewport size or orientation — the same reasoning the fork's version
 * documents.
 */

export const BALL_SIZE = 40;
export const DRAG_THRESHOLD_PX = 4;
export const LONG_PRESS_MS = 450;
export const PANEL_EDGE_GAP = 8;
export const PANEL_BALL_GAP = 10;
export const DEFAULT_PANEL_WIDTH = 296;
export const DEFAULT_PANEL_HEIGHT = 200;

export const DEFAULT_BUBBLE_POSITION: BubblePosition = { side: 'right', yFrac: 0.55 };

export interface BubblePosition {
  side: 'left' | 'right';
  yFrac: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Validates a value read back from storage (or an import) before trusting it as a `BubblePosition`. */
export function normalizeBubblePosition(raw: unknown): BubblePosition {
  const candidate = raw as Partial<BubblePosition> | null | undefined;
  const side =
    candidate?.side === 'left' || candidate?.side === 'right' ? candidate.side : DEFAULT_BUBBLE_POSITION.side;
  const yFrac = typeof candidate?.yFrac === 'number' ? clamp(candidate.yFrac, 0, 1) : DEFAULT_BUBBLE_POSITION.yFrac;
  return { side, yFrac };
}

/**
 * The docked point for a given position — the fork's `applyState()`. Uses
 * `maxY = height - BALL - 4`; deliberately a different constant than
 * `clampDragPoint`'s `-2` below. That asymmetry is preserved from the fork
 * on purpose, not a typo to "fix" — see this module's header comment.
 */
export function resolveDockedPoint(position: BubblePosition, viewport: Viewport, ballSize = BALL_SIZE): Point {
  const maxY = viewport.height - ballSize - 4;
  const x = position.side === 'right' ? viewport.width - ballSize - 6 : 6;
  const y = clamp(Math.round(position.yFrac * maxY), 4, maxY);
  return { x, y };
}

/** Clamps a free-drag point to the viewport — the fork's `previewAt()`. Uses `maxY = height - BALL - 2`. */
export function clampDragPoint(point: Point, viewport: Viewport, ballSize = BALL_SIZE): Point {
  const maxX = viewport.width - ballSize - 2;
  const maxY = viewport.height - ballSize - 2;
  return { x: clamp(point.x, 2, maxX), y: clamp(point.y, 2, maxY) };
}

/** The pointerup snap: which edge, and what fraction down it, from a free-drag point. */
export function positionFromDragPoint(point: Point, viewport: Viewport, ballSize = BALL_SIZE): BubblePosition {
  const side: BubblePosition['side'] = point.x + ballSize / 2 < viewport.width / 2 ? 'left' : 'right';
  const maxY = viewport.height - ballSize - 4;
  const yFrac = clamp(point.y / maxY, 0, 1);
  return { side, yFrac };
}

/** Whether the ball's center has crossed the viewport midpoint — drives the `.right` edge class. */
export function isRightEdge(x: number, viewportWidth: number, ballSize = BALL_SIZE): boolean {
  return x + ballSize / 2 > viewportWidth / 2;
}

/** True once a pointer has moved far enough to count as a drag rather than a tap. */
export function exceededDragThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}

export interface PanelPositionInput {
  ballRect: Rect;
  panelSize: { width: number; height: number };
  viewport: Viewport;
}

/** Room-left/room-right panel placement, clamped to the viewport — the fork's `positionPanel()`. */
export function computePanelPosition({ ballRect, panelSize, viewport }: PanelPositionInput): Point {
  const panelWidth = panelSize.width || DEFAULT_PANEL_WIDTH;
  const panelHeight = panelSize.height || DEFAULT_PANEL_HEIGHT;
  const ballRight = ballRect.left + ballRect.width;
  const roomRight = viewport.width - ballRight;
  const roomLeft = ballRect.left;

  let left =
    roomRight >= panelWidth + PANEL_BALL_GAP || roomRight >= roomLeft
      ? ballRight + PANEL_BALL_GAP
      : ballRect.left - PANEL_BALL_GAP - panelWidth;
  left = clamp(left, PANEL_EDGE_GAP, viewport.width - panelWidth - PANEL_EDGE_GAP);

  let top = ballRect.top + ballRect.height / 2 - panelHeight / 2;
  top = clamp(top, PANEL_EDGE_GAP, viewport.height - panelHeight - PANEL_EDGE_GAP);

  return { x: Math.round(left), y: Math.round(top) };
}
