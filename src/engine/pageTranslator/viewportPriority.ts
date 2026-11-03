import { nearestBlockAncestor } from './grouping';

/**
 * Viewport-priority reordering: what the user is looking at translates first.
 * Runs before `groupNodesForBatching()` and only changes scheduling order,
 * never how nodes are grouped.
 */

export interface ViewportRect {
  top: number;
  bottom: number;
}

/**
 * Stable-partitions `nodes` into visible-in-viewport first, the rest after.
 * Partitions by nearest BLOCK ancestor so a block's text nodes stay contiguous
 * (grouping flushes on block change); each block's rect is measured once.
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
  // Intersects, not fully contained: a partly visible paragraph counts.
  return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
}
