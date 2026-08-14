// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { prioritizeByViewport } from './viewportPriority';

/** happy-dom's getBoundingClientRect() always returns zeros — stub it per-element so tests control real positions. */
function textNodeAt(top: number, bottom: number): Text {
  const el = document.createElement('p');
  el.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top }) as DOMRect;
  const node = document.createTextNode('text');
  el.append(node);
  document.body.append(el);
  return node;
}

describe('prioritizeByViewport', () => {
  it('moves nodes intersecting the viewport rect to the front, preserving order within each partition', () => {
    const above = textNodeAt(-200, -100); // scrolled past
    const visible1 = textNodeAt(50, 100);
    const below = textNodeAt(500, 600); // not yet scrolled to
    const visible2 = textNodeAt(150, 200);

    const result = prioritizeByViewport([above, visible1, below, visible2], { top: 0, bottom: 400 });

    expect(result).toEqual([visible1, visible2, above, below]);
  });

  it('a node partially overlapping the viewport edge still counts as visible', () => {
    const partiallyAbove = textNodeAt(-10, 20); // bottom edge (20) is inside [0, 400]
    const fullyAbove = textNodeAt(-100, -20);

    const result = prioritizeByViewport([fullyAbove, partiallyAbove], { top: 0, bottom: 400 });

    expect(result).toEqual([partiallyAbove, fullyAbove]);
  });

  it('returns the original array unchanged when nothing is visible (avoids a pointless reorder)', () => {
    const a = textNodeAt(-500, -400);
    const b = textNodeAt(1000, 1100);

    const result = prioritizeByViewport([a, b], { top: 0, bottom: 400 });

    expect(result).toEqual([a, b]);
  });

  it('returns the original array unchanged when everything is already visible (nothing to prioritize)', () => {
    const a = textNodeAt(10, 20);
    const b = textNodeAt(30, 40);

    const result = prioritizeByViewport([a, b], { top: 0, bottom: 400 });

    expect(result).toEqual([a, b]);
  });

  it('falls back to treating a node with no parentElement as not-visible rather than throwing', () => {
    const orphan = document.createTextNode('orphan');
    const visible = textNodeAt(10, 20);

    const result = prioritizeByViewport([orphan, visible], { top: 0, bottom: 400 });

    expect(result).toEqual([visible, orphan]);
  });
});
