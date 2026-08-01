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
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { text, rect };
}
