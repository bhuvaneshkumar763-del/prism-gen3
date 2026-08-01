import type { BatchingHint } from '../providers/descriptors';
import type { Translator } from '../translator';
import { collectTextNodes, isNoTranslateNode } from './collectTextNodes';
import { createDedupeTracker } from './dedupe';
import { groupNodesForBatching } from './grouping';
import { createMutationWatcher } from './mutationWatcher';
import { createResweepScheduler } from './resweep';
import { createTitleTranslator } from './titleTranslator';

/**
 * The page-translation engine: collect text nodes, batch-translate them via
 * an injected `Translator` port, splice results back in, and keep watching
 * for new/changed content. Ties together dedupe.ts (O(1) identity
 * tracking), mutationWatcher.ts (childList + characterData observation),
 * resweep.ts (the adaptive backstop), grouping.ts (the chunking logic —
 * see its header comment for why this matters for translation quality),
 * and titleTranslator.ts (the tab-bar title, which lives in `<head>` and
 * is otherwise never reached by this module's body-only text-node walk).
 *
 * 100% engine-pure: `translator` is injected as the same `Translator`
 * interface every provider implements (see `src/engine/translator.ts`) —
 * this module never touches `browser.runtime.sendMessage` or any other
 * extension API directly. In this extension, `src/platform/remoteTranslator.ts`
 * supplies a `Translator` that messages the background script; a future
 * non-extension surface could supply one that calls a translation API
 * directly, and this entire engine would work unmodified — the
 * cross-surface-reuse goal from the Gen 3 plan, made concrete.
 *
 * Scope note: this port does not yet translate element attributes
 * (placeholder/title/alt/aria-label) or apply a custom dictionary — every
 * text node still gets found and translated correctly, this is a quality/
 * coverage gap, not a correctness one, and a documented later-session item.
 */

const MAX_PIECES_PER_TICK = 100;
const HAS_LETTER = /\p{L}/u;

export type PageLanguageState = 'original' | 'translated';

export interface PageTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** Looked up per translate cycle to decide chunking — see descriptors.ts's `batchingHint`. */
  getBatchingHint(): BatchingHint | undefined;
  getDontSortResults?(): boolean;
}

