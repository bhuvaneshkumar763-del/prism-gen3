/**
 * O(1) identity-dedupe tracking for the translation queue. A naive "is this
 * node already queued?" check (linear scan of every tracked node for every
 * candidate) becomes the hottest loop on a long page once a periodic
 * re-sweep (see resweep.ts) runs every couple of seconds — a WeakSet makes
 * membership checks O(1), and WeakSet specifically (not Set) so a node's
 * tracking entry disappears with it once it leaves the DOM and is
 * garbage-collected, instead of leaking memory forever.
 */
export function createDedupeTracker() {
  let trackedNodes = new WeakSet<Node>();

  return {
    isTracked(node: Node): boolean {
      return trackedNodes.has(node);
    },
    track(nodes: Iterable<Node>): void {
      for (const n of nodes) trackedNodes.add(n);
    },
    /** Rebuilt at the start of each translate cycle so nodes from a previous cycle that left and re-entered the DOM aren't wrongly considered tracked. */
    reset(): void {
      trackedNodes = new WeakSet();
    },
  };
}

export type DedupeTracker = ReturnType<typeof createDedupeTracker>;
