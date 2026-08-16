/**
 * Reads the current text selection into a plain, testable shape (text +
 * bounding rect). Standard Web APIs only (`Selection`, `Range`) — lives in
 * `src/engine/` so it's unit-testable without mounting any UI.
 */
export interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

export function getSelectionInfo(selection: Selection | null): SelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (!text) return null;

  // selection.toString() concatenates EVERY range (a real, if rare, case —
  // e.g. Firefox's Ctrl+click multi-select). Using only getRangeAt(0)'s rect
  // anchors the trigger to the first fragment while the text covers all of
  // them — union every range's rect instead so the anchor represents the
  // whole selection.
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < selection.rangeCount; i++) {
    const r = selection.getRangeAt(i).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // e.g. a range collapsed by whitespace-only content
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) return null; // every range was zero-size

  const rect = {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  } as DOMRect;
  return { text, rect };
}
