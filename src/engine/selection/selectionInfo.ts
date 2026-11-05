import { HAS_LETTER } from '../../shared/text';

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

  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
  const rect = rangesRect(ranges);
  if (!rect) return null;
  return { text, rect };
}

/**
 * The union of the ranges' rects, or null when every one is zero-size (e.g.
 * whitespace-only, or content since removed). `toString()` concatenates every
 * range (Firefox Ctrl+click multi-select), so the anchor covers all of them.
 */
export function rangesRect(ranges: readonly Range[]): DOMRect | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const range of ranges) {
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top } as DOMRect;
}

/** A line box: where one line of the selection starts, ends and sits. */
export interface LineRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The box of the selection's last visible line, where its end handle sits; null when nothing visible is selected. */
export function lastLineRect(ranges: readonly Range[]): LineRect | null {
  for (const range of [...ranges].reverse()) {
    for (const { top, bottom, left, right, width, height } of Array.from(range.getClientRects()).reverse()) {
      if (width > 0 || height > 0) return { top, bottom, left, right };
    }
  }
  return null;
}

/** One letter is a whole word in Chinese and Japanese; one Latin letter is noise. */
const SINGLE_NON_LATIN_LETTER = /^(?!\p{Script=Latin})\p{L}$/u;

/**
 * True for selections worth offering a translate trigger for: a single
 * non-Latin letter (a hanzi), or two or more characters with at least one
 * letter, so a stray Latin character or a punctuation/digit-only selection
 * (a double-clicked bullet) is ignored.
 */
export function isValidSelectionText(text: string): boolean {
  if (SINGLE_NON_LATIN_LETTER.test(text)) return true;
  return text.length >= 2 && HAS_LETTER.test(text);
}
