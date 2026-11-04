/**
 * MutationObserver wiring while a page is translated: childList for added
 * content, and characterData because some sites rewrite an existing text
 * node's `data` in place. Every engine write must go through `noteOwnWrite`
 * first, or the characterData path would re-translate its own output forever.
 *
 * Changed nodes are never capped per callback: they're already tracked, so a
 * dropped one could never be rescued by the resweep. The re-sweep cadence is
 * owned by resweep.ts alone; this module must not force-bump it.
 */

import { HAS_LETTER } from '../../shared/text';
import { hasNoTranslateAncestor } from './collectTextNodes';

export interface MutationWatcherOptions {
  isTranslated(): boolean;
  isNoTranslateNode(node: Node): boolean;
  onNewRoot(root: Node): void;
  onChangedTextNode(node: Text): void;
}

export function createMutationWatcher(options: MutationWatcherOptions) {
  const lastWritten = new WeakMap<Text, string>();

  function noteOwnWrite(node: Text, text: string): void {
    lastWritten.set(node, text);
  }

  function coveredOrSkipped(node: Node, added: ReadonlySet<Node>): boolean {
    let el = node.parentElement;
    while (el) {
      if (added.has(el) || options.isNoTranslateNode(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  const observer = new MutationObserver((mutations) => {
    const added = new Set<Node>();
    const changedTextNodes = new Set<Text>();

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        added.add(node);
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
          !hasNoTranslateAncestor(t, options.isNoTranslateNode)
        ) {
          changedTextNodes.add(t);
        }
      }
    }

    // One ancestor walk per added node does both checks: a no-translate
    // ancestor drops it, and so does another added node above it, whose own
    // walk already covers it.
    added.forEach((node) => {
      if (options.isNoTranslateNode(node) || coveredOrSkipped(node, added)) return;
      options.onNewRoot(node);
    });
    changedTextNodes.forEach((node) => {
      options.onChangedTextNode(node);
    });
  });

  function enable(): void {
    disable();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function disable(): void {
    observer.disconnect();
    observer.takeRecords();
  }

  return { enable, disable, noteOwnWrite };
}

export type MutationWatcher = ReturnType<typeof createMutationWatcher>;