export function createPageTranslator(options: PageTranslatorOptions) {
  const dedupe = createDedupeTracker();

  let pageLanguageState: PageLanguageState = 'original';
  let queue: Text[] = [];
  let nodesToRestore: Array<{ node: Text; original: string }> = [];
  let currentTargetLanguage = '';
  let translationRoutineHandle: ReturnType<typeof setTimeout> | null = null;

  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();

  function wakeRoutine(delayMs = 0): void {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = setTimeout(translationRoutine, delayMs);
  }

  function queueNode(node: Text): boolean {
    if (dedupe.isTracked(node)) return false;
    dedupe.track([node]);
    queue.push(node);
    // Nodes discovered after the initial translatePage() sweep (new DOM from
    // the mutation watcher/resweep) need their pre-translation text recorded
    // too, or restorePage() silently leaves them translated forever — the
    // initial batch records this in bulk in translatePage() itself, this
    // covers everything found afterwards.
    nodesToRestore.push({ node, original: node.data });
    return true;
  }

  function requeueChangedTextNode(node: Text): void {
    requeueAt.set(node, Date.now());
    dedupe.track([node]);
    queue.push(node);
    wakeRoutine();
  }

  function noteMissingResult(node: Text): void {
    if (!node.isConnected) return;
    const text = (node.textContent ?? '').trim();
    if (!text || !HAS_LETTER.test(text)) return;
    const last = requeueAt.get(node);
    if (last !== undefined && Date.now() - last < 1500) return;
    const attempts = (missingResultAttempts.get(node) ?? 0) + 1;
    if (attempts > 3) return; // give up after 3 tries — a genuinely untranslatable fragment
    missingResultAttempts.set(node, attempts);
    requeueChangedTextNode(node);
  }

  async function translationRoutine(): Promise<void> {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);

    if (pageLanguageState === 'translated' && queue.length > 0) {
      const batch = queue.splice(0, MAX_PIECES_PER_TICK);
      const groups = groupNodesForBatching(batch, options.getBatchingHint());
      try {
        const outcomes = await options.translator.translateBatch({
          sourceLanguage: options.getSourceLanguage(),
          targetLanguage: currentTargetLanguage,
          pieces: groups.map((group) => group.map((node) => node.data)),
          dontSortResults: options.getDontSortResults?.() ?? false,
        });
        groups.forEach((group, groupIdx) => {
          const outcome = outcomes[groupIdx];
          group.forEach((node, nodeIdx) => {
            if (!node.isConnected) return;
            const translated = outcome?.ok ? outcome.value[nodeIdx] : undefined;
            if (translated) {
              mutationWatcher.noteOwnWrite(node, translated);
              node.data = translated;
            } else {
              noteMissingResult(node);
            }
          });
        });
      } catch (e) {
        console.error('[prism] translation batch failed', e);
        // Transient failure (network blip, background restart) — retry next tick.
        queue.unshift(...batch.filter((n) => n.isConnected));
      }
    }

    const nextDelay = queue.length > 0 ? 150 : 2000;
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
  }

  const mutationWatcher = createMutationWatcher({
    isTranslated: () => pageLanguageState === 'translated',
    isNoTranslateNode,
    onNewRoot(root) {
      const added = collectTextNodes(root).filter((n) => queueNode(n)).length;
      if (added > 0) wakeRoutine();
    },
    onChangedTextNode(node) {
      requeueChangedTextNode(node);
    },
  });

  const titleTranslator = createTitleTranslator({
    translator: options.translator,
    getSourceLanguage: options.getSourceLanguage,
    isPageVisible: () => document.visibilityState === 'visible',
  });

  const resweep = createResweepScheduler({
    isTranslated: () => pageLanguageState === 'translated',
    isPageVisible: () => document.visibilityState === 'visible',
    onResweep() {
      const added = collectTextNodes(document.body).filter((n) => queueNode(n)).length;
      if (added > 0) wakeRoutine();
      return added > 0;
    },
    onHrefChange() {
      // SPA navigation / chapter switch — re-check the title the same way a
      // site directly rewriting document.title would trigger, reusing this
      // scheduler's existing href-watching instead of building a second one.
      if (pageLanguageState === 'translated') titleTranslator.catchUp();
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pageLanguageState === 'translated') {
      mutationWatcher.enable(500, () => resweep.bump());
      resweep.bump();
      titleTranslator.catchUp();
    } else if (document.visibilityState !== 'visible') {
      mutationWatcher.disable();
    }
  });

  function setState(next: PageLanguageState): void {
    pageLanguageState = next;
    stateListeners.forEach((cb) => {
      cb(next);
    });
  }

  async function translatePage(targetLanguage: string): Promise<void> {
    // Always restore first, so re-translating (new target language, new
    // service, new source language) while already translated collects the
    // true original text instead of mistaking the current translation for it.
    if (pageLanguageState === 'translated') {
      restorePage();
    }

    currentTargetLanguage = targetLanguage;

    const nodes = collectTextNodes(document.body);
    nodesToRestore = nodes.map((node) => ({ node, original: node.data }));
    dedupe.reset();
    dedupe.track(nodes);
    queue = [...nodes];

    setState('translated');
    mutationWatcher.enable(500, () => resweep.bump());
    resweep.start();
    wakeRoutine();
    void titleTranslator.start(targetLanguage);
  }

  function restorePage(): void {
    nodesToRestore.forEach(({ node, original }) => {
      if (node.isConnected && node.data !== original) {
        mutationWatcher.noteOwnWrite(node, original);
        node.data = original;
      }
    });
    nodesToRestore = [];
    queue = [];
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = null;
    mutationWatcher.disable();
    resweep.stop();
    titleTranslator.restore();
    setState('original');
  }

  return {
    translatePage,
    restorePage,
    getState: () => pageLanguageState,
    onStateChange(cb: (state: PageLanguageState) => void): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    /** Currently-translated text nodes and their pre-translation text — used by a future "hover to see original" tooltip. */
    getTranslatedNodes: (): ReadonlyArray<{ node: Text; original: string }> => nodesToRestore,
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
