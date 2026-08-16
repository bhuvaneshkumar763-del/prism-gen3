import { nearestBlockAncestor } from './grouping';

/**
 * Viewport-priority reordering — Phase 4a of the graceful-degradation pass.
 * Speed here means *perceived* speed: what the user is actually looking at
 * should translate first, not whatever happens to come first in DOM order.
 *
 * Deliberately upstream of grouping: this only reorders which nodes get
 * sliced into a tick's `batch` in `translateLoop.ts`, before
 * `groupNodesForBatching()` ever runs. It never touches grouping/chunking
 * itself, so it can't reopen the Google reflow-corruption bug (that bug
 * was in how a piece's translated response gets reconstructed after
 * grouping — this doesn't change grouping at all, just scheduling order).
 *
 * Pure and engine-pure: `getBoundingClientRect()` is a standard Web API,
 * no `chrome`/`browser` import.
 */

export interface ViewportRect {
  top: number;
  bottom: number;
}

/**
 * Stable-partitions `nodes` into "visible in `viewportRect` right now"
 * first, everything else after — preserving each partition's relative
 * (DOM/queue) order.
 *
 * Partitions by nearest BLOCK ancestor, not immediate parent: partitioning
 * by immediate parent could split a paragraph's own sibling text nodes (an
 * inline `<b>`/`<a>` element straddling the fold, say) across the two
 * partitions, with unrelated content from other blocks interleaved between
 * them in the result. `groupNodesForBatching()` flushes on every block
 * change, so those same-block siblings — now non-adjacent — would land in
 * separate, smaller pieces instead of one grouped piece with shared context.
 * Partitioning by block keeps a block's nodes contiguous and in their
 * original relative order either way.
 *
 * Also measures each unique block's rect only ONCE (`getBoundingClientRect()`
 * forces a layout read) rather than once per text node — several text nodes
 * commonly share one block ancestor (a paragraph split by inline formatting).
 */
export function prioritizeByViewport(nodes: Text[], viewportRect: ViewportRect): Text[] {
  const visible: Text[] = [];
  const rest: Text[] = [];
  const blockVisibility = new Map<Element, boolean>();

  for (const node of nodes) {
    const block = nearestBlockAncestor(node) ?? node.parentElement;
    const isVisible = block ? isElementVisible(block, blockVisibility, viewportRect) : false;
    (isVisible ? visible : rest).push(node);
  }

  return visible.length > 0 && visible.length < nodes.length ? [...visible, ...rest] : nodes;
}

function isElementVisible(el: Element, cache: Map<Element, boolean>, viewportRect: ViewportRect): boolean {
  const cached = cache.get(el);
  if (cached !== undefined) return cached;
  const result = isElementInViewport(el, viewportRect);
  cache.set(el, result);
  return result;
}

function isElementInViewport(el: Element, viewportRect: ViewportRect): boolean {
  const rect = el.getBoundingClientRect();
  // Standard "intersects" check — not "fully contained," a partially
  // visible paragraph at the top/bottom edge still counts as something
  // the user can currently see.
  return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
}
