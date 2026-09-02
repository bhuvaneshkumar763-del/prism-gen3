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
 *
 * Post-launch dynamic-content-correctness pass: this used to cap
 * `changedTextNodes` at 25 distinct nodes per MutationObserver callback,
 * silently dropping anything past the 25th — a real content-loss bug for a
 * chat/dashboard app re-rendering 30+ live rows in one synchronous batch
 * (each dropped node is already tracked, so neither the resweep backstop
 * nor dedupe.ts could ever rescue it afterward). Removed: recording a
 * changed node here is cheap (an array push + a later queue.push in
 * translateLoop.ts's `requeueChangedTextNode`), so there's no real cost to
 * processing a whole batch — the expensive part (the actual translate
 * request) is already rate-limited separately by `MAX_PIECES_PER_TICK` in
 * translateLoop.ts, which this doesn't touch.
 *
 * Reliability/speed fix, found via audit: this module used to also run its
 * own periodic timer that force-triggered a full-page resweep
 * (`resweep.bump()`, which resets resweep's own adaptive backoff — see
 * resweep.ts — straight back to its 1.5s minimum) whenever the
 * MutationObserver had seen no mutations in the last ~500ms. The reasoning
 * ("only force a resweep when the observer's been silent, since that's the
 * scenario resweep exists for — content added inside a shadow root, which
 * the observer structurally can't see") sounds right but doesn't hold up:
 * "the observer saw nothing" is the DEFAULT state of any static page, not
 * a signal that shadow-DOM content just appeared, so this fired on every
 * single tick forever for the common case of a page that simply isn't
 * mutating — forcing a full `document.body` walk every ~500-750ms
 * indefinitely and defeating resweep's own backoff, exactly the bug this
 * mechanism's own doc comment (at its original introduction) says it was
 * built to fix. It's also fully redundant: `resweep.ts`'s own `run()` loop
 * already does the identical full-body walk independently, on its own
 * adaptive schedule (1.5s right after a translate starts, backing off to
 * 10s on a page that stays quiet, resetting to 1.5s the moment it finds
 * something new) — that's the actual, correct mechanism for catching
 * shadow-DOM-invisible content, and needs no help from here. Removed
 * rather than patched, since patching the condition (only force-bump on a
 * BUSY tick instead) would have traded this bug for a worse one — forcing
 * a full-body walk on every tick of any continuously-updating page (a live
 * chat, a stock ticker) forever.
 */

export interface MutationWatcherOptions {
  isTranslated(): boolean;
  isNoTranslateNode(node: Node): boolean;
  onNewRoot(root: Node): void;
  onChangedTextNode(node: Text): void;
}

const HAS_LETTER = /\p{L}/u;

export function createMutationWatcher(options: MutationWatcherOptions) {
  const lastWritten = new WeakMap<Text, string>();

  function noteOwnWrite(node: Text, text: string): void {
    lastWritten.set(node, text);
  }

  /**
   * Real gap this closed, found via audit: `options.isNoTranslateNode`
   * only ever inspects ONE node — by design, it's the same check
   * `collectTextNodes.ts`'s own walk uses, which never needs to look
   * further because IT walks top-down from `document.body` and stops
   * descending the instant a skip node is found, so every descendant is
   * implicitly covered. A mutation callback has no such guarantee: the
   * node it's handed can be reinserted or rewritten arbitrarily deep
   * inside a subtree the initial walk already decided to skip (a syntax
   * highlighter rewriting `<code>`'s innerHTML with plain `<span>`s, a
   * charting library appending `<text>` labels into an existing `<svg>`),
   * and neither the added node nor its immediate parent is itself a skip
   * tag/class — only some ANCESTOR further up is. Without walking up,
   * that content gets queued and translated even though the very same
   * content would have been correctly skipped had it been present at
   * initial-walk time. Nothing recovers from this afterward: dedupe.ts
   * marks the node tracked forever once queued.
   */
  function hasNoTranslateAncestor(node: Node): boolean {
    let el = node.parentElement;
    while (el) {
      if (options.isNoTranslateNode(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  const observer = new MutationObserver((mutations) => {
    const newRoots: Node[] = [];
    const changedTextNodes = new Set<Text>();

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!options.isNoTranslateNode(node) && !hasNoTranslateAncestor(node)) newRoots.push(node);
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
          !hasNoTranslateAncestor(t)
        ) {
          changedTextNodes.add(t);
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
