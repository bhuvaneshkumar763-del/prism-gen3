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
 * (DOM/queue) order. A node's own bounding rect isn't meaningful for a
 * Text node, so this checks its nearest element ancestor instead.
 */
export function prioritizeByViewport(nodes: Text[], viewportRect: ViewportRect): Text[] {
  const visible: Text[] = [];
  const rest: Text[] = [];

  for (const node of nodes) {
    const el = node.parentElement;
    if (el && isElementInViewport(el, viewportRect)) {
      visible.push(node);
    } else {
      rest.push(node);
    }
  }

  return visible.length > 0 && visible.length < nodes.length ? [...visible, ...rest] : nodes;
}

function isElementInViewport(el: Element, viewportRect: ViewportRect): boolean {
  const rect = el.getBoundingClientRect();
  // Standard "intersects" check — not "fully contained," a partially
  // visible paragraph at the top/bottom edge still counts as something
  // the user can currently see.
  return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
}
