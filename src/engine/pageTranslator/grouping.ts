import type { BatchingHint } from '../providers/descriptors';
import { isPureTagText } from './tagText';

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
 *
 * 3. **Isolate tag-cluster text (`#go#be`, `@mention`, ...) into its own
 *    singleton group, never batched with anything else.** A grouped piece
 *    with more than one string goes through provider-specific multi-item
 *    wire markers — Google's `<a i=N>` index tags (`google.ts`), the LLM
 *    provider's `␟`-joined segments (`llm.ts`) — and real traffic has
 *    shown Google's endpoint can reorder/merge those markers when several
 *    short tag tokens sit in one batch, scrambling which translated
 *    fragment maps back to which tag (ported fix, see `tagText.ts`'s
 *    header comment for the full history). A size-1 piece never triggers
 *    either provider's multi-item marker scheme at all, so there's
 *    structurally nothing left to scramble. This only changes behavior
 *    when `hint.groupByBlock` is true (`google`/`llm` today) — providers
 *    without a `batchingHint` already send one node per piece regardless.
 *
 * 4. **Isolate a tag ANCHOR's text nodes together, even when the tag is
 *    split across sibling nodes.** Real tag lists (confirmed against a
 *    real reported bug — alicesw.com) often mark up a tag as
 *    `<a><em>#</em>travel</a>`: the marker and the word are two separate
 *    Text nodes, so neither one alone matches `isPureTagText` and point 3
 *    above never fires. A page with 15 such tags in a row was grouping ALL
 *    of them into one shared-block-ancestor piece — the same multi-item
 *    scrambling point 3 exists to prevent, just from a different DOM
 *    shape. `tagAnchorFor` walks up from a node to its nearest `<a>`
 *    ancestor (stopping at a block boundary); if that anchor's own full
 *    `textContent` reads as a pure tag, every Text node under that
 *    specific anchor is grouped together and isolated from neighboring
 *    anchors — one piece per tag, not one piece for the whole list. (The
 *    bare `#`/`@` marker node itself is filtered out earlier, in
 *    `collectTextNodes.ts`, so in the common case this only ends up
 *    isolating the word — the anchor-text check still reads the marker
 *    off the live DOM to recognize the cluster as a tag in the first
 *    place.)
 *
 * 5. **Isolate each link in a nav-row/chapter-title/breadcrumb link
 *    cluster into its own group**, the same class of fix as point 4 but
 *    for a DOM shape point 4's `isPureTagText` check doesn't recognize at
 *    all: several short `<a>` siblings under one shared container
 *    (`« Prev | Chapter 12 | Next »`, a breadcrumb trail, a category link
 *    list) with no `#`/`@` marker in sight. Confirmed via a real repro
 *    (not assumed): a chapter-nav row's three link texts land in exactly
 *    one multi-item piece today, the identical Google `<a i=N>`-marker
 *    scrambling risk points 3/4 already exist to prevent, just untreated
 *    for this shape. `isLinkClusterContainer` recognizes the pattern
 *    conservatively — every direct child of the container must be either
 *    a short `<a>` or letterless connector text (a real prose paragraph's
 *    own letter-bearing text nodes, e.g. "Hello <b>world</b>.", disqualify
 *    it immediately, since `nodes` here has already had every letterless
 *    node filtered out upstream by `collectTextNodes.ts` — a plain text
 *    child bearing a letter is exactly the "this is real prose, not a
 *    link row" signal). A single inline link inside an otherwise-ordinary
 *    sentence never matches (needs `LINK_CLUSTER_MIN_LINKS` siblings), so
 *    the true-negative "see our documentation for details" case is left
 *    grouped with its surrounding sentence, unaffected. Deliberately
 *    narrower than TWP's own later refinement round (which also handled a
 *    trailing non-link "current page" breadcrumb crumb) — that shape needs
 *    isolating a plain element, not just an anchor, and risked exactly the
 *    over-eager-isolation problem that round had to correct for in the
 *    other direction; left as a documented follow-up rather than guessed.
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

