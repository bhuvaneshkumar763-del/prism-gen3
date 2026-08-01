import type { BatchingHint } from '../providers/descriptors';

/**
 * Groups consecutive queued text nodes into pieces suitable for a single
 * translate-request "piece" each — the chunking logic that determines how
 * much context a translation provider sees per request. This is the single
 * biggest lever this project has over translation *quality* independent of
 * which provider is picked: one isolated word or sentence fragment per
 * request starves a context-sensitive engine (an LLM, or Google's
 * multi-item `<a i=N>` endpoint) of the surrounding sentence/paragraph it
 * needs to resolve pronouns, pick consistent terminology, and produce
 * natural word order — grouping sibling text nodes under the same block
 * ancestor into one piece gives it that context.
 *
 * Two things beyond simple block-ancestor grouping matter for quality, and
 * both are handled here:
 *
 * 1. **Never split a single Text node's content across two pieces.** A
 *    node is the atomic unit translateLoop.ts splices results back into —
 *    grouping only ever draws boundaries BETWEEN nodes.
 * 2. **Prefer to draw that boundary at a sentence end, not wherever the
 *    character budget happens to run out.** Inline formatting (`<b>`,
 *    `<a>`, ...) routinely splits one sentence across several adjacent
 *    Text nodes — e.g. "Hello <b>world</b>." is 3 nodes: "Hello ", "world",
 *    ".". A budget cut that lands between "world" and "." would send a
 *    lone "." as its own translation piece (which no MT/LLM engine handles
 *    well) and would sever "world" from the sentence context that would
 *    help translate it correctly. Once over budget, this only cuts
 *    immediately if the group's most-recently-added node completed a
 *    sentence; otherwise it lets the group grow past `maxGroupChars` (up
 *    to a bounded `hardMax`) hunting for that sentence's real end before
 *    cutting — and falls back to an unconditional cut at `hardMax` so a
 *    pathological node stream (no punctuation at all) still terminates in
 *    bounded pieces rather than growing forever.
 *
 * Deliberately a linear scan over `nodes` in their given (queue) order, not
 * a full DOM-tree walk — `collectTextNodes` already produces nodes in
 * document order via depth-first traversal, so nodes under the same block
 * end up adjacent in the common case. Not a guarantee for every possible
 * DOM shape, just a reasonable heuristic; a node that ends up ungrouped
 * still gets translated correctly on its own, just without the extra
 * context.
 */

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'TD',
  'TH',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'ARTICLE',
  'SECTION',
  'FIGCAPTION',
  'DT',
  'DD',
]);

/** ASCII and full-width (CJK) sentence-final punctuation, optionally followed by a closing quote/paren and/or trailing whitespace. */
const SENTENCE_END = /[.!?。!?][)"'’”]*\s*$/;

/** How far a group may grow past `maxGroupChars` while waiting for a clean sentence boundary, rather than cutting mid-sentence. */
const SENTENCE_OVERFLOW_FACTOR = 1.5;

function nearestBlockAncestor(node: Text): Element | null {
  let el = node.parentElement;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el;
}

function endsAtSentenceBoundary(node: Text): boolean {
  return SENTENCE_END.test(node.data);
}

/** Splits `nodes` into groups suitable for a single translate-request piece each, respecting `hint.maxGroupChars`, block-ancestor boundaries (if `hint.groupByBlock`), and sentence boundaries. Returns one group per node (today's default one-node-per-piece behavior) when `hint` is undefined or `groupByBlock` is false. */
export function groupNodesForBatching(nodes: Text[], hint: BatchingHint | undefined): Text[][] {
  if (!hint?.groupByBlock) return nodes.map((n) => [n]);

  const hardMax = hint.maxGroupChars * SENTENCE_OVERFLOW_FACTOR;
  const groups: Text[][] = [];
  let currentGroup: Text[] = [];
  let currentBlock: Element | null = null;
  let currentChars = 0;
  let groupEndsAtBoundary = false;

  function flush(): void {
    if (currentGroup.length > 0) groups.push(currentGroup);
    currentGroup = [];
    currentChars = 0;
    groupEndsAtBoundary = false;
  }

  for (const node of nodes) {
    const block = nearestBlockAncestor(node);
    if (currentGroup.length > 0 && block !== currentBlock) {
      // A block boundary is always a clean cut — no sentence risk, the
      // content genuinely belongs to a different paragraph/list item/etc.
      flush();
    }

    if (currentGroup.length > 0) {
      const projectedChars = currentChars + node.data.length;
      if (projectedChars > hint.maxGroupChars) {
        if (groupEndsAtBoundary) {
          // The group is already a complete sentence (or more) — cut here
          // rather than starting a new sentence inside an over-budget group.
          flush();
        } else if (projectedChars > hardMax) {
          // No sentence boundary reached even after bounded overflow —
          // force a cut so worst-case piece size stays bounded.
          flush();
        }
        // Otherwise: over the soft budget but mid-sentence and still under
        // hardMax — let this node join and keep looking for a boundary.
      }
    }

    currentGroup.push(node);
    currentChars += node.data.length;
    currentBlock = block;
    groupEndsAtBoundary = endsAtSentenceBoundary(node);
  }

  flush();
  return groups;
}
