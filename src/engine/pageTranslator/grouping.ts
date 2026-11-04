import { HAS_LETTER } from '../../shared/text';
import type { BatchingHint } from '../providers/descriptors';
import { isPureTagText } from './tagText';

/**
 * Groups consecutive queued text nodes into translate-request pieces, so a
 * context-sensitive provider sees the surrounding sentence/paragraph.
 *
 * 1. A Text node is never split across pieces; boundaries fall between nodes.
 * 2. Over budget, cut only after a node that ends a sentence; otherwise grow
 *    up to `hardMax` looking for one, then cut unconditionally.
 * 3. Pure tag text (`#go#be`, `@mention`) is its own singleton group: Google
 *    reorders/merges `<a i=N>` markers across short tag tokens in one piece.
 * 4. A tag split across nodes (`<a><em>#</em>travel</a>`) is isolated per
 *    anchor, by reading the anchor's whole `textContent`.
 * 5. Each item of a link/button cluster (`« Prev | Ch. 12 | Next »`,
 *    breadcrumbs) is isolated; detection is conservative, since a false
 *    positive splits prose while a false negative just groups normally.
 *
 * A linear scan in queue (document) order: same-block nodes are usually
 * adjacent, and an ungrouped node still translates correctly on its own.
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
  // Page-section and list/table containers: text directly under two of them
  // (a header and a footer) must not share one piece.
  'HEADER',
  'FOOTER',
  'NAV',
  'MAIN',
  'ASIDE',
  'UL',
  'OL',
  'DL',
  'TABLE',
  'CAPTION',
  'FORM',
  'FIELDSET',
  'DETAILS',
  'SUMMARY',
  'FIGURE',
  'ADDRESS',
]);

/** ASCII and full-width (CJK) sentence-final punctuation, optionally followed by a closing quote/paren and/or trailing whitespace. */
const SENTENCE_END = /[.!?。!?][)"'’”]*\s*$/;

/** How far a group may grow past `maxGroupChars` while waiting for a clean sentence boundary, rather than cutting mid-sentence. */
const SENTENCE_OVERFLOW_FACTOR = 1.5;

/**
 * Nearest `BLOCK_TAGS` ancestor; shared with viewportPriority.ts so "block"
 * means one thing. A shadow root's host counts as a block, so two components'
 * text never shares a piece.
 */
export function nearestBlockAncestor(node: Text): Element | null {
  let el = node.parentElement;
  let last: Node = node;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    last = el;
    el = el.parentElement;
  }
  if (el) return el;
  const root = last.parentNode;
  return root && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? ((root as ShadowRoot).host ?? null) : null;
}

/**
 * Elements that count as one item of a chip/nav/tag cluster (button facet
 * panels are tag clouds too). Only interactive controls: widening to
 * `<span>`/`<div>` would risk isolating ordinary styled prose.
 */
const CLUSTER_ITEM_TAGS = new Set(['A', 'BUTTON']);

/** Nearest `<a>`/`<button>` ancestor of `node`, stopping at a block boundary. */
function nearestTagAnchor(node: Text): Element | null {
  let el = node.parentElement;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    if (CLUSTER_ITEM_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Max item text length to read as a nav/chip item rather than a link in prose. */
const LINK_CLUSTER_MAX_ITEM_CHARS = 40;

/** Short item siblings needed, so one inline link in a sentence never matches. */
const LINK_CLUSTER_MIN_LINKS = 2;

/** Max connector length between items (` | `, `»`); connectors must be letterless, as letters mean prose. */
const LINK_CLUSTER_MAX_CONNECTOR_CHARS = 10;

function isClusterConnectorText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || (trimmed.length <= LINK_CLUSTER_MAX_CONNECTOR_CHARS && !HAS_LETTER.test(trimmed));
}

/**
 * Point 5 in the header. Called once per node, so `memo` (scoped to one
 * `groupNodesForBatching()` call) avoids an O(L²) rescan of large clusters.
 */
function isLinkClusterContainer(container: Element, memo: Map<Element, boolean>): boolean {
  const cached = memo.get(container);
  if (cached !== undefined) return cached;
  let linkCount = 0;
  let result = true;
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!isClusterConnectorText(child.textContent ?? '')) {
        result = false;
        break;
      }
    } else if (child.nodeType === Node.ELEMENT_NODE && CLUSTER_ITEM_TAGS.has((child as Element).tagName)) {
      const text = (child.textContent ?? '').trim();
      if (text.length === 0 || text.length > LINK_CLUSTER_MAX_ITEM_CHARS) {
        result = false;
        break;
      }
      linkCount++;
    } else {
      // Any other element (styled prose, an <img>) means "not a cluster".
      result = false;
      break;
    }
  }
  if (result) result = linkCount >= LINK_CLUSTER_MIN_LINKS;
  memo.set(container, result);
  return result;
}