/**
 * Exported for `viewportPriority.ts`'s block-level partitioning — reuses
 * this exact block-tag walk instead of duplicating `BLOCK_TAGS`, so the two
 * modules can't silently drift on what counts as a "block."
 */
export function nearestBlockAncestor(node: Text): Element | null {
  let el = node.parentElement;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el;
}

/** Walks up from `node` to its nearest `<a>` ancestor, stopping at a block boundary — the marker/word split described in point 4 above is always inside one anchor closer than any block element. */
function nearestTagAnchor(node: Text): Element | null {
  let el = node.parentElement;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    if (el.tagName === 'A') return el;
    el = el.parentElement;
  }
  return null;
}

/** An individual link's own text may be at most this long to still read as a nav/breadcrumb/chapter-title item rather than a real inline link sitting in prose. */
const LINK_CLUSTER_MAX_ITEM_CHARS = 40;

/** How many short-link siblings a container needs before it's treated as a cluster, not one link incidentally sitting in an ordinary sentence. */
const LINK_CLUSTER_MIN_LINKS = 2;

/** A connector between cluster links (` | `, ` > `, `»`, ...) may be at most this long and must carry no letters — see point 5's header comment for why a letter-bearing child disqualifies the whole container. */
const LINK_CLUSTER_MAX_CONNECTOR_CHARS = 10;
const HAS_LETTER = /\p{L}/u;

function isClusterConnectorText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || (trimmed.length <= LINK_CLUSTER_MAX_CONNECTOR_CHARS && !HAS_LETTER.test(trimmed));
}

/** See point 5 in this file's header comment. */
function isLinkClusterContainer(container: Element): boolean {
  let linkCount = 0;
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!isClusterConnectorText(child.textContent ?? '')) return false;
    } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'A') {
      const text = (child.textContent ?? '').trim();
      if (text.length === 0 || text.length > LINK_CLUSTER_MAX_ITEM_CHARS) return false;
      linkCount++;
    } else {
      // Any other element type (a <b>/<em>/<span> wrapping real prose,
      // an <img>, ...) is conservatively treated as "not a cluster" —
      // see point 5's header comment for why a false negative here is
      // cheap (today's existing grouping behavior) but a false positive
      // isn't.
      return false;
    }
  }
  return linkCount >= LINK_CLUSTER_MIN_LINKS;
}

/** The isolation key for a node isolated by point 3, 4, or 5 above — `null` means "not isolated, use normal grouping." Point 3 keys on the node itself (always its own group); points 4 and 5 key on the shared anchor (so sibling nodes under the same tag anchor merge into one group, while different anchors in the same cluster stay isolated from each other). */
function isolationKeyFor(node: Text): Text | Element | null {
  if (isPureTagText(node.data.trim())) return node;
  const anchor = nearestTagAnchor(node);
  if (!anchor) return null;
  if (isPureTagText((anchor.textContent ?? '').trim())) return anchor;
  if (anchor.parentElement && isLinkClusterContainer(anchor.parentElement)) return anchor;
  return null;
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
  let currentIsolationKey: Text | Element | null = null;

  function flush(): void {
    if (currentGroup.length > 0) groups.push(currentGroup);
    currentGroup = [];
    currentChars = 0;
    groupEndsAtBoundary = false;
    currentIsolationKey = null;
  }

  for (const node of nodes) {
    const isolationKey = isolationKeyFor(node);
    if (isolationKey !== null) {
      if (currentIsolationKey !== isolationKey) {
        // Either starting fresh, leaving normal grouping, or moving from one
        // isolated tag to a different one — either way, whatever was
        // building doesn't belong with this node. See this function's
        // header comment (points 3 and 4) for why.
        flush();
        currentIsolationKey = isolationKey;
        currentBlock = nearestBlockAncestor(node);
      }
      currentGroup.push(node);
      currentChars += node.data.length;
      continue;
    }

    if (currentIsolationKey !== null) {
      // Leaving an isolated tag group — the next node is ordinary prose, so
      // close the tag group out before resuming normal grouping.
      flush();
    }

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
