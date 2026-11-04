import { HAS_LETTER } from '../../shared/text';
import { TimeoutError } from '../../shared/withTimeout';
import { connectivity } from '../connectivity';
import type { BatchingHint } from '../providers/descriptors';
import type { PieceOutcome, TranslateError, Translator } from '../translator';
import { createAttributeTranslator } from './attributeTranslator';
import { collectTextNodes, isNoTranslateNode } from './collectTextNodes';
import { createDedupeTracker } from './dedupe';
import {
  backOnline,
  backoffDelay,
  batchFailed,
  batchSucceeded,
  type ErrorKind,
  type ErrorState,
  INITIAL_ERROR_STATE,
  shownError,
  wentOffline,
  withWarning,
} from './errorState';
import {
  groupNodesForBatching,
  isWordElementText,
  nearestBlockAncestor,
  type PieceSlot,
  slotsForGroup,
} from './grouping';
import { createMutationWatcher } from './mutationWatcher';
import { createProgress } from './progress';
import { createResweepScheduler } from './resweep';
import { createTickScheduler } from './scheduler';
import { createTitleTranslator } from './titleTranslator';
import { prioritizeByViewport } from './viewportPriority';
import { createRestoreLedger, createSlotWriter } from './writeBack';

export type { ErrorKind } from './errorState';

/**
 * The page-translation engine: collect text nodes, batch-translate them via an
 * injected `Translator`, splice results back, and keep watching for new or
 * changed content. Engine-pure (no extension APIs). Attributes and the tab
 * title aren't `Text` nodes, so attributeTranslator.ts and titleTranslator.ts
 * handle them. The tick timer is scheduler.ts's, the error state
 * errorState.ts's, done/total progress.ts's and the DOM writes writeBack.ts's.
 */

// Provider concurrency is capped separately (DEFAULT_MAX_CONCURRENT); this keeps
// a tick to a handful of concurrent HTTP batches without many sequential ticks.
const MAX_PIECES_PER_TICK = 300;
/** Upper bound when one oversized block is taken whole into a tick. */
const MAX_NODES_PER_BLOCK_TICK = 5000;
// Past MAX_PIECES_PER_TICK queued nodes, reorder by viewport at most this often:
// on a churning page `viewportDirty` stays set every tick, and each reorder
// forces layout reads across the whole queue.
const LARGE_QUEUE_REORDER_THROTTLE_MS = 500;
/** How often an offline page re-checks connectivity (connectivity.onChange() usually wakes it first). */
const OFFLINE_RECHECK_MS = 2000;
/** The idle poll while nothing is queued. */
const IDLE_TICK_MS = 2000;
/** A missing piece isn't retried sooner than this after its last requeue. */
const MISSING_RESULT_COOLDOWN_MS = 1500;
const MAX_MISSING_RESULT_ATTEMPTS = 3;

export type PageLanguageState = 'original' | 'translated';

export interface PageTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** Looked up per translate cycle to decide chunking — see descriptors.ts's `batchingHint`. */
  getBatchingHint(): BatchingHint | undefined;
  /** See `NoTranslateOptions.translatePreTags`. Omitted means `<pre>` is skipped. */
  getTranslatePreTags?(): boolean;
}

const isGenuineFailure = (o: PieceOutcome | undefined): boolean => !!o && !o.ok && o.error.kind !== 'suspicious';
// An empty slot breaks the one-outcome-per-piece contract: an answer that couldn't be read.
const failureOf = (o: PieceOutcome | undefined): TranslateError =>
  o && !o.ok ? o.error : { kind: 'badResponse', message: 'translation failed: no outcome for this piece' };

