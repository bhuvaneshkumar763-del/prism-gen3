import type { Translator } from '../translator';
import {
  type AttributeTarget,
  collectAttributeTargets,
  hasNoTranslateAncestor,
  isNoTranslateNode,
  TRANSLATABLE_ATTRIBUTES,
} from './collectTextNodes';

/**
 * Drops an `originals` entry once its element has been disconnected for two
 * CONSECUTIVE resweep ticks, not one — same discipline, and the same real
 * bug it closes, as `translateLoop.ts`'s `pruneDisconnectedRestoreEntries`
 * (see that function's doc comment). Exported as a standalone function, for
 * the same reason: directly unit-testable via plain Map/WeakSet
 * manipulation, instead of only through the full resweep-scheduler/
 * MutationObserver timing stack.
 */
export function pruneDisconnectedAttributeEntries(
  originals: Map<Element, Map<string, string>>,
  disconnectedLastTick: WeakSet<Element>,
): void {
  for (const el of originals.keys()) {
    if (!el.isConnected) {
      if (disconnectedLastTick.has(el)) {
        originals.delete(el);
      } else {
        disconnectedLastTick.add(el);
      }
    } else {
      disconnectedLastTick.delete(el);
    }
  }
}

/**
 * Attribute translation (round-3 audit follow-up, deferred from beta.35's
 * accuracy round for its own design pass): `placeholder`, `alt`, `value`
 * (button/submit/reset only), `title`, and `aria-label` — see
 * `collectTextNodes.ts`'s `collectAttributeTargets` doc comment for the
 * exact target set, matched against TWP's real live source. Prism
 * previously translated no attributes at all — search boxes, image alt
 * text, button labels, and tooltips stayed in the original language even
 * on an otherwise fully-translated page.
 *
 * Kept as its own module (not folded into `translateLoop.ts`), the same
 * reasoning as `titleTranslator.ts`: attributes aren't `Text` nodes, so
 * none of `translateLoop.ts`'s collect/queue/write-back/restore machinery
 * (built entirely around `Text` node identity) applies directly — this
 * needs its own small, independently unit-testable subsystem instead.
 *
 * Deliberately simpler than `translateLoop.ts`'s own queue/retry/backoff
 * machinery: one batch translate covers the whole initial page, and a
 * MutationObserver (childList for new elements, attributes for value
 * changes) covers whatever changes afterward — no per-attempt retry
 * bookkeeping, since a translated tooltip/placeholder failing once and
 * staying in the source language is a far smaller user-facing problem
 * than a whole untranslated paragraph, and the existing resweep backstop
 * doesn't apply here (it re-walks for `Text` nodes only).
 */

export interface AttributeTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** True when the user picked the source language by hand; see `TranslateBatchRequest.sourceLanguageIsExplicit`. */
  isSourceLanguageExplicit?(): boolean;
}

// Derived, never hand-listed — see TRANSLATABLE_ATTRIBUTES's doc comment
// for the silent-drift bug that separate lists allowed.
const WATCHED_ATTRIBUTES: AttributeTarget['attribute'][] = [...TRANSLATABLE_ATTRIBUTES];