/** Isolation key (points 3-5), or `null` for normal grouping. Point 3 keys on the node; 4 and 5 key on the anchor, so one anchor's nodes share a group. */
function isolationKeyFor(node: Text, linkClusterMemo: Map<Element, boolean>): Text | Element | null {
  if (isPureTagText(node.data.trim())) return node;
  const anchor = nearestTagAnchor(node);
  if (!anchor) return null;
  if (isPureTagText((anchor.textContent ?? '').trim())) return anchor;
  if (anchor.parentElement && isLinkClusterContainer(anchor.parentElement, linkClusterMemo)) return anchor;
  return null;
}

function endsAtSentenceBoundary(node: Text): boolean {
  return SENTENCE_END.test(node.data);
}

/**
 * Word-per-element markup: some readers wrap every word chunk in its own
 * element (`<i>Đường Sanh</i> <i>cố giả</i>, ...`, `<br>` between
 * paragraphs). As multi-item pieces Google scrambles words across markers;
 * as single nodes each chunk translates alone into gibberish.
 *
 * So each paragraph (its word run plus surrounding punctuation up to the
 * `<br>`) is sent as ONE string and written into the run's first node; the
 * other nodes and punctuation are emptied, so no full stop is duplicated.
 */
const WORD_ELEMENT_TAGS = new Set(['I', 'SPAN', 'FONT', 'EM', 'B']);
/** Max word-element text length: a sentence chunk, not a styled phrase. */
const WORD_ELEMENT_MAX_CHARS = 24;
/** Word elements needed before a container reads as word-per-element markup. */
const WORD_CONTAINER_MIN_ELEMENTS = 4;
/** Punctuation between word elements: what tells a chapter from a `<span>` menu row. */
const SENTENCE_PUNCTUATION = /[,.!?;:，。！？；：、]/;

/** The element's text when it is a short word wrapper holding only text, otherwise null. */
function wordElementText(el: Element): string | null {
  if (!WORD_ELEMENT_TAGS.has(el.tagName) || el.childNodes.length !== 1) return null;
  const child = el.firstChild;
  if (!child || child.nodeType !== Node.TEXT_NODE) return null;
  const text = (child as Text).data.trim();
  return text.length > 0 && text.length <= WORD_ELEMENT_MAX_CHARS ? text : null;
}

/**
 * True when `container`'s own text is all inside word elements: no
 * letter-bearing text between them (that is prose with some styled words),
 * enough of them, and sentence punctuation between them.
 */
function isWordContainer(container: Element, memo: Map<Element, boolean>): boolean {
  const cached = memo.get(container);
  if (cached !== undefined) return cached;
  let words = 0;
  let punctuated = false;
  let result = true;
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (HAS_LETTER.test(text)) {
        result = false;
        break;
      }
      if (SENTENCE_PUNCTUATION.test(text)) punctuated = true;
    } else if (child.nodeType === Node.ELEMENT_NODE && wordElementText(child as Element) !== null) {
      words++;
    }
  }
  result = result && punctuated && words >= WORD_CONTAINER_MIN_ELEMENTS;
  memo.set(container, result);
  return result;
}

/** The node's word element when it sits in a word-per-element container (and not inside a link/button), otherwise null. */
function wordElementOf(node: Text, memo: Map<Element, boolean>): Element | null {
  const el = node.parentElement;
  if (!el?.parentElement || nearestTagAnchor(node) || wordElementText(el) === null) return null;
  return isWordContainer(el.parentElement, memo) ? el : null;
}

/** True when `node` is one word of word-per-element markup (a chapter that wraps every word in its own element). */
export function isWordElementText(node: Text): boolean {
  return wordElementOf(node, new Map()) !== null;
}

