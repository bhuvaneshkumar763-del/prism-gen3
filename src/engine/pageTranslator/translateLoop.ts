import { connectivity } from '../connectivity';
import type { BatchingHint } from '../providers/descriptors';
import type { Translator } from '../translator';
import { collectTextNodes, isNoTranslateNode } from './collectTextNodes';
import { createDedupeTracker } from './dedupe';
import { groupNodesForBatching } from './grouping';
import { createMutationWatcher } from './mutationWatcher';
import { createResweepScheduler } from './resweep';
import { createTitleTranslator } from './titleTranslator';
import { prioritizeByViewport } from './viewportPriority';

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

/** `'offline'` when the browser itself has no connectivity (distinct from `'provider'`, a confirmed-broken/misconfigured provider while online) — see `setError`. */
export type ErrorKind = 'offline' | 'provider' | null;

export interface PageTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** Looked up per translate cycle to decide chunking — see descriptors.ts's `batchingHint`. */
  getBatchingHint(): BatchingHint | undefined;
  getDontSortResults?(): boolean;
  /** See `collectTextNodes.ts`'s `translatePreTags` doc comment. Omit to keep the default (skip `<pre>`, matching every prior release's behavior). */
  getTranslatePreTags?(): boolean;
}

export function createPageTranslator(options: PageTranslatorOptions) {
  const dedupe = createDedupeTracker();

  let pageLanguageState: PageLanguageState = 'original';
  let queue: Text[] = [];
  /**
   * `null` = use `options.getSourceLanguage()` (always `'auto'` in this
   * extension's real wiring, see `entrypoints/content.ts`) for every
   * translate request. Set by `translatePage()`'s optional second
   * argument, the bubble From picker's one-off forced retranslate — real
   * bug this replaced: a manually-picked language used to persist into
   * `sourceLanguageByHost` and get sent as the source language on *every*
   * future request forever, fighting Google's own per-request auto-detect
   * and mistranslating already-correct content (confirmed against the
   * live endpoint: "History" sent with a forced source came back
   * "Association"; the identical text sent as `auto` came back
   * unchanged). Read once per tick in `translationRoutine`, not just once
   * per `translatePage()` call, since a single page translation spans many
   * ticks.
   */
  let sourceLanguageOverride: string | null = null;
  // Keyed by node so a resweep tick can prune entries for nodes the page
  // itself has since removed — without this, a node discovered while
  // translated (queueNode, below) never leaves this map until
  // restorePage(), so a long-lived SPA that keeps adding/removing content
  // (infinite scroll, chat) leaks a strong reference to every detached Text
  // node it ever translated for the life of the tab.
  let nodesToRestore = new Map<Text, string>();
  let currentTargetLanguage = '';
  /**
   * Set whenever the viewport-priority ordering could have gone stale — a
   * scroll (via resweep.ts's `onViewportChanged`) or a newly-queued node —
   * and cleared right after a reorder actually runs. Without this,
   * `prioritizeByViewport` re-measured EVERY queued node's position on
   * EVERY tick regardless of whether anything had actually changed since
   * the last reorder — real cost on a long page (thousands of forced
   * `getBoundingClientRect()` layout reads per tick, repeated every ~150ms).
   */
  let viewportDirty = true;
  /**
   * Bumped by every translatePage()/restorePage(). A `translateBatch()` call
   * already awaiting when the cycle ends cannot be cancelled, so its results
   * are checked against the generation they were requested under before
   * being spliced in — otherwise a slow response from an abandoned cycle
   * (e.g. French, then the user switches to German) overwrites the newer
   * translation while state still reports the newer language.
   */
  let cycleGeneration = 0;
  let translationRoutineHandle: ReturnType<typeof setTimeout> | null = null;

  /** The last content this engine actually processed for a tracked node — see `queueOrRequeueIfChanged`'s doc comment for why this exists alongside `dedupe`. */
  const lastSeenText = new WeakMap<Text, string>();
  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();
  const errorListeners = new Set<(message: string | null, kind: ErrorKind) => void>();

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
  let lastErrorKind: ErrorKind = null;
  // Grows the surfaced-error backoff the longer a real outage lasts (Phase
  // 2 of the graceful-degradation pass) — counts consecutive ticks where an
  // error stayed surfaced, reset the moment it clears. Kept separate from
  // consecutiveBatchFailures, which counts failed *batches* (can advance
  // faster than once per tick's worth of backoff) and is reset on offline
  // ticks (see the offline branch in translationRoutine below) — this
  // counter should keep growing through an offline stretch too, since the
  // provider hasn't actually recovered just because connectivity dropped.
  let surfacedErrorStreak = 0;

  function setError(message: string | null, kind: ErrorKind = message ? 'provider' : null): void {
    if (message === lastErrorMessage && kind === lastErrorKind) return;
    lastErrorMessage = message;
    lastErrorKind = kind;
    errorListeners.forEach((cb) => {
      cb(message, kind);
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
    nodesToRestore.set(node, node.data);
    viewportDirty = true;
    return true;
  }

  function requeueChangedTextNode(node: Text): void {
    requeueAt.set(node, Date.now());
    dedupe.track([node]);
    lastSeenText.set(node, node.data);
    // The node's content genuinely changed since we last saw it, so THIS is
    // now its pre-translation text. Without this, nodesToRestore kept the
    // text captured the first time the node was ever queued, and
    // restorePage() would roll a live-updating node (a score, an edited
    // comment) back to stale content — silently discarding whatever the
    // page had legitimately changed it to. Same stale value fed
    // getTranslatedNodes(), so the hover-original tooltip lied too.
    nodesToRestore.set(node, node.data);
    viewportDirty = true;
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

    // Offline: don't even attempt a batch — every provider request is
    // guaranteed to fail the same way, so there's nothing to gain by
    // sending it (batchedHttpProvider.ts's own retry loop has the matching
    // check for the same reason). Distinct from "provider broken" — this
    // bypasses the CONSECUTIVE_FAILURES_BEFORE_SURFACING threshold and
    // reports immediately, since offline is a directly-known cause, not a
    // pattern that needs 3 failures to infer. Queued work is left exactly
    // where it is; connectivity.onChange() below wakes this routine the
    // instant the connection returns.
    if (pageLanguageState === 'translated' && queue.length > 0 && !connectivity.isOnline()) {
      setError('Offline — translation will resume automatically once your connection is back.', 'offline');
      surfacedErrorStreak++;
      translationRoutineHandle = setTimeout(translationRoutine, 2000);
      return;
    }

    if (pageLanguageState === 'translated' && queue.length > 0) {
      // Perceived-speed win, Phase 4a of the graceful-degradation pass:
      // translate what the user is actually looking at first. Only
      // bothers reordering (and paying for getBoundingClientRect() calls,
      // a real reflow cost) when the queue is bigger than what fits in one
      // tick — a page that fits in one batch already translates
      // everything this tick regardless of order. This only changes which
      // nodes land in `batch` below; grouping still runs on whatever comes
      // out, unmodified.
      if (queue.length > MAX_PIECES_PER_TICK && viewportDirty) {
        queue = prioritizeByViewport(queue, { top: 0, bottom: window.innerHeight });
        viewportDirty = false;
      }
      const batch = queue.splice(0, MAX_PIECES_PER_TICK);
      const groups = groupNodesForBatching(batch, options.getBatchingHint());
      const requestedUnderGeneration = cycleGeneration;
      try {
        const outcomes = await options.translator.translateBatch({
          sourceLanguage: sourceLanguageOverride ?? options.getSourceLanguage(),
          targetLanguage: currentTargetLanguage,
          pieces: groups.map((group) => group.map((node) => node.data)),
          dontSortResults: options.getDontSortResults?.() ?? false,
        });

        // The page was restored or re-translated while this request was in
        // flight — these results belong to an abandoned cycle. Dropping them
        // is correct: whatever replaced this cycle has its own queue and
        // will translate the current content itself.
        if (requestedUnderGeneration !== cycleGeneration) return;

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
            surfacedErrorStreak++;
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
          surfacedErrorStreak = 0;
          setError(null);
          groups.forEach((group, groupIdx) => {
            const outcome = outcomes[groupIdx];
            group.forEach((node, nodeIdx) => {
              if (!node.isConnected) {
                // The node left the DOM while its translation was in flight
                // (routine in virtualized/recycled lists). Forget the text we
                // last saw for it, so that if it reappears with that same
                // still-untranslated content, queueOrRequeueIfChanged sees a
                // mismatch and queues it again. Without this, dedupe still
                // considers it tracked and lastSeenText still matches, so it
                // would sit untranslated forever with no error.
                lastSeenText.delete(node);
                return;
              }
              const translated = outcome?.ok ? outcome.value[nodeIdx] : undefined;
              if (translated) {
                mutationWatcher.noteOwnWrite(node, translated);
                node.data = translated;
                lastSeenText.set(node, translated);
                // A prior missing-result episode for this node is over —
                // don't let it count against the lifetime give-up cap in
                // noteMissingResult below.
                missingResultAttempts.delete(node);
              } else {
                noteMissingResult(node);
              }
            });
          });
        }
      } catch (e) {
        // Same abandoned-cycle check as the success path — don't requeue an
        // old cycle's nodes into a queue that now belongs to a new one.
        if (requestedUnderGeneration !== cycleGeneration) return;
        console.error('[prism] translation batch failed', e);
        // Transient failure (network blip, background restart) — retry next tick.
        queue.unshift(...batch.filter((n) => n.isConnected));
        consecutiveBatchFailures++;
        if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
          setError(e instanceof Error ? e.message : String(e));
          surfacedErrorStreak++;
        }
      }
    }

    // Once an error has been surfaced, back off instead of hammering a
    // provider that's already confirmed broken (rate-limited/misconfigured)
    // every 8s forever — still retries (a transient outage should recover
    // on its own once fixed), just increasingly less aggressively the
    // longer it stays broken: 8s, 12s, 18s, ... capped at 30s. A short
    // outage still recovers within one 8s cycle; a long one stops
    // hammering a confirmed-broken provider indefinitely at a fixed rate.
    let nextDelay: number;
    if (lastErrorMessage !== null) {
      nextDelay = Math.min(30000, 8000 * 1.5 ** (surfacedErrorStreak - 1));
    } else {
      nextDelay = queue.length > 0 ? 150 : 2000;
    }
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
  }

  /** Read fresh each call, not cached — the options.getTranslatePreTags() source (config) can change live via the settings page. */
  function noTranslateOptions() {
    return { translatePreTags: options.getTranslatePreTags?.() ?? false };
  }

  const mutationWatcher = createMutationWatcher({
    isTranslated: () => pageLanguageState === 'translated',
    isNoTranslateNode: (node) => isNoTranslateNode(node, noTranslateOptions()),
    onNewRoot(root) {
      const added = collectTextNodes(root, noTranslateOptions()).filter((n) => queueOrRequeueIfChanged(n)).length;
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
      // Bound nodesToRestore's growth: drop entries for nodes the page has
      // since removed from the DOM, so a long-lived SPA session doesn't
      // hold onto every detached Text node it ever translated — see the
      // field's declaration comment above.
      for (const node of nodesToRestore.keys()) {
        if (!node.isConnected) nodesToRestore.delete(node);
      }
      const added = collectTextNodes(document.body, noTranslateOptions()).filter((n) =>
        queueOrRequeueIfChanged(n),
      ).length;
      if (added > 0) wakeRoutine();
      return added > 0;
    },
    onViewportChanged() {
      // The user scrolled — whatever prioritizeByViewport last computed no
      // longer necessarily reflects what's on screen now. Reuses resweep's
      // own already-debounced scroll listener rather than registering a
      // second one.
      viewportDirty = true;
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

  // Resume the instant connectivity returns, rather than waiting for
  // whatever backoff delay is currently scheduled (up to 30s once an error
  // has been surfaced for a while — see the nextDelay calc above). The
  // offline error clears itself on the very next tick once isOnline() is
  // true again (the offline branch at the top of translationRoutine simply
  // stops matching), no separate clear-on-reconnect call needed here.
  connectivity.onChange((online) => {
    if (online && pageLanguageState === 'translated') wakeRoutine(0);
  });

  function setState(next: PageLanguageState): void {
    pageLanguageState = next;
    stateListeners.forEach((cb) => {
      cb(next);
    });
  }

  async function translatePage(targetLanguage: string, sourceLanguage?: string): Promise<void> {
    // Always restore first, so re-translating (new target language, new
    // service, new source language) while already translated collects the
    // true original text instead of mistaking the current translation for it.
    if (pageLanguageState === 'translated') {
      restorePage();
    }

    // A one-off forced source language (the bubble's From picker) — only
    // updated when explicitly passed, never reset by an ordinary
    // translate/restore cycle, matching TWP's `improveTranslation`
    // semantics exactly: it sticks for the rest of this page's lifetime
    // (any later translate on this same load keeps using it), but a fresh
    // page load starts a new module instance and goes back to 'auto'. See
    // this file's `sourceLanguageOverride` declaration for the per-tick
    // read side.
    if (sourceLanguage !== undefined) sourceLanguageOverride = sourceLanguage;

    currentTargetLanguage = targetLanguage;
    cycleGeneration++;

    const nodes = collectTextNodes(document.body, noTranslateOptions());
    nodesToRestore = new Map(nodes.map((node) => [node, node.data]));
    dedupe.reset();
    dedupe.track(nodes);
    nodes.forEach((node) => {
      lastSeenText.set(node, node.data);
    });
    queue = [...nodes];
    // A fresh cycle's queue is entirely new — the previous cycle's
    // measurements (if any) don't apply to it. Bypasses queueNode()'s own
    // viewportDirty=true (this populates `queue` directly, not through it).
    viewportDirty = true;

    consecutiveBatchFailures = 0;
    setError(null);
    setState('translated');
    mutationWatcher.enable(500, () => resweep.bump());
    resweep.start();
    wakeRoutine();
    void titleTranslator.start(targetLanguage);
  }

  function restorePage(): void {
    nodesToRestore.forEach((original, node) => {
      if (node.isConnected && node.data !== original) {
        mutationWatcher.noteOwnWrite(node, original);
        node.data = original;
      }
    });
    nodesToRestore = new Map();
    queue = [];
    cycleGeneration++;
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = null;
    mutationWatcher.disable();
    resweep.stop();
    titleTranslator.restore();
    consecutiveBatchFailures = 0;
    // Reset alongside consecutiveBatchFailures: this drives the surfaced-error
    // backoff (8s → 30s), and a fresh translate after a restore is a brand-new
    // attempt. Leaving it set made the next run's very first error start near
    // the 30s cap instead of 8s, contradicting this file's own backoff comment.
    surfacedErrorStreak = 0;
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
    /** Currently-translated text nodes and their pre-translation text — used by the "hover to see original" tooltip (`components/hoverTooltip/mountHoverTooltip.ts`). */
    getTranslatedNodes: (): ReadonlyArray<{ node: Text; original: string }> =>
      Array.from(nodesToRestore, ([node, original]) => ({ node, original })),
    /** Non-null once translation has been failing for `CONSECUTIVE_FAILURES_BEFORE_SURFACING` ticks in a row (or immediately, for `'offline'`) — see the header comment on that constant above. */
    getLastError: (): string | null => lastErrorMessage,
    /** `'offline'` vs `'provider'` vs `null` — see the `ErrorKind` doc comment. */
    getLastErrorKind: (): ErrorKind => lastErrorKind,
    onError(cb: (message: string | null, kind: ErrorKind) => void): () => void {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
