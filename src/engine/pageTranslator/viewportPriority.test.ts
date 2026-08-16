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

  it("keeps a paragraph's sibling text nodes together when the paragraph straddles the viewport edge, instead of splitting them across partitions", () => {
    // Regression: partitioning by IMMEDIATE parent (an inline <b>) instead
    // of the nearest BLOCK ancestor could split one paragraph's own sibling
    // text nodes across the visible/rest partitions — breaking
    // groupNodesForBatching()'s assumption that same-block nodes stay
    // adjacent, and losing shared translation context between them.
    const p = document.createElement('p');
    // The whole paragraph straddles the fold: its own rect intersects, even
    // though the inline <b> wrapping the second half doesn't individually.
    p.getBoundingClientRect = () =>
      ({ top: 300, bottom: 500, left: 0, right: 0, width: 0, height: 200, x: 0, y: 300 }) as DOMRect;
    const first = document.createTextNode('Hello ');
    const bold = document.createElement('b');
    bold.getBoundingClientRect = () =>
      ({ top: 450, bottom: 500, left: 0, right: 0, width: 0, height: 50, x: 0, y: 450 }) as DOMRect;
    const second = document.createTextNode('world');
    bold.append(second);
    p.append(first, bold);
    document.body.append(p);

    const other = textNodeAt(1000, 1100); // a different, off-screen block

    const result = prioritizeByViewport([first, other, second], { top: 0, bottom: 400 });

    // Both of the paragraph's own text nodes end up in the visible
    // partition, together and in their original relative order — not split
    // apart by the unrelated node from a different block landing between them.
    expect(result).toEqual([first, second, other]);
  });

  it("measures each shared block ancestor's rect only once, not once per text node under it", () => {
    const p = document.createElement('p');
    let rectCalls = 0;
    p.getBoundingClientRect = () => {
      rectCalls++;
      return { top: 10, bottom: 20, left: 0, right: 0, width: 0, height: 10, x: 0, y: 10 } as DOMRect;
    };
    const a = document.createTextNode('a');
    const b = document.createTextNode('b');
    const c = document.createTextNode('c');
    p.append(a, b, c);
    document.body.append(p);

    prioritizeByViewport([a, b, c], { top: 0, bottom: 400 });

    expect(rectCalls).toBe(1);
  });

  it('falls back to treating a node with no parentElement as not-visible rather than throwing', () => {
    const orphan = document.createTextNode('orphan');
    const visible = textNodeAt(10, 20);

    const result = prioritizeByViewport([orphan, visible], { top: 0, bottom: 400 });

    expect(result).toEqual([visible, orphan]);
  });
});