/** True if `b` directly follows `a` with only letterless text (spaces, punctuation) between them — a `<br>` or any other element ends the paragraph. */
function continuesWordRun(a: Element, b: Element): boolean {
  if (a.parentElement !== b.parentElement) return false;
  for (let n = a.nextSibling; n !== b; n = n.nextSibling) {
    if (!n || n.nodeType !== Node.TEXT_NODE) return false;
  }
  return true;
}

/** Letterless text nodes from `from` to the paragraph edge, nearest first; empty unless the edge is a `<br>` or the container end, so split paragraphs never claim punctuation twice. */
function edgeText(from: Element, direction: 'previousSibling' | 'nextSibling'): Text[] {
  const texts: Text[] = [];
  let n = from[direction];
  while (n && n.nodeType === Node.TEXT_NODE) {
    texts.push(n as Text);
    n = n[direction];
  }
  return n === null || (n as Element).tagName === 'BR' ? texts : [];
}

/** One translation unit within a piece: a single node, or a word-per-element paragraph sent as one string. */
export interface PieceSlot {
  nodes: Text[];
  /** A paragraph's punctuation and spaces, emptied along with the rest of its words. */
  separators: Text[];
  text: string;
}

/**
 * Splits one group from `groupNodesForBatching` into the strings actually
 * sent: one slot per node, except that each paragraph of word-per-element
 * markup (see `WORD_ELEMENT_TAGS`) becomes a single slot whose text is the
 * paragraph as the page shows it.
 */
export function slotsForGroup(group: Text[]): PieceSlot[] {
  const memo = new Map<Element, boolean>();
  const slots: PieceSlot[] = [];
  let run: Text[] = [];
  let runElements: Element[] = [];

  function closeRun(): void {
    const first = runElements[0];
    const last = runElements[runElements.length - 1];
    if (first && last) {
      const leading = edgeText(first, 'previousSibling').reverse();
      const trailing = edgeText(last, 'nextSibling');
      const separators = [...leading];
      let text = leading.map((n) => n.data).join('');
      runElements.forEach((el, i) => {
        if (i > 0) {
          // biome-ignore lint/style/noNonNullAssertion: continuesWordRun walked this same chain
          for (let n = runElements[i - 1]!.nextSibling; n !== el; n = n!.nextSibling) {
            separators.push(n as Text);
            text += (n as Text).data;
          }
        }
        text += run[i]?.data ?? '';
      });
      separators.push(...trailing);
      text += trailing.map((n) => n.data).join('');
      slots.push({ nodes: run, separators, text });
    }
    run = [];
    runElements = [];
  }

  for (const node of group) {
    const el = wordElementOf(node, memo);
    if (!el) {
      closeRun();
      slots.push({ nodes: [node], separators: [], text: node.data });
      continue;
    }
    const prev = runElements[runElements.length - 1];
    if (prev && !continuesWordRun(prev, el)) closeRun();
    run.push(node);
    runElements.push(el);
  }
  closeRun();
  return slots;
}

/** Splits `nodes` into one group per piece (see header). One node per group unless `hint.groupByBlock`. */
export function groupNodesForBatching(nodes: Text[], hint: BatchingHint | undefined): Text[][] {
  if (!hint?.groupByBlock) return nodes.map((n) => [n]);

  const hardMax = hint.maxGroupChars * SENTENCE_OVERFLOW_FACTOR;
  // Per call, so answers can't go stale across translate cycles.
  const linkClusterMemo = new Map<Element, boolean>();
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
    const isolationKey = isolationKeyFor(node, linkClusterMemo);
    if (isolationKey !== null) {
      if (currentIsolationKey !== isolationKey) {
        // Whatever was building (prose or another isolated item) can't share this group.
        flush();
        currentIsolationKey = isolationKey;
        currentBlock = nearestBlockAncestor(node);
      }
      currentGroup.push(node);
      currentChars += node.data.length;
      continue;
    }

    if (currentIsolationKey !== null) {
      flush();
    }

    const block = nearestBlockAncestor(node);
    if (currentGroup.length > 0 && block !== currentBlock) {
      flush();
    }

    if (currentGroup.length > 0) {
      const projectedChars = currentChars + node.data.length;
      if (projectedChars > hint.maxGroupChars) {
        if (groupEndsAtBoundary) {
          flush();
        } else if (projectedChars > hardMax) {
          flush();
        }
        // Otherwise mid-sentence and under hardMax: keep growing.
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