export function createPageTranslator(options: PageTranslatorOptions) {
  const dedupe = createDedupeTracker();

  let pageLanguageState: PageLanguageState = 'original';
  let queue: Text[] = [];
  /**
   * O(1) mirror of `queue`'s membership, kept in sync with every push/splice/
   * unshift (characterData mutations check it unthrottled). Reassigned wherever
   * `queue` is reset, since WeakSet has no clear().
   */
  let queuedSet = new WeakSet<Text>();
  /**
   * The bubble From picker's one-off forced source, or `null` for
   * `options.getSourceLanguage()`. Not persisted per host: forcing a source on
   * every request fights Google's per-request auto-detect. Read per tick.
   */
  let sourceLanguageOverride: string | null = null;
  const ledger = createRestoreLedger();
  let currentTargetLanguage = '';
  /**
   * Set when viewport ordering may be stale (a scroll or a newly queued node) and
   * cleared after a reorder, so the queue isn't re-measured every tick.
   */
  let viewportDirty = true;
  /** For `LARGE_QUEUE_REORDER_THROTTLE_MS`; `0` so a cycle's first reorder is never throttled. */
  let lastReorderTime = 0;
  /**
   * Bumped by every translatePage()/restorePage(). An in-flight `translateBatch()`
   * can't be cancelled, so its results are dropped if the generation moved on;
   * otherwise a slow reply for the old language overwrites the new one.
   */
  let cycleGeneration = 0;
  const scheduler = createTickScheduler(() => void translationRoutine());

  /** The last content this engine processed for a tracked node; see `queueOrRequeueIfChanged`. */
  const lastSeenText = new WeakMap<Text, string>();
  /** Per-cycle retry state: reset by translatePage(), so a new language gets fresh retries. */
  let requeueAt = new WeakMap<Text, number>();
  let missingResultAttempts = new WeakMap<Text, number>();
  /** The cycle a node's pending cooldown-retry timer belongs to; one timer per node per cycle. */
  const cooldownRetryScheduled = new WeakMap<Text, number>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();
  const errorListeners = new Set<(message: string | null, kind: ErrorKind) => void>();
  const workingListeners = new Set<(working: boolean) => void>();
  const progressListeners = new Set<(done: number, total: number) => void>();

  const progress = createProgress((done, total) => {
    notifyAll(progressListeners, done, total);
  });
  let errors: ErrorState = INITIAL_ERROR_STATE;

  /**
   * Busy signal for the UI. `pageLanguageState` flips to 'translated' before any
   * request is sent, and it crosses the messaging protocol and gates other
   * behaviour, so it can't double as "done".
   */
  let working = false;
  /**
   * The cycle generation whose batch is in flight, or `null`. A generation, not a
   * boolean, so an abandoned cycle's `finally` can't clear a newer cycle's flag.
   */
  let inFlightGeneration: number | null = null;

  /** A throwing UI listener must not abort the loop mid-batch. */
  function notifyAll<A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A): void {
    listeners.forEach((cb) => {
      try {
        cb(...args);
      } catch (e) {
        console.error('[prism] page translator listener failed', e);
      }
    });
  }

  function setWorking(next: boolean): void {
    if (next === working) return;
    working = next;
    notifyAll(workingListeners, next);
  }

  /**
   * Working = work queued or in flight and no real error surfaced. After an error
   * surfaces, nodes keep retrying in the background, so the spinner yields to the
   * error panel; the untranslated-share warning doesn't count as an error here.
   */
  function recomputeWorking(): void {
    setWorking((queue.length > 0 || inFlightGeneration !== null) && errors.error === null);
  }

  /** Moves to `next`; listeners and `working` are updated only when what the bubble shows changed. */
  function setErrors(next: ErrorState): void {
    const before = shownError(errors);
    errors = next;
    const after = shownError(next);
    if (before?.message === after?.message && before?.kind === after?.kind) return;
    notifyAll(errorListeners, after?.message ?? null, after?.kind ?? null);
    recomputeWorking();
  }

  /** A real error outranks the warning, and clearing it recomputes the warning, so it's only computed when it can show. */
  function refreshUntranslatedWarning(): void {
    if (errors.error !== null) return;
    setErrors(withWarning(errors, progress.untranslatedWarning()));
  }

  function wakeRoutine(): void {
    scheduler.schedule(0);
  }

  function enqueue(node: Text): void {
    progress.track(node);
    viewportDirty = true;
    // A node changing repeatedly before it's spliced out must not be queued twice
    // (a wasted request and two racing write-backs).
    if (queuedSet.has(node)) return;
    queue.push(node);
    queuedSet.add(node);
  }

  function queueNode(node: Text): boolean {
    if (dedupe.isTracked(node)) return false;
    dedupe.track([node]);
    lastSeenText.set(node, node.data);
    // Nodes found after the initial sweep need their original recorded too, or
    // restorePage() leaves them translated.
    ledger.record(node);
    enqueue(node);
    recomputeWorking();
    return true;
  }

  function requeueChangedTextNode(node: Text): void {
    // A stray cooldown-retry timer can land after restorePage(); queueing then
    // leaves a queue nothing drains and the bubble stuck on "Translating…".
    if (pageLanguageState !== 'translated') return;
    requeueAt.set(node, Date.now());
    dedupe.track([node]);
    lastSeenText.set(node, node.data);
    // The content changed, so this is now its pre-translation text (for restore
    // and the hover-original tooltip).
    ledger.record(node);
    enqueue(node);
    recomputeWorking();
    wakeRoutine();
  }

  /**
   * Puts a whole failed batch back at the front, bypassing noteMissingResult's
   * per-node cooldown and cap (meant for one missing piece), so it's retried
   * until the error surfaces or the provider recovers. A node that left the DOM
   * forgets `lastSeenText`, so it's requeued if it reappears unchanged.
   */
  function requeueBatch(batch: readonly Text[]): void {
    const requeued: Text[] = [];
    for (const node of batch) {
      // A node the write-back already requeued (changed in flight) is queued once.
      if (queuedSet.has(node)) continue;
      if (node.isConnected) requeued.push(node);
      else lastSeenText.delete(node);
    }
    for (const node of requeued) queuedSet.add(node);
    queue.unshift(...requeued);
  }

  /**
   * Like `queueNode`, but also requeues a tracked node whose `.data` no longer
   * matches `lastSeenText`: recycled list nodes can change while detached (no
   * mutation record) and reappear, and dedupe alone would skip them forever.
   */
  function queueOrRequeueIfChanged(node: Text): boolean {
    if (!dedupe.isTracked(node)) return queueNode(node);
    if (lastSeenText.get(node) !== node.data) {
      requeueChangedTextNode(node);
      return true;
    }
    return false;
  }

  /**
   * Retries a node whose piece came back missing or suspicious, up to 3 attempts.
   * Inside the cooldown it schedules a later retry instead of dropping the node,
   * which resweep couldn't rescue (`lastSeenText` already matches).
   */
  function noteMissingResult(node: Text): void {
    if (!node.isConnected) {
      // Forget lastSeenText so the node is requeued if it reappears unchanged.
      lastSeenText.delete(node);
      return;
    }
    const text = (node.textContent ?? '').trim();
    if (!text || !HAS_LETTER.test(text)) return;
    const last = requeueAt.get(node);
    if (last !== undefined && Date.now() - last < MISSING_RESULT_COOLDOWN_MS) {
      if (cooldownRetryScheduled.get(node) !== cycleGeneration) {
        // Generation-checked so the retry can't fire into a restored or newer cycle.
        const scheduledGeneration = cycleGeneration;
        cooldownRetryScheduled.set(node, scheduledGeneration);
        setTimeout(
          () => {
            if (cooldownRetryScheduled.get(node) === scheduledGeneration) cooldownRetryScheduled.delete(node);
            if (scheduledGeneration !== cycleGeneration) return;
            noteMissingResult(node);
          },
          MISSING_RESULT_COOLDOWN_MS - (Date.now() - last),
        );
      }
      return;
    }
    const attempts = (missingResultAttempts.get(node) ?? 0) + 1;
    if (attempts > MAX_MISSING_RESULT_ATTEMPTS) {
      // Usually a genuinely untranslatable fragment.
      progress.gaveUp(node);
      refreshUntranslatedWarning();
      return;
    }
    missingResultAttempts.set(node, attempts);
    requeueChangedTextNode(node);
  }

  function recordFailure(error: TranslateError): void {
    setErrors(batchFailed(errors, error));
  }

  /**
   * Prevents re-entrant ticks: a wake can't stop a tick that's mid-await, and
   * two concurrent ticks double the request rate. Keyed by generation so a new
   * cycle's tick may run while an abandoned cycle's batch still resolves.
   */
  let runningForGeneration: number | null = null;

  async function translationRoutine(): Promise<void> {
    // Declining drops this wake; safe only because the `finally` below always
    // leaves a successor scheduled while work remains.
    if (runningForGeneration === cycleGeneration) return;
    const myGeneration = cycleGeneration;
    runningForGeneration = myGeneration;
    let scheduledSuccessor = false;
    try {
      scheduledSuccessor = await runTranslationTick();
    } finally {
      if (runningForGeneration === myGeneration) runningForGeneration = null;
      // runTranslationTick's stale-generation bail-outs return before its tail
      // scheduling; rescheduling here keeps a non-empty queue from stranding.
      if (!scheduledSuccessor && pageLanguageState === 'translated' && queue.length > 0) scheduler.schedule(0);
    }
  }

  /** Resolves `true` if it scheduled the next tick itself, `false` if it bailed out early — see `translationRoutine`'s `finally`. */
  async function runTranslationTick(): Promise<boolean> {
    const hasWork = pageLanguageState === 'translated' && queue.length > 0;
    // Offline: every request would fail, so send nothing and report at once (no
    // failure threshold). The queue stays put; connectivity.onChange() wakes us.
    if (hasWork && !connectivity.isOnline()) {
      setErrors(wentOffline(errors));
      scheduler.backOff(OFFLINE_RECHECK_MS);
      return true;
    }
    // Back online: "Offline" is no longer true, whatever this batch brings.
    if (errors.error?.kind === 'offline') setErrors(backOnline(errors));
    if (hasWork && !(await translateNextBatch())) return false;

    const backoff = backoffDelay(errors);
    if (backoff !== null) {
      scheduler.backOff(backoff);
    } else {
      // 0ms (still yields) while work remains; provider concurrency is capped
      // elsewhere. Requiring 'translated' stops a stray queue entry busy-spinning.
      scheduler.clearBackoff();
      scheduler.schedule(pageLanguageState === 'translated' && queue.length > 0 ? 0 : IDLE_TICK_MS);
    }
    return true;
  }

  /** Splices the next tick's nodes off the front of the queue, what the user is looking at first. */
  function takeBatch(batchingHint: BatchingHint | undefined): Text[] {
    // Worth it even when the queue fits in one tick: the provider dispatches
    // groups FIFO, so earlier pieces resolve first. Throttled only for large
    // queues (LARGE_QUEUE_REORDER_THROTTLE_MS).
    const isLargeQueue = queue.length > MAX_PIECES_PER_TICK;
    const reorderThrottled = isLargeQueue && Date.now() - lastReorderTime < LARGE_QUEUE_REORDER_THROTTLE_MS;
    if (queue.length > 1 && viewportDirty && !reorderThrottled) {
      queue = prioritizeByViewport(queue, { top: 0, bottom: window.innerHeight });
      viewportDirty = false;
      lastReorderTime = Date.now();
    }
    const batch = queue.splice(0, MAX_PIECES_PER_TICK);
    // The slice happens before grouping, so a block straddling the cut would go
    // as two context-free fragments; push its trailing nodes back to group whole.
    if (batchingHint?.groupByBlock && queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length just checked
      const straddledBlock = nearestBlockAncestor(queue[0]!);
      if (straddledBlock !== null) {
        let cut = batch.length;
        // biome-ignore lint/style/noNonNullAssertion: cut is always in bounds
        while (cut > 0 && nearestBlockAncestor(batch[cut - 1]!) === straddledBlock) cut--;
        // `cut > 0` is a starvation guard: a block bigger than MAX_PIECES_PER_TICK
        // would otherwise trim the batch to empty every tick. Such a block is split.
        if (cut > 0 && cut < batch.length) {
          queue.unshift(...batch.splice(cut));
        } else if (cut === 0 && batch[0] && isWordElementText(batch[0])) {
          // The whole batch is one word-per-element chapter bigger than a
          // tick. Take the rest of it too, so grouping splits it at sentence
          // ends instead of at this node count.
          let extra = 0;
          while (
            extra < queue.length &&
            batch.length + extra < MAX_NODES_PER_BLOCK_TICK &&
            // biome-ignore lint/style/noNonNullAssertion: extra is always in bounds
            nearestBlockAncestor(queue[extra]!) === straddledBlock
          ) {
            extra++;
          }
          batch.push(...queue.splice(0, extra));
        }
      }
    }
    for (const node of batch) queuedSet.delete(node);
    return batch;
  }

  const writerDeps = {
    ledger,
    noteOwnWrite(node: Text, text: string): void {
      mutationWatcher.noteOwnWrite(node, text);
      lastSeenText.set(node, text);
    },
    requeue: requeueChangedTextNode,
    onTranslated(node: Text, sourceChars: number): void {
      progress.translated(node, sourceChars);
      missingResultAttempts.delete(node);
    },
  };

  /** Sends one batch and handles its results. Resolves `false` if the cycle moved on meanwhile. */
  async function translateNextBatch(): Promise<boolean> {
    const requestedUnderGeneration = cycleGeneration;
    let batch: Text[] = [];
    /** Nodes already written by `onPieceComplete`, so a failure doesn't re-send their translation. */
    const written = new Set<Text>();
    inFlightGeneration = requestedUnderGeneration;

    // Everything after the splice is inside the `try`: a throw here (a grouping
    // bug) must requeue the batch and back off, not drop it and spin at 0ms.
    try {
      const batchingHint = options.getBatchingHint();
      batch = takeBatch(batchingHint);
      // What is actually sent per group: one string per node, except a
      // word-per-element run, which goes as one string (see grouping.ts's
      // `slotsForGroup`). `outcome.value[i]` below indexes these slots.
      const slotGroups = groupNodesForBatching(batch, batchingHint).map(slotsForGroup);
      recomputeWorking();
      const writeSlot = createSlotWriter(slotGroups, {
        ...writerDeps,
        onTranslated(node: Text, sourceChars: number): void {
          written.add(node);
          writerDeps.onTranslated(node, sourceChars);
        },
      });

      const outcomes = await options.translator.translateBatch({
        sourceLanguage: sourceLanguageOverride ?? options.getSourceLanguage(),
        // Lets the provider prefer its own per-piece detection over a
        // page-level GUESS (see google.ts), while still honouring a
        // source the user picked by hand in the bubble.
        sourceLanguageIsExplicit: sourceLanguageOverride !== null,
        targetLanguage: currentTargetLanguage,
        pieces: slotGroups.map((slots) => slots.map((slot) => slot.text)),
        // Writes each piece as soon as its own sub-request completes instead of
        // waiting for the slowest. Only early writes of successes; everything else is
        // handled after this await.
        onPieceComplete: (groupIdx, outcome) => {
          if (requestedUnderGeneration !== cycleGeneration) return;
          const slots = slotGroups[groupIdx];
          if (!slots || !outcome.ok) return;
          slots.forEach((slot, slotIdx) => {
            if (!slot.nodes[0]?.isConnected) return;
            const raw = outcome.value[slotIdx];
            if (raw) writeSlot(slot, raw);
          });
        },
      });

      // Restored or re-translated meanwhile: these results belong to an abandoned
      // cycle, and the new cycle translates the current content itself.
      if (requestedUnderGeneration !== cycleGeneration) return false;
      handleOutcomes(batch, slotGroups, outcomes, writeSlot);
    } catch (e) {
      // Same abandoned-cycle check as the success path — don't requeue an
      // old cycle's nodes into a queue that now belongs to a new one.
      if (requestedUnderGeneration !== cycleGeneration) return false;
      console.error('[prism] translation batch failed', e);
      // No outcomes at all: the background didn't answer (restart, blip), or
      // not in time. Retry next tick.
      requeueBatch(batch.filter((node) => !written.has(node)));
      const message = e instanceof Error ? e.message : String(e);
      recordFailure({ kind: e instanceof TimeoutError ? 'timeout' : 'network', message });
    } finally {
      // Only the cycle that set this may clear it — see
      // `inFlightGeneration`'s declaration comment.
      if (inFlightGeneration === requestedUnderGeneration) inFlightGeneration = null;
      recomputeWorking();
    }
    return true;
  }

  function handleOutcomes(
    batch: readonly Text[],
    slotGroups: readonly PieceSlot[][],
    outcomes: readonly PieceOutcome[],
    writeSlot: (slot: PieceSlot, rawTranslated: string) => void,
  ): void {
    // A broken provider usually doesn't throw: translateBatch resolves with an
    // `ok: false` outcome per piece, so "every outcome failed" is the signal.
    const failedOutcomes = outcomes.filter((o) => !o?.ok);
    const allFailed = outcomes.length > 0 && failedOutcomes.length === outcomes.length;
    // An all-'suspicious' batch got real 200s (e.g. endonyms Google won't
    // translate), so it isn't an outage: it goes through noteMissingResult's
    // bounded retry below instead of the retry-forever requeue.
    const allFailedAreSuspicious =
      allFailed && failedOutcomes.every((o) => o && !o.ok && o.error.kind === 'suspicious');
    if (allFailed && !allFailedAreSuspicious) {
      recordFailure(failureOf(failedOutcomes[0]));
      requeueBatch(batch);
      return;
    }

    // A degraded provider yields MIXED batches, so only a tick with no genuine
    // (non-'suspicious') failure resets the counters and clears the error;
    // otherwise a partial outage would never surface.
    const firstGenuineFailure = outcomes.find(isGenuineFailure);
    if (firstGenuineFailure) {
      recordFailure(failureOf(firstGenuineFailure));
    } else {
      setErrors(batchSucceeded(progress.untranslatedWarning()));
    }

    slotGroups.forEach((slots, groupIdx) => {
      const outcome = outcomes[groupIdx];
      slots.forEach((slot, slotIdx) => {
        for (const node of slot.nodes) {
          // Left the DOM while in flight: forget lastSeenText so the node requeues
          // if it reappears with the same untranslated text.
          if (!node.isConnected) lastSeenText.delete(node);
        }
        if (!slot.nodes[0]?.isConnected) {
          // A run that lost its first node has nowhere to write; its
          // remaining words go back through as a fresh run.
          for (const node of slot.nodes) if (node.isConnected) requeueChangedTextNode(node);
          return;
        }
        const rawTranslated = outcome?.ok ? outcome.value[slotIdx] : undefined;
        // Usually already written by onPieceComplete; unconditional so this doesn't
        // depend on the translator supporting incremental delivery.
        if (rawTranslated) {
          writeSlot(slot, rawTranslated);
        } else {
          for (const node of slot.nodes) if (node.isConnected) noteMissingResult(node);
        }
      });
    });
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
    // Honour the From picker's override for the title too, as for body text.
    getSourceLanguage: () => sourceLanguageOverride ?? options.getSourceLanguage(),
    isSourceLanguageExplicit: () => sourceLanguageOverride !== null,
    isPageVisible: () => document.visibilityState === 'visible',
  });

  // Attributes aren't Text nodes, so they have their own subsystem; same
  // source-language override as the title.
  const attributeTranslator = createAttributeTranslator({
    translator: options.translator,
    getSourceLanguage: () => sourceLanguageOverride ?? options.getSourceLanguage(),
    isSourceLanguageExplicit: () => sourceLanguageOverride !== null,
  });

  const resweep = createResweepScheduler({
    isTranslated: () => pageLanguageState === 'translated',
    isPageVisible: () => document.visibilityState === 'visible',
    onResweep() {
      ledger.prune();
      // Same for attributeTranslator's `originals`.
      attributeTranslator.pruneDisconnected();
      const added = collectTextNodes(document.body, noTranslateOptions()).filter((n) =>
        queueOrRequeueIfChanged(n),
      ).length;
      if (added > 0) wakeRoutine();
      return added > 0;
    },
    onViewportChanged() {
      // A scroll may have made the last viewport ordering stale.
      viewportDirty = true;
    },
    onHrefChange() {
      // SPA navigation: re-check the title.
      if (pageLanguageState === 'translated') titleTranslator.catchUp();
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pageLanguageState === 'translated') {
      mutationWatcher.enable();
      resweep.bump();
      titleTranslator.catchUp();
    } else if (document.visibilityState !== 'visible') {
      mutationWatcher.disable();
    }
  });

  // Resume as soon as connectivity returns rather than wait out the backoff
  // (up to 30s); the next tick clears the offline error before it sends.
  connectivity.onChange((online) => {
    if (online && pageLanguageState === 'translated') scheduler.wakeNow();
  });

  function setState(next: PageLanguageState): void {
    pageLanguageState = next;
    notifyAll(stateListeners, next);
  }

  async function translatePage(targetLanguage: string, sourceLanguage?: string): Promise<void> {
    // Always restore first, so re-translating (new target language, new
    // service, new source language) while already translated collects the
    // true original text instead of mistaking the current translation for it.
    if (pageLanguageState === 'translated') {
      restorePage();
    }

    // The From picker's forced source sticks for this page load (later translates
    // reuse it); only an explicit argument changes it.
    if (sourceLanguage !== undefined) sourceLanguageOverride = sourceLanguage;

    currentTargetLanguage = targetLanguage;
    cycleGeneration++;
    requeueAt = new WeakMap();
    missingResultAttempts = new WeakMap();

    const nodes = collectTextNodes(document.body, noTranslateOptions());
    ledger.reset(nodes);
    dedupe.reset();
    dedupe.track(nodes);
    nodes.forEach((node) => {
      lastSeenText.set(node, node.data);
    });
    queue = [...nodes];
    queuedSet = new WeakSet<Text>(nodes);
    // `queue` was filled directly, not via queueNode(), so mark it dirty here.
    viewportDirty = true;

    progress.reset();
    for (const node of nodes) progress.track(node);

    // `working` turns true when the first tick sends its batch.
    setErrors(INITIAL_ERROR_STATE);
    setState('translated');
    mutationWatcher.enable();
    resweep.start();
    scheduler.cancel();
    wakeRoutine();
    void titleTranslator.start(targetLanguage);
    void attributeTranslator.start(targetLanguage);
  }

  function restorePage(): void {
    ledger.restoreAll((node, original) => mutationWatcher.noteOwnWrite(node, original));
    queue = [];
    queuedSet = new WeakSet<Text>();
    progress.reset();
    cycleGeneration++;
    scheduler.cancel();
    mutationWatcher.disable();
    resweep.stop();
    titleTranslator.restore();
    attributeTranslator.restore();
    // A fresh translate after a restore starts its error backoff at 8s again.
    setErrors(INITIAL_ERROR_STATE);
    setState('original');
    // Nothing left from this cycle will recompute `working` (queue empty,
    // in-flight results discarded by generation), so clear it now.
    setWorking(false);
  }

  return {
    translatePage,
    restorePage,
    getState: () => pageLanguageState,
    onStateChange(cb: (state: PageLanguageState) => void): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    /**
     * Original text of a translated node directly under `target`, or null. Walks
     * the ledger without allocating, since the hover tooltip calls it on every
     * mouseover/mousemove.
     */
    findOriginalTextForElement: (target: Element): string | null => ledger.findOriginalTextForElement(target),
    /** Non-null once failures reach `CONSECUTIVE_FAILURES_BEFORE_SURFACING` (at once when offline), or for the untranslated-share warning. */
    getLastError: (): string | null => shownError(errors)?.message ?? null,
    /** `'offline'` vs `'provider'` vs `null` — see the `ErrorKind` doc comment. */
    getLastErrorKind: (): ErrorKind => shownError(errors)?.kind ?? null,
    onError(cb: (message: string | null, kind: ErrorKind) => void): () => void {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },
    /** True while work is queued or in flight and no real error has surfaced; see `recomputeWorking`. */
    isWorking: (): boolean => working,
    onWorkingChange(cb: (working: boolean) => void): () => void {
      workingListeners.add(cb);
      return () => workingListeners.delete(cb);
    },
    /**
     * `(done, total)` for the current cycle; `total` grows as the page adds text.
     * `done` may settle short of `total` (given-up or removed nodes), so hide
     * progress UI when `working` goes false.
     */
    onProgressChange(cb: (done: number, total: number) => void): () => void {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
