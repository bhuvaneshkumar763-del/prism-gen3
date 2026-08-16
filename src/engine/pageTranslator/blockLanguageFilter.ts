import { baseLanguageTag } from '../../shared/languages';
import type { LanguageDetector } from '../languageDetector';
import { collectTextNodes } from './collectTextNodes';
import { nearestBlockAncestor } from './grouping';

/**
 * Closes the gap a manual per-site source-language override opens: pinning
 * a site's source language forces it onto every request for that page,
 * including content that's already in the target language (real bug,
 * confirmed against the live Google endpoint — "History" sent with
 * source=vi came back "Association"; the same text with source=auto came
 * back unchanged). This can't be fixed by checking each text node alone —
 * a single button label like "History" is too short for reliable
 * detection — but the *container* it lives in (a filter panel with
 * "Chapters", "Sorting", "Novel type", ...) usually has plenty of text
 * once aggregated. Detect at that level instead.
 */

/** Detection is unreliable below this many characters — `browser.i18n.detectLanguage`'s own guidance is "100 or more" for confidence; this is a deliberately lower floor since a UI section's aggregate text is usually shorter than a paragraph. */
const MIN_CHARS_FOR_DETECTION = 40;

/** How far up the block-ancestor chain to walk hunting for enough aggregate text before giving up on this node. */
const MAX_ANCESTOR_LEVELS = 4;

/** Below this confidence, never skip — the safe default is always "translate anyway," never "silently do nothing." */
const MIN_CONFIDENCE_PERCENTAGE = 60;

interface CacheEntry {
  /** `container.textContent`'s length at the time of the last detection — a cheap staleness signal, not a content hash, so a container whose text changed gets re-detected instead of trusting a stale verdict. */
  textLength: number;
  skip: boolean;
}

/**
 * Starts at `node`'s nearest block ancestor (reusing `grouping.ts`'s exact
 * definition of "block," so this stays consistent with how the rest of the
 * engine chunks content) and, if that block's own aggregate text is too
 * short to detect reliably, keeps walking up plain ancestors — not
 * necessarily block-tagged ones, any container works for aggregating text
 * — until the character floor is met or `MAX_ANCESTOR_LEVELS` is
 * exhausted. Returns `null` if nothing along the way ever reaches it.
 */
function findDetectionContainer(node: Text): Element | null {
  let el: Element | null = nearestBlockAncestor(node) ?? node.parentElement;
  let levels = 0;
  while (el) {
    const length = el.textContent?.trim().length ?? 0;
    if (length >= MIN_CHARS_FOR_DETECTION) return el;
    if (levels >= MAX_ANCESTOR_LEVELS) return null;
    levels++;
    el = el.parentElement;
  }
  return null;
}

export function createBlockLanguageFilter(detector: LanguageDetector) {
  const cache = new WeakMap<Element, CacheEntry>();

  return {
    /**
     * Returns the set of elements confidently already in `targetLanguage`
     * — pass straight to `collectTextNodes`'s `skipElements` option.
     * Never throws; a detector failure just means nothing gets skipped for
     * that container (falls through to "translate it," the safe default).
     */
    async computeSkipElements(root: Node, targetLanguage: string): Promise<Set<Element>> {
      const targetBase = baseLanguageTag(targetLanguage);
      const candidates = collectTextNodes(root, { targetLanguage });

      const containers = new Set<Element>();
      for (const node of candidates) {
        const container = findDetectionContainer(node);
        if (container) containers.add(container);
      }

      const skip = new Set<Element>();
      await Promise.all(
        Array.from(containers).map(async (container) => {
          const text = container.textContent?.trim() ?? '';
          const cached = cache.get(container);
          if (cached && cached.textLength === text.length) {
            if (cached.skip) skip.add(container);
            return;
          }

          const result = await detector.detect(text);
          const matches =
            !!result &&
            result.isReliable &&
            result.percentage >= MIN_CONFIDENCE_PERCENTAGE &&
            baseLanguageTag(result.language) === targetBase;
          cache.set(container, { textLength: text.length, skip: matches });
          if (matches) skip.add(container);
        }),
      );
      return skip;
    },
  };
}

export type BlockLanguageFilter = ReturnType<typeof createBlockLanguageFilter>;
