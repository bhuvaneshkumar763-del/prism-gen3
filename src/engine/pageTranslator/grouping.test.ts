// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupNodesForBatching } from './grouping';

function textNode(text: string): Text {
  return document.createTextNode(text);
}

describe('groupNodesForBatching', () => {
  it('returns one group per node when hint is undefined (default MT-provider behavior)', () => {
    const p = document.createElement('p');
    const a = textNode('hello');
    const b = textNode('world');
    p.append(a, b);

    expect(groupNodesForBatching([a, b], undefined)).toEqual([[a], [b]]);
  });

  it('returns one group per node when groupByBlock is false', () => {
    const p = document.createElement('p');
    const a = textNode('hello');
    p.append(a);

    expect(groupNodesForBatching([a], { groupByBlock: false, maxGroupChars: 100 })).toEqual([[a]]);
  });

  it('groups sibling text nodes sharing the same block ancestor into one piece', () => {
    const p = document.createElement('p');
    const a = textNode('Hello ');
    const b = document.createElement('b');
    const bText = textNode('world');
    b.append(bText);
    const c = textNode('.');
    p.append(a, b, c);

    const groups = groupNodesForBatching([a, bText, c], { groupByBlock: true, maxGroupChars: 2000 });

    expect(groups).toEqual([[a, bText, c]]);
  });

  it('starts a new group at a block-ancestor change, even well under budget', () => {
    const p1 = document.createElement('p');
    const a = textNode('First paragraph.');
    p1.append(a);
    const p2 = document.createElement('p');
    const b = textNode('Second paragraph.');
    p2.append(b);

    const groups = groupNodesForBatching([a, b], { groupByBlock: true, maxGroupChars: 2000 });

    expect(groups).toEqual([[a], [b]]);
  });

  it('cuts at the nearest sentence boundary instead of mid-sentence when the budget is exceeded', () => {
    const p = document.createElement('p');
    // "Hello world." split across 3 nodes by inline formatting, immediately
    // followed by a second sentence that alone pushes the group over
    // budget — the naive old behavior would cut between "world" and "."
    // (a lone "." as its own piece); this should instead cut after the
    // full first sentence.
    const hello = textNode('Hello ');
    const worldEl = document.createElement('b');
    const world = textNode('world');
    worldEl.append(world);
    const period = textNode('.');
    const second = textNode(' This is a much longer second sentence that pushes past budget.');
    p.append(hello, worldEl, period, second);

    const groups = groupNodesForBatching([hello, world, period, second], {
      groupByBlock: true,
      maxGroupChars: 20,
    });

    expect(groups).toEqual([[hello, world, period], [second]]);
  });

  it('falls back to a hard budget cut when no sentence boundary is found even after bounded overflow', () => {
    const p = document.createElement('p');
    // No punctuation anywhere — a real sentence boundary never appears, so
    // this must still terminate with a bounded group rather than growing
    // forever.
    const a = textNode('aaaaaaaaaa');
    const b = textNode('bbbbbbbbbb');
    const c = textNode('cccccccccc');
    const d = textNode('dddddddddd');
    p.append(a, b, c, d);

    const groups = groupNodesForBatching([a, b, c, d], { groupByBlock: true, maxGroupChars: 10 });

    // maxGroupChars=10, overflow factor 1.5 -> hardMax=15. Group 1: "a"(10)
    // + "b"(10) would be 20 > hardMax(15) with no boundary seen -> cut
    // before "b". Same logic repeats for c, d.
    expect(groups).toEqual([[a], [b], [c], [d]]);
  });

  it('allows bounded overflow past maxGroupChars while a sentence is still in progress', () => {
    const p = document.createElement('p');
    const a = textNode('a'.repeat(15)); // no punctuation — mid-sentence
    // Joining b pushes the group to 25 chars — over maxGroupChars (20) but
    // under hardMax (20 * 1.5 = 30) — and the group doesn't yet end at a
    // sentence boundary, so b should be allowed to join rather than
    // cutting immediately at the 20-char budget.
    const b = textNode('b'.repeat(10)); // no punctuation — still mid-sentence, 25 chars total
    const c = textNode(`${'c'.repeat(21)}.`); // ends the sentence; joining would hit 47 > hardMax(30) -> forced cut
    p.append(a, b, c);

    const groups = groupNodesForBatching([a, b, c], { groupByBlock: true, maxGroupChars: 20 });

    expect(groups).toEqual([[a, b], [c]]);
  });

  it('carries accumulated context in the tail after a sentence-boundary cut, rather than discarding it', () => {
    const p = document.createElement('p');
    const s1 = textNode('One.');
    const s2 = textNode(' Two.');
    const s3 = textNode(' Three is a longer sentence that exceeds the budget here.');
    p.append(s1, s2, s3);

    const groups = groupNodesForBatching([s1, s2, s3], { groupByBlock: true, maxGroupChars: 10 });

    // "One." (4 chars) fits; adding " Two." (5 chars) -> 9, still under
    // budget=10, both end at a sentence boundary. Adding s3 would exceed
    // budget -> cut at the last boundary (after " Two."), carrying nothing
    // forward since both prior nodes were already flushed as the head.
    expect(groups).toEqual([[s1, s2], [s3]]);
  });
});
