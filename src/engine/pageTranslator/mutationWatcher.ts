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
  // Post-launch speed pass: the periodic interval used to call `onRescan`
  // (resweep.bump()) unconditionally every tick, which forces resweep's own
  // full-document.body walk to run in 250ms — always sooner than resweep's
  // own backoff timer (min 1500ms) would ever fire on its own. Net effect:
  // a full-page re-walk ran continuously every ~500-750ms for as long as a
  // page stayed translated+visible, never backing off on a quiet page, real
  // CPU cost that scales with page size. This flag lets the periodic tick
  // skip that forced bump whenever the MutationObserver itself already
  // fired in that window — the observer already handles real mutations in
  // real time, so there's nothing for resweep to catch there. Only bump
  // when the observer has been silent, which is exactly the scenario
  // resweep exists for (mutations the observer structurally can't see —
  // inside a shadow root, or a subtree built detached and reattached — see
  // resweep.ts's header comment).
  let mutatedSinceLastCheck = false;

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
          !changedTextNodes.includes(t)
        ) {
          changedTextNodes.push(t);
        }
      }
    }

    if (newRoots.length > 0 || changedTextNodes.length > 0) mutatedSinceLastCheck = true;

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
    mutatedSinceLastCheck = false;
    // A periodic full re-walk of document.body, on top of the mutation
    // observer, catches anything the observer's targeted childList
    // reporting missed — see resweep.ts for the longer-interval, backing-off
    // version of this same idea. Only actually triggered when the observer
    // itself has been silent since the last check — see the
    // `mutatedSinceLastCheck` comment above for why.
    if (onRescan) {
      dynamicContentInterval = setInterval(() => {
        if (!mutatedSinceLastCheck) onRescan();
        mutatedSinceLastCheck = false;
      }, rescanIntervalMs);
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
