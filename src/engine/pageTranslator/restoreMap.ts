/**
 * Pre-translation values keyed by DOM node, for Show original. `prune` parks
 * a disconnected node's entry behind a WeakRef: a removed subtree can still be
 * garbage-collected, while a pooled node the page keeps (a recycled list row)
 * stays restorable however long it's off the page, and is live again once
 * reattached. Shared by the text ledger (writeBack.ts) and attributeTranslator.ts.
 */
export function createRestoreMap<K extends Node, V>() {
  let live = new Map<K, V>();
  let parked = new WeakMap<K, V>();
  // One WeakRef per node, so parking it again never lists it twice.
  let refs = new WeakMap<K, WeakRef<K>>();
  let parkedRefs = new Set<WeakRef<K>>();

  return {
    get(node: K): V | undefined {
      return live.get(node) ?? parked.get(node);
    },
    has(node: K): boolean {
      return live.has(node) || parked.has(node);
    },
    set(node: K, value: V): void {
      parked.delete(node);
      live.set(node, value);
    },
    /** Every entry, connected or not. */
    forEach(cb: (value: V, node: K) => void): void {
      live.forEach(cb);
      for (const ref of parkedRefs) {
        const node = ref.deref();
        const value = node && parked.get(node);
        if (node && value !== undefined) cb(value, node);
      }
    },
    clear(): void {
      live = new Map();
      parked = new WeakMap();
      refs = new WeakMap();
      parkedRefs = new Set();
    },
    /** Bounds the strongly held entries: run on every resweep tick. */
    prune(): void {
      for (const [node, value] of live) {
        if (node.isConnected) continue;
        live.delete(node);
        parked.set(node, value);
        let ref = refs.get(node);
        if (!ref) {
          ref = new WeakRef(node);
          refs.set(node, ref);
        }
        parkedRefs.add(ref);
      }
      for (const ref of parkedRefs) {
        const node = ref.deref();
        const value = node && parked.get(node);
        if (!node || value === undefined) {
          parkedRefs.delete(ref);
        } else if (node.isConnected) {
          parked.delete(node);
          live.set(node, value);
          parkedRefs.delete(ref);
        }
      }
    },
  };
}

export type RestoreMap<K extends Node, V> = ReturnType<typeof createRestoreMap<K, V>>;
