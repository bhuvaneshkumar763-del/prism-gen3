/**
 * O(1) identity-dedupe for the translation queue; the periodic re-sweep makes
 * this a hot path on long pages. A WeakSet so entries vanish with GC'd nodes.
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
