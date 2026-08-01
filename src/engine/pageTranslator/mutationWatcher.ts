/**
 * MutationObserver wiring, watching for two things while a page is
 * translated:
 *
 * 1. childList mutations — new elements/text added to the page (dynamic
 *    content, infinite scroll, SPA navigation).
 * 2. characterData mutations — several sites swap text by writing directly
 *    into an EXISTING text node (`node.data = "..."`) instead of inserting
 *    new nodes, which fires no childList mutation at all and would
 *    otherwise stay untranslated forever. The loop guard (`isOwnWrite`)
 *    distinguishes "we just wrote this translation" from "the site changed
 *    the text under us" — every write this engine makes must be reported
 *    via `noteOwnWrite` first, or this would re-translate its own output
 *    forever.
 *
 * Standard Web APIs only (`MutationObserver`, `Node`, `Text`) — no
 * `chrome`/`browser` imports, so this lives in `src/engine/` per the
 * purity boundary (see `src/engine/README.md`).
 */

export interface MutationWatcherOptions {
  isTranslated(): boolean;
  isNoTranslateNode(node: Node): boolean;
  onNewRoot(root: Node): void;
  onChangedTextNode(node: Text): void;
}

const HAS_LETTER = /\p{L}/u;
const MAX_CHANGED_NODES_PER_TICK = 25;

export function createMutationWatcher(options: MutationWatcherOptions) {
  const lastWritten = new WeakMap<Text, string>();

  function noteOwnWrite(node: Text, text: string): void {
    lastWritten.set(node, text);
  }

  const observer = new MutationObserver((mutations) => {
    const newRoots: Node[] = [];
    const changedTextNodes: Text[] = [];

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!options.isNoTranslateNode(node)) newRoots.push(node);
      });

      if (mutation.type === 'characterData' && options.isTranslated()) {
        const t = mutation.target as Text;
        const parent = t.parentNode;
        if (
          t.isConnected &&
          lastWritten.get(t) !== t.data &&
          HAS_LETTER.test(t.data || '') &&
          parent &&
          !options.isNoTranslateNode(parent) &&
          !changedTextNodes.includes(t) &&
          changedTextNodes.length < MAX_CHANGED_NODES_PER_TICK
        ) {
          changedTextNodes.push(t);
        }
      }
    }

    newRoots.forEach((root) => {
      options.onNewRoot(root);
    });
    changedTextNodes.forEach((node) => {
      options.onChangedTextNode(node);
    });
  });

  let dynamicContentInterval: ReturnType<typeof setInterval> | null = null;

  function enable(rescanIntervalMs = 500, onRescan?: () => void): void {
    disable();
    // A periodic full re-walk of document.body, on top of the mutation
    // observer, catches anything the observer's targeted childList
    // reporting missed — see resweep.ts for the longer-interval, backing-off
    // version of this same idea.
    if (onRescan) {
      dynamicContentInterval = setInterval(onRescan, rescanIntervalMs);
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function disable(): void {
    if (dynamicContentInterval) clearInterval(dynamicContentInterval);
    dynamicContentInterval = null;
    observer.disconnect();
    observer.takeRecords();
  }

  return { enable, disable, noteOwnWrite };
}

export type MutationWatcher = ReturnType<typeof createMutationWatcher>;
