import type { Translator } from '../translator';
import { type AttributeTarget, collectAttributeTargets, isNoTranslateNode } from './collectTextNodes';

/**
 * Attribute translation (round-3 audit follow-up, deferred from beta.35's
 * accuracy round for its own design pass): `placeholder`, `alt`, `value`
 * (button/submit/reset only), and `title` — see
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
}

const WATCHED_ATTRIBUTES: AttributeTarget['attribute'][] = ['placeholder', 'alt', 'value', 'title'];

export function createAttributeTranslator(options: AttributeTranslatorOptions) {
  /** Original values, for `restore()`. Element -> attribute -> pre-translation value. */
  const originals = new Map<Element, Map<string, string>>();
  /**
   * The last value THIS module wrote for a given element/attribute — the
   * mutation-observer loop guard. Without this, translating "Search" ->
   * "Buscar" and writing it back would itself fire an 'attributes'
   * mutation, which would be mistaken for the page changing the attribute
   * and re-queued for translation forever.
   */
  const lastWritten = new Map<Element, Map<string, string>>();

  let currentTargetLanguage = '';
  let observer: MutationObserver | null = null;

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
    const outcomes = await options.translator.translateBatch({
      sourceLanguage: options.getSourceLanguage(),
      targetLanguage: currentTargetLanguage,
      pieces: targets.map((t) => [t.element.getAttribute(t.attribute) ?? '']),
      dontSortResults: false,
    });
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
            newTargets.push(...collectAttributeTargets(node));
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

      if (newTargets.length > 0) void translateTargets(newTargets);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });
  }

  function stopWatching(): void {
    observer?.disconnect();
    observer?.takeRecords();
    observer = null;
  }

  async function start(targetLanguage: string): Promise<void> {
    currentTargetLanguage = targetLanguage;
    const targets = collectAttributeTargets(document.body);
    await translateTargets(targets);
    startWatching();
  }

  function restore(): void {
    stopWatching();
    originals.forEach((perEl, el) => {
      if (!el.isConnected) return;
      perEl.forEach((original, attribute) => {
        el.setAttribute(attribute, original);
      });
    });
    originals.clear();
    lastWritten.clear();
  }

  return { start, restore };
}

export type AttributeTranslator = ReturnType<typeof createAttributeTranslator>;
