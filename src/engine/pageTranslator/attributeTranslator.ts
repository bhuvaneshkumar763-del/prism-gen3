import { hasLetter } from '../../shared/text';
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
 * CONSECUTIVE resweep ticks, so a recycled list row that detaches and
 * reattaches within one tick keeps its restore value. Same rule as
 * `translateLoop.ts`'s `pruneDisconnectedRestoreEntries`.
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
 * Attribute translation (`placeholder`, `alt`, button `value`, `title`,
 * `aria-label`; see `collectAttributeTargets`). Separate from translateLoop.ts
 * because that machinery is built around `Text` node identity.
 *
 * One batch for the initial page, then a MutationObserver for changes. No
 * retry: an untranslated tooltip is minor, and the resweep only covers `Text`.
 */

export interface AttributeTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** True when the user picked the source language by hand; see `TranslateBatchRequest.sourceLanguageIsExplicit`. */
  isSourceLanguageExplicit?(): boolean;
}

// Derived, never hand-listed, so the observer filter can't drift from the collector.
const WATCHED_ATTRIBUTES: AttributeTarget['attribute'][] = [...TRANSLATABLE_ATTRIBUTES];

export function createAttributeTranslator(options: AttributeTranslatorOptions) {
  /**
   * Element -> attribute -> pre-translation value, for `restore()`, kept only
   * while the attribute holds our write. A `Map` because restore must
   * enumerate it; `pruneDisconnected` bounds its growth.
   */
  const originals = new Map<Element, Map<string, string>>();
  const disconnectedLastTick = new WeakSet<Element>();
  /**
   * Last value this module wrote per element/attribute: the observer's loop
   * guard, so our own write isn't re-queued forever. A `WeakMap` since it's
   * never enumerated; `restore()` reassigns it because WeakMap has no clear().
   */
  let lastWritten = new WeakMap<Element, Map<string, string>>();

  let currentTargetLanguage = '';
  let observer: MutationObserver | null = null;
  // Bumped by start()/restore(); async work that resumes under a stale
  // generation must not write back or install the observer.
  let generation = 0;
  // One translate in flight at a time; mutations arriving meanwhile coalesce
  // here, so an infinite-scroll feed can't fire a request per mutation batch.
  let pendingTargets: AttributeTarget[] = [];
  let translateInFlight = false;

  function noteOriginal(el: Element, attribute: string, value: string): void {
    let perEl = originals.get(el);
    if (!perEl) {
      perEl = new Map();
      originals.set(el, perEl);
    }
    perEl.set(attribute, value);
  }

  function isOwnWrite(el: Element, attribute: string): boolean {
    return lastWritten.get(el)?.get(attribute) === el.getAttribute(attribute);
  }

  /**
   * The page replaced our write with its own value, so that value is what
   * restore() must leave in place, even if re-translating it fails.
   */
  function forgetOriginalIfPageChanged(el: Element, attribute: string): void {
    if (isOwnWrite(el, attribute)) return;
    originals.get(el)?.delete(attribute);
  }

  function noteWritten(el: Element, attribute: string, value: string): void {
    let perEl = lastWritten.get(el);
    if (!perEl) {
      perEl = new Map();
      lastWritten.set(el, perEl);
    }
    perEl.set(attribute, value);
  }

  /** Never rejects: callers `void` it, and start() must still install the observer. */
  async function translateTargets(targets: AttributeTarget[]): Promise<void> {
    if (targets.length === 0) return;
    // A restore() during the await must win: writing back would re-translate
    // a restored page and record translated text in `originals`.
    const myGeneration = generation;
    const sentValues = targets.map((t) => t.element.getAttribute(t.attribute) ?? '');
    let outcomes: Awaited<ReturnType<Translator['translateBatch']>>;
    try {
      outcomes = await options.translator.translateBatch({
        sourceLanguage: options.getSourceLanguage(),
        sourceLanguageIsExplicit: options.isSourceLanguageExplicit?.() ?? false,
        targetLanguage: currentTargetLanguage,
        pieces: sentValues.map((value) => [value]),
      });
    } catch (e) {
      console.error('[prism] attribute translation request failed', e);
      return;
    }
    if (myGeneration !== generation) return;
    const changedInFlight: AttributeTarget[] = [];
    targets.forEach((target, index) => {
      const { element, attribute } = target;
      if (!element.isConnected) return;
      const current = element.getAttribute(attribute);
      if (current === null) return;
      // The page changed it while in flight: translate its new value instead.
      if (current !== sentValues[index]) {
        if (!isOwnWrite(element, attribute) && hasLetter(current)) changedInFlight.push(target);
        return;
      }
      const outcome = outcomes[index];
      if (!outcome?.ok) return;
      const translated = outcome.value[0];
      if (!translated) return;
      noteOriginal(element, attribute, current);
      noteWritten(element, attribute, translated);
      element.setAttribute(attribute, translated);
    });
    scheduleTranslate(changedInFlight);
  }

  function startWatching(): void {
    observer = new MutationObserver((mutations) => {
      const newTargets: AttributeTarget[] = [];
      const changedElements = new Set<Element>();

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const el = mutation.target as Element;
          if (mutation.attributeName) forgetOriginalIfPageChanged(el, mutation.attributeName);
          changedElements.add(el);
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            // The collector only checks downward, so check ancestors too: the
            // node may land inside an existing no-translate subtree. The
            // own-write check stops a recycled row re-sending its translations.
            if (hasNoTranslateAncestor(node, isNoTranslateNode)) return;
            for (const target of collectAttributeTargets(node)) {
              if (isOwnWrite(target.element, target.attribute)) continue;
              // Changed while detached (a recycled row), with no attribute record.
              forgetOriginalIfPageChanged(target.element, target.attribute);
              newTargets.push(target);
            }
          });
        }
      }

      for (const el of changedElements) {
        // Same rule as the initial walk: an element's own attributes count even
        // on a skip tag (a textarea placeholder), but nothing below a skip node does.
        if (hasNoTranslateAncestor(el, isNoTranslateNode)) continue;
        // Re-collect so the collector's rules decide whether the changed
        // attribute is still translatable (e.g. a non-button input's `value`).
        for (const target of collectAttributeTargets(el)) {
          if (isOwnWrite(target.element, target.attribute)) continue;
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
    if (translateInFlight) return; // the running drain picks this up
    void drainPending();
  }

  async function drainPending(): Promise<void> {
    if (pendingTargets.length === 0) return;
    translateInFlight = true;
    const batch = uniqueTargets(pendingTargets);
    pendingTargets = [];
    try {
      await translateTargets(batch);
    } finally {
      translateInFlight = false;
      // Drain what arrived meanwhile rather than wait for the next mutation.
      if (pendingTargets.length > 0) void drainPending();
    }
  }

  // An in-flight change can be queued twice: by the observer and by the write-back's requeue.
  function uniqueTargets(targets: AttributeTarget[]): AttributeTarget[] {
    const seen = new Map<Element, Set<string>>();
    return targets.filter(({ element, attribute }) => {
      let attrs = seen.get(element);
      if (!attrs) {
        attrs = new Set();
        seen.set(element, attrs);
      }
      if (attrs.has(attribute)) return false;
      attrs.add(attribute);
      return true;
    });
  }

  function stopWatching(): void {
    observer?.disconnect();
    observer?.takeRecords();
    observer = null;
  }

  /** Bounds `originals`' growth; called from translateLoop.ts's `onResweep`. */
  function pruneDisconnected(): void {
    pruneDisconnectedAttributeEntries(originals, disconnectedLastTick);
  }

  async function start(targetLanguage: string): Promise<void> {
    const myGeneration = ++generation;
    currentTargetLanguage = targetLanguage;
    const targets = collectAttributeTargets(document.body);
    await translateTargets(targets);
    // A restore() or newer start() landed during the await.
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