export function createAttributeTranslator(options: AttributeTranslatorOptions) {
  /**
   * Original values, for `restore()`. Element -> attribute -> pre-translation
   * value. A plain `Map`, not a `WeakMap`, since `restore()` must ENUMERATE
   * it — but that means every translated element is pinned (with its whole
   * detached subtree) for as long as this map holds it, so `pruneDisconnected`
   * below bounds its growth the same way `translateLoop.ts`'s own
   * `pruneDisconnectedRestoreEntries` bounds `nodesToRestore` (same two-tick
   * discipline, for the same reason — see that function's doc comment).
   */
  const originals = new Map<Element, Map<string, string>>();
  /** Two consecutive disconnected resweep ticks before pruning an `originals` entry — see `pruneDisconnected` below. */
  const disconnectedLastTick = new WeakSet<Element>();
  /**
   * The last value THIS module wrote for a given element/attribute — the
   * mutation-observer loop guard. Without this, translating "Search" ->
   * "Buscar" and writing it back would itself fire an 'attributes'
   * mutation, which would be mistaken for the page changing the attribute
   * and re-queued for translation forever.
   *
   * A `WeakMap`, not a `Map` (real leak this closed, found via a round-4
   * audit): unlike `originals`, nothing ever needs to enumerate this one —
   * it's purely a point lookup keyed by the element itself — so there is no
   * reason to keep a strong reference to every element this module has ever
   * written to for the rest of the page's life. `WeakMap` has no `.clear()`,
   * so `restore()` reassigns a fresh instance instead.
   */
  let lastWritten = new WeakMap<Element, Map<string, string>>();

  let currentTargetLanguage = '';
  let observer: MutationObserver | null = null;
  // Generation guard (real bug this closed, found via a round-4 audit):
  // `start()` awaits a network round trip before installing the observer.
  // A `restore()` (or a second `start()`, e.g. a fast re-translate) landing
  // during that await used to be silently undone the instant the await
  // resolved — the observer got installed unconditionally, so it kept
  // shipping attribute text to the provider after the user had already
  // asked for the original page back. Same pattern as `translateLoop.ts`'s
  // own `cycleGeneration`.
  let generation = 0;
  // Serializes attribute-translate dispatch (real bug this closed, found
  // via a round-4 audit, diagnosed live on X.com): the observer used to
  // call `void translateTargets(newTargets)` per callback with no
  // debounce, coalescing, or cap — on a virtualized/infinite-scroll feed
  // this fired one unthrottled, uncapped HTTP request per mutation batch,
  // all concurrently. Mutations arriving while a translate is already in
  // flight are coalesced into `pendingTargets` and drained by the SAME
  // single in-flight call instead of starting a new one.
  let pendingTargets: AttributeTarget[] = [];
  let translateInFlight = false;

  function noteOriginal(el: Element, attribute: string, value: string): void {
    let perEl = originals.get(el);
    if (!perEl) {
      perEl = new Map();
      originals.set(el, perEl);
    }
    // Only the FIRST-ever-seen value is the real original — a later
    // re-translate (the page itself changed the attribute again) must not
    // overwrite it with an already-translated value.
    if (!perEl.has(attribute)) perEl.set(attribute, value);
  }

  function noteWritten(el: Element, attribute: string, value: string): void {
    let perEl = lastWritten.get(el);
    if (!perEl) {
      perEl = new Map();
      lastWritten.set(el, perEl);
    }
    perEl.set(attribute, value);
  }

  async function translateTargets(targets: AttributeTarget[]): Promise<void> {
    if (targets.length === 0) return;
    // Round-6 audit fix: `start()` already guards whether to install the
    // observer against a `restore()`/newer `start()` landing during its
    // own initial await — but that check never covered THIS function's own
    // write-back, and this is also called from `drainPending()` for every
    // later mutation-driven batch, which had no such guard at all. A
    // `restore()` landing while ANY in-flight batch was still awaiting its
    // network round trip used to write straight through anyway: tooltips/
    // placeholders/alt text got (re-)translated onto a page the UI already
    // reports as restored, AND `noteOriginal` below re-populated `originals`
    // with the TRANSLATED value as if it were the real original — corrupting
    // the next restore's baseline too. `titleTranslator.ts` already has the
    // equivalent of this guard (`if (!active) return;` after its own
    // await); this ports the same discipline here.
    const myGeneration = generation;
    const outcomes = await options.translator.translateBatch({
      sourceLanguage: options.getSourceLanguage(),
      sourceLanguageIsExplicit: options.isSourceLanguageExplicit?.() ?? false,
      targetLanguage: currentTargetLanguage,
      pieces: targets.map((t) => [t.element.getAttribute(t.attribute) ?? '']),
      dontSortResults: false,
    });
    if (myGeneration !== generation) return;
    targets.forEach((target, index) => {
      const outcome = outcomes[index];
      if (!outcome?.ok) return;
      const translated = outcome.value[0];
      if (!translated) return;
      // The element may have been removed, or the attribute changed again,
      // while this request was in flight.
      const current = target.element.getAttribute(target.attribute);
      if (current === null || !target.element.isConnected) return;
      noteOriginal(target.element, target.attribute, current);
      noteWritten(target.element, target.attribute, translated);
      target.element.setAttribute(target.attribute, translated);
    });
  }

  function startWatching(): void {
    observer = new MutationObserver((mutations) => {
      const newTargets: AttributeTarget[] = [];
      const changedElements = new Set<Element>();

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const el = mutation.target as Element;
          changedElements.add(el);
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            // Round-6 audit fix (two real gaps, both closed here):
            //
            // 1. No ancestor check. `collectAttributeTargets(node)` already
            // checks `isNoTranslateNode` on every node IT visits while
            // walking DOWN from `node` — but `node` itself can be inserted
            // arbitrarily deep inside a `translate="no"`/`.notranslate`/
            // skip-tag subtree that already existed above it; nothing
            // downward-only can see that. Exactly the bug
            // `mutationWatcher.ts` was fixed for (the text-node path) —
            // this subsystem shipped later and never got the same fix.
            //
            // 2. No own-write guard. The sibling `attributes` branch below
            // compares against `lastWritten` before re-queueing; this
            // branch pushed every target unconditionally. A recycled
            // virtualized-list row that detaches and re-attaches carries
            // its OWN already-translated attribute values back in as
            // "new" — re-sending them as a fresh translate request (and,
            // since translated-to-same-language echoes, burning a repair
            // retry on top).
            if (hasNoTranslateAncestor(node, isNoTranslateNode)) return;
            for (const target of collectAttributeTargets(node)) {
              const written = lastWritten.get(target.element)?.get(target.attribute);
              const current = target.element.getAttribute(target.attribute);
              if (written === current) continue; // our own write
              newTargets.push(target);
            }
          });
        }
      }

      for (const el of changedElements) {
        if (isNoTranslateNode(el)) continue;
        // Re-derive what's currently translatable on JUST this element
        // (reuses collectAttributeTargets's own hard-exclude/blank/type
        // rules instead of duplicating them) — the mutation observer
        // reports WHICH attribute changed, but not whether it's still one
        // this feature cares about (e.g. a non-button input's `value`).
        for (const target of collectAttributeTargets(el)) {
          const written = lastWritten.get(target.element)?.get(target.attribute);
          const current = target.element.getAttribute(target.attribute);
          if (written === current) continue; // our own write
          newTargets.push(target);
        }
      }

      scheduleTranslate(newTargets);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });
  }

  function scheduleTranslate(newTargets: AttributeTarget[]): void {
    if (newTargets.length === 0) return;
    pendingTargets.push(...newTargets);
    if (translateInFlight) return; // already draining — this batch is picked up by that drain's own trailing check
    void drainPending();
  }

  async function drainPending(): Promise<void> {
    if (pendingTargets.length === 0) return;
    translateInFlight = true;
    const batch = pendingTargets;
    pendingTargets = [];
    try {
      await translateTargets(batch);
    } finally {
      translateInFlight = false;
      // More mutations arrived while this batch was in flight — drain
      // those too instead of leaving them stranded until the next
      // unrelated mutation happens to call scheduleTranslate again.
      if (pendingTargets.length > 0) void drainPending();
    }
  }

  function stopWatching(): void {
    observer?.disconnect();
    observer?.takeRecords();
    observer = null;
  }

  /**
   * Bounds `originals`' growth — see `pruneDisconnectedAttributeEntries`'s
   * doc comment. Called from `translateLoop.ts`'s existing `onResweep`,
   * right alongside its own `pruneDisconnectedRestoreEntries` call.
   */
  function pruneDisconnected(): void {
    pruneDisconnectedAttributeEntries(originals, disconnectedLastTick);
  }

  async function start(targetLanguage: string): Promise<void> {
    const myGeneration = ++generation;
    currentTargetLanguage = targetLanguage;
    const targets = collectAttributeTargets(document.body);
    await translateTargets(targets);
    // A restore() (or a newer start(), e.g. a fast re-translate) landed
    // while the above await was in flight — installing the observer now
    // would keep shipping attribute text to the provider after the user
    // already asked for the original page back.
    if (myGeneration !== generation) return;
    startWatching();
  }

  function restore(): void {
    generation++;
    stopWatching();
    pendingTargets = [];
    originals.forEach((perEl, el) => {
      if (!el.isConnected) return;
      perEl.forEach((original, attribute) => {
        el.setAttribute(attribute, original);
      });
    });
    originals.clear();
    lastWritten = new WeakMap();
  }

  return { start, restore, pruneDisconnected };
}

export type AttributeTranslator = ReturnType<typeof createAttributeTranslator>;
