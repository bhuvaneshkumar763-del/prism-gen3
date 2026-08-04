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

  /** The last content this engine actually processed for a tracked node — see `queueOrRequeueIfChanged`'s doc comment for why this exists alongside `dedupe`. */
  const lastSeenText = new WeakMap<Text, string>();
  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();
  const errorListeners = new Set<(message: string | null) => void>();

  // Silent-failure guard: a translateBatch() call that throws (network
  // error, or every retry inside batchedHttpProvider.ts exhausted — e.g. a
  // provider that's misconfigured or rate-limited) used to be swallowed
  // into console.error and an unconditional requeue-forever loop, with
  // pageLanguageState staying 'translated' the whole time — the UI
  // reported success while nothing on the page ever changed. Real bug,
  // found via a user report: the shipped default provider
  // (libretranslate.com, unauthenticated) returns HTTP 429 for every
  // request. After a few consecutive full-batch failures, this now
  // surfaces a real error instead of retrying forever in silence.
  const CONSECUTIVE_FAILURES_BEFORE_SURFACING = 3;
  let consecutiveBatchFailures = 0;
  let lastErrorMessage: string | null = null;

  function setError(message: string | null): void {
    if (message === lastErrorMessage) return;
    lastErrorMessage = message;
    errorListeners.forEach((cb) => {
      cb(message);
    });
  }

  function wakeRoutine(delayMs = 0): void {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = setTimeout(translationRoutine, delayMs);
  }

  function queueNode(node: Text): boolean {
    if (dedupe.isTracked(node)) return false;
    dedupe.track([node]);
    lastSeenText.set(node, node.data);
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
    lastSeenText.set(node, node.data);
    queue.push(node);
    wakeRoutine();
  }

  /**
   * Used by onNewRoot/onResweep's node collection instead of `queueNode`
   * directly. A node can already be `dedupe.isTracked()` not because it's
   * still live in the queue, but because it was detached, had its `.data`
   * changed WHILE DETACHED (a disconnected node generates no mutation
   * record at all — see mutationWatcher.ts), and has since reappeared via
   * a childList mutation — common in virtualized/recycled list widgets
   * that pool and reuse DOM nodes. `queueNode()` alone would silently skip
   * it forever, since `WeakSet`-based identity tracking survives as long
   * as anything (e.g. the widget's own node pool) holds a live reference.
   * Comparing against `lastSeenText` catches this: if a tracked node's
   * current content no longer matches what this engine last saw for it,
   * treat the reappearance as a real content change, same as an in-place
   * characterData mutation would be.
   */
  function queueOrRequeueIfChanged(node: Text): boolean {
    if (!dedupe.isTracked(node)) return queueNode(node);
    if (lastSeenText.get(node) !== node.data) {
      requeueChangedTextNode(node);
      return true;
    }
    return false;
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

        // The common real-world failure mode (a provider HTTP call that's
        // rate-limited, unauthenticated, or otherwise fails outright) does
        // NOT throw here — createBatchedHttpProvider's translateBatch()
        // deliberately always resolves, converting a failed HTTP request
        // into an `ok: false` outcome per piece (see its own handleBatch()
        // catch block) so one bad request can't crash an entire batch. That
        // means a totally-broken provider looks identical, at this level,
        // to "every piece individually failed" — which used to fall
        // through to noteMissingResult()'s silent per-node give-up with no
        // batch-level signal at all. Detecting "every outcome in this batch
        // failed" here is what actually catches that case — the earlier
        // catch(e) block below only ever fires for a genuine thrown
        // exception (e.g. the messaging round trip itself breaking), which
        // is real but rarer.
        const allFailed = outcomes.length > 0 && outcomes.every((o) => !o?.ok);
        if (allFailed) {
          consecutiveBatchFailures++;
          if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
            const firstFailure = outcomes.find((o) => !o?.ok);
            const message = firstFailure && !firstFailure.ok ? firstFailure.error.message : 'translation failed';
            setError(message);
          }
          // Requeue the whole batch directly, bypassing noteMissingResult()'s
          // per-node cooldown/retry-cap below — that logic exists for an
          // isolated single-node "missing result" (a batch that mostly
          // succeeded but came back short one piece), not for "every request
          // to this provider is failing." Without this, a node that hits the
          // per-node cooldown drops out of `queue` entirely once nothing else
          // is queued behind it, and — since dedupe.ts intentionally skips
          // already-tracked nodes — nothing ever revisits it again: the
          // consecutive-failure counter above would stall forever below the
          // surfacing threshold, and the page would silently never retry at
          // all. Keeping the whole batch in the queue is what lets
          // translateBatch() keep being attempted every tick until this is
          // either confirmed broken (error surfaces) or recovers.
          queue.unshift(...batch.filter((n) => n.isConnected));
        } else {
          consecutiveBatchFailures = 0;
          setError(null);
          groups.forEach((group, groupIdx) => {
            const outcome = outcomes[groupIdx];
            group.forEach((node, nodeIdx) => {
              if (!node.isConnected) return;
              const translated = outcome?.ok ? outcome.value[nodeIdx] : undefined;
              if (translated) {
                mutationWatcher.noteOwnWrite(node, translated);
                node.data = translated;
                lastSeenText.set(node, translated);
              } else {
                noteMissingResult(node);
              }
            });
          });
        }
      } catch (e) {
        console.error('[prism] translation batch failed', e);
        // Transient failure (network blip, background restart) — retry next tick.
        queue.unshift(...batch.filter((n) => n.isConnected));
        consecutiveBatchFailures++;
        if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    // Once an error has been surfaced, back off instead of hammering a
    // provider that's already confirmed broken (rate-limited/misconfigured)
    // every 150ms forever — still retries (a transient outage should
    // recover on its own once fixed), just far less aggressively.
    const nextDelay = lastErrorMessage !== null ? 8000 : queue.length > 0 ? 150 : 2000;
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
  }

  const mutationWatcher = createMutationWatcher({
    isTranslated: () => pageLanguageState === 'translated',
    isNoTranslateNode,
    onNewRoot(root) {
      const added = collectTextNodes(root).filter((n) => queueOrRequeueIfChanged(n)).length;
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
      const added = collectTextNodes(document.body).filter((n) => queueOrRequeueIfChanged(n)).length;
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
    nodes.forEach((node) => {
      lastSeenText.set(node, node.data);
    });
    queue = [...nodes];

    consecutiveBatchFailures = 0;
    setError(null);
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
    consecutiveBatchFailures = 0;
    setError(null);
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
    /** Non-null once translation has been failing for `CONSECUTIVE_FAILURES_BEFORE_SURFACING` ticks in a row — see the header comment on that constant above. */
    getLastError: (): string | null => lastErrorMessage,
    onError(cb: (message: string | null) => void): () => void {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
