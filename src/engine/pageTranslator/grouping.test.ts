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

  describe('tag-cluster isolation', () => {
    it('isolates a chained-tag node (the reported #go#be example) from surrounding prose into its own group', () => {
      const p = document.createElement('p');
      const before = textNode('Check out ');
      const tag = textNode('#go#be');
      const after = textNode(' for updates.');
      p.append(before, tag, after);

      const groups = groupNodesForBatching([before, tag, after], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[before], [tag], [after]]);
    });

    it('isolates a plain hashtag node', () => {
      const p = document.createElement('p');
      const before = textNode('Tagged: ');
      const tag = textNode('#travel');
      p.append(before, tag);

      const groups = groupNodesForBatching([before, tag], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[before], [tag]]);
    });

    it('isolates a mention node', () => {
      const p = document.createElement('p');
      const before = textNode('cc ');
      const mention = textNode('@user');
      p.append(before, mention);

      const groups = groupNodesForBatching([before, mention], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[before], [mention]]);
    });

    it('isolates a CJK tag cluster', () => {
      const p = document.createElement('p');
      const before = textNode('标签: ');
      const tags = textNode('#动作，#冒险');
      p.append(before, tags);

      const groups = groupNodesForBatching([before, tags], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[before], [tags]]);
    });

    it('does NOT isolate a tag embedded inside a sentence (whole-node match only)', () => {
      const p = document.createElement('p');
      const sentence = textNode('Footnote #1 explains this in detail.');
      p.append(sentence);

      const groups = groupNodesForBatching([sentence], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[sentence]]);
    });

    it('isolates two adjacent separate tag nodes as two singleton groups, not merged together', () => {
      const p = document.createElement('p');
      const tagA = textNode('#cat');
      const tagB = textNode('#dog');
      p.append(tagA, tagB);

      const groups = groupNodesForBatching([tagA, tagB], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[tagA], [tagB]]);
    });

    it('resumes normal block/sentence grouping for prose after an isolated tag', () => {
      const p = document.createElement('p');
      const tag = textNode('#news');
      const s1 = textNode('First sentence.');
      const s2 = textNode(' Second sentence.');
      p.append(tag, s1, s2);

      const groups = groupNodesForBatching([tag, s1, s2], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[tag], [s1, s2]]);
    });

    it('isolates each tag anchor in a list where the marker and word are separate sibling nodes (real bug: alicesw.com)', () => {
      // <a><em>#</em>travel</a><a><em>#</em>tech</a><a><em>#</em>food</a> —
      // collectTextNodes.ts already drops the bare "#" marker nodes, so
      // grouping only ever sees the three word nodes here; each one's
      // nearest <a> ancestor's full textContent ("#travel" etc, marker
      // still in the live DOM) is what makes it recognizable as a tag.
      const div = document.createElement('div');
      const anchors = ['travel', 'tech', 'food'].map((word) => {
        const a = document.createElement('a');
        const em = document.createElement('em');
        em.append(textNode('#'));
        const wordNode = textNode(word);
        a.append(em, wordNode);
        div.append(a);
        return wordNode;
      });

      const groups = groupNodesForBatching(anchors, { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[anchors[0]], [anchors[1]], [anchors[2]]]);
    });

    it('groups multiple word nodes under the SAME tag anchor together, not split apart', () => {
      // A tag word split across two inline elements within one anchor:
      // <a><em>#</em><span>sci</span>-fi</a>
      const a = document.createElement('a');
      const em = document.createElement('em');
      em.append(textNode('#'));
      const span = document.createElement('span');
      const sci = textNode('sci');
      span.append(sci);
      const fi = textNode('-fi');
      a.append(em, span, fi);
      document.body.append(a);

      const groups = groupNodesForBatching([sci, fi], { groupByBlock: true, maxGroupChars: 2000 });

      expect(groups).toEqual([[sci, fi]]);
    });

    it('ordinary prose grouping is unaffected when no tag is present (regression check)', () => {
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
  });
});
