import { connectivity } from '../connectivity';
import type { BatchingHint } from '../providers/descriptors';
import type { Translator } from '../translator';
import { createAttributeTranslator } from './attributeTranslator';
import { restoreBoundaryText } from './boundaryText';
import { collectTextNodes, isNoTranslateNode } from './collectTextNodes';
import { createDedupeTracker } from './dedupe';
import {
  groupNodesForBatching,
  isWordElementText,
  nearestBlockAncestor,
  type PieceSlot,
  slotsForGroup,
} from './grouping';
import { createMutationWatcher } from './mutationWatcher';
import { createResweepScheduler } from './resweep';
import { createTitleTranslator } from './titleTranslator';
import { prioritizeByViewport } from './viewportPriority';

/**
 * The page-translation engine: collect text nodes, batch-translate them via an
 * injected `Translator`, splice results back, and keep watching for new or
 * changed content. Engine-pure (no extension APIs). Attributes and the tab
 * title aren't `Text` nodes, so attributeTranslator.ts and titleTranslator.ts
 * handle them.
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
const HAS_LETTER = /\p{L}/u;
/** See `originalWhitespace` in `runTranslationTick` for why this is punctuation-aware. */
const LEADING_NON_LETTER_OR_DIGIT = /^[^\p{L}\p{N}]+/u;

/**
 * Drops a `nodesToRestore` entry once its node has been disconnected for two
 * CONSECUTIVE resweep ticks: recycled list widgets detach and reattach the
 * same node within one tick, and pruning it then would make it unrestorable.
 */
export function pruneDisconnectedRestoreEntries(
  nodesToRestore: Map<Text, string>,
  disconnectedLastTick: WeakSet<Text>,
): void {
  for (const node of nodesToRestore.keys()) {
    if (!node.isConnected) {
      if (disconnectedLastTick.has(node)) {
        nodesToRestore.delete(node);
      } else {
        disconnectedLastTick.add(node);
      }
    } else {
      disconnectedLastTick.delete(node);
    }
  }
}

export type PageLanguageState = 'original' | 'translated';

/** `'offline'` when the browser itself has no connectivity (distinct from `'provider'`, a confirmed-broken/misconfigured provider while online) — see `setError`. */
export type ErrorKind = 'offline' | 'provider' | null;

export interface PageTranslatorOptions {
  translator: Translator;
  getSourceLanguage(): string;
  /** Looked up per translate cycle to decide chunking — see descriptors.ts's `batchingHint`. */
  getBatchingHint(): BatchingHint | undefined;
  getDontSortResults?(): boolean;
  /** See `NoTranslateOptions.translatePreTags`. Omitted means `<pre>` is skipped. */
  getTranslatePreTags?(): boolean;
}

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
  // Keyed by node so onResweep can prune nodes the page removed; otherwise a
  // long-lived SPA would keep every detached Text node it translated.
  let nodesToRestore = new Map<Text, string>();
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
  let translationRoutineHandle: ReturnType<typeof setTimeout> | null = null;

  /** The last content this engine processed for a tracked node; see `queueOrRequeueIfChanged`. */
  const lastSeenText = new WeakMap<Text, string>();
  /** Nodes onResweep saw disconnected on the previous tick; see `pruneDisconnectedRestoreEntries`. */
  const disconnectedLastTick = new WeakSet<Text>();
  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();
  /** One pending cooldown-retry timer per node in `noteMissingResult`. */
  const cooldownRetryScheduled = new WeakSet<Text>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();
  const errorListeners = new Set<(message: string | null, kind: ErrorKind) => void>();
  const workingListeners = new Set<(working: boolean) => void>();
  const progressListeners = new Set<(done: number, total: number) => void>();

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

  function setWorking(next: boolean): void {
    if (next === working) return;
    working = next;
    workingListeners.forEach((cb) => {
      cb(next);
    });
  }

  /**
   * Real "N of M" progress: `totalPieces` is set once per cycle and
   * `completedPieces` only counts up. `completedNodes` keeps it once per node,
   * since a node is written twice per tick (`onPieceComplete` and the final loop).
   */
  let totalPieces = 0;
  let completedPieces = 0;
  let completedNodes = new WeakSet<Text>();
  /** Coalesces a resolved batch's burst of completions into one notification per microtask drain. */
  let progressNotifyScheduled = false;

  function notifyProgress(): void {
    if (progressNotifyScheduled) return;
    progressNotifyScheduled = true;
    queueMicrotask(() => {
      progressNotifyScheduled = false;
      const total = totalPieces;
      const done = completedPieces;
      progressListeners.forEach((cb) => {
        cb(done, total);
      });
    });
  }

  function recordPieceCompleted(node: Text): void {
    if (completedNodes.has(node)) return;
    completedNodes.add(node);
    completedPieces++;
    notifyProgress();
  }

  function resetProgress(): void {
    totalPieces = 0;
    completedPieces = 0;
    completedNodes = new WeakSet<Text>();
    givenUpNodes = new Set<Text>();
    translatedChars = 0;
    notifyProgress();
  }

  /**
   * Working = work queued or in flight and no real error surfaced. After an error
   * surfaces, nodes keep retrying in the background, so the spinner yields to the
   * error panel; the untranslated-share warning doesn't count as an error here.
   */
  function recomputeWorking(): void {
    setWorking(
      (queue.length > 0 || inFlightGeneration !== null) && (lastErrorMessage === null || errorIsUntranslatedWarning),
    );
  }

  // A failing provider must surface an error, not retry forever in silence while
  // the page reports 'translated'; a few consecutive failures are tolerated first.
  const CONSECUTIVE_FAILURES_BEFORE_SURFACING = 3;
  let consecutiveBatchFailures = 0;
  let lastErrorMessage: string | null = null;
  let lastErrorKind: ErrorKind = null;
  // Consecutive ticks with an error surfaced; drives the backoff at the tick's
  // tail. Separate from consecutiveBatchFailures (failed batches), and keeps
  // growing while offline, since the provider hasn't recovered just by that.
  let surfacedErrorStreak = 0;

  /**
   * Pieces given up on (echoed back or left out 3 times) are normally a few
   * endonyms; when they are a large share of the page by characters (a degraded
   * Google echoes most of it), warn. A report, not an outage: no backoff,
   * `working` unaffected, and any real error outranks it.
   */
  const UNTRANSLATED_SHARE_TO_WARN = 0.25;
  const MIN_UNTRANSLATED_CHARS_TO_WARN = 200;
  let givenUpNodes = new Set<Text>();
  let translatedChars = 0;
  let errorIsUntranslatedWarning = false;

  function untranslatedWarning(): string | null {
    let untranslatedChars = 0;
    for (const node of givenUpNodes) {
      if (node.isConnected) untranslatedChars += node.data.trim().length;
      else givenUpNodes.delete(node);
    }
    const share = untranslatedChars / (untranslatedChars + translatedChars);
    if (untranslatedChars < MIN_UNTRANSLATED_CHARS_TO_WARN || share < UNTRANSLATED_SHARE_TO_WARN) return null;
    return `About ${Math.round(share * 100)}% of this page came back untranslated. Try again; if it keeps happening, switch provider in Settings.`;
  }

  function refreshUntranslatedWarning(): void {
    if (lastErrorMessage !== null && !errorIsUntranslatedWarning) return;
    const message = untranslatedWarning();
    setError(message, message ? 'provider' : null, message !== null);
  }

  function setError(
    message: string | null,
    kind: ErrorKind = message ? 'provider' : null,
    isUntranslatedWarning = false,
  ): void {
    errorIsUntranslatedWarning = isUntranslatedWarning;
    if (message === lastErrorMessage && kind === lastErrorKind) return;
    lastErrorMessage = message;
    lastErrorKind = kind;
    errorListeners.forEach((cb) => {
      cb(message, kind);
    });
    recomputeWorking();
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
    queuedSet.add(node);
    // Nodes found after the initial sweep need their original recorded too, or
    // restorePage() leaves them translated.
    nodesToRestore.set(node, node.data);
    viewportDirty = true;
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
    nodesToRestore.set(node, node.data);
    viewportDirty = true;
    // A node changing repeatedly before it's spliced out must not be queued twice
    // (a wasted request and two racing write-backs).
    if (!queuedSet.has(node)) {
      queue.push(node);
      queuedSet.add(node);
    }
    recomputeWorking();
    wakeRoutine();
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
   * Inside the 1500ms cooldown it schedules a later retry instead of dropping the
   * node, which resweep couldn't rescue (`lastSeenText` already matches).
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
    if (last !== undefined && Date.now() - last < 1500) {
      if (!cooldownRetryScheduled.has(node)) {
        cooldownRetryScheduled.add(node);
        // Generation-checked so the retry can't fire into a restored or newer cycle.
        const scheduledGeneration = cycleGeneration;
        setTimeout(
          () => {
            cooldownRetryScheduled.delete(node);
            if (scheduledGeneration !== cycleGeneration) return;
            noteMissingResult(node);
          },
          1500 - (Date.now() - last),
        );
      }
      return;
    }
    const attempts = (missingResultAttempts.get(node) ?? 0) + 1;
    if (attempts > 3) {
      // Give up after 3 tries — usually a genuinely untranslatable fragment.
      givenUpNodes.add(node);
      refreshUntranslatedWarning();
      return;
    }
    missingResultAttempts.set(node, attempts);
    requeueChangedTextNode(node);
  }

  /**
   * Prevents re-entrant ticks: `wakeRoutine()` can't stop a tick that's mid-await,
   * and two concurrent ticks double the request rate. Keyed by generation so a
   * new cycle's tick may run while an abandoned cycle's batch still resolves.
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
      if (!scheduledSuccessor && pageLanguageState === 'translated' && queue.length > 0) {
        translationRoutineHandle = setTimeout(translationRoutine, 0);
      }
    }
  }

  /** Resolves `true` if it scheduled the next tick itself, `false` if it bailed out early — see `translationRoutine`'s `finally`. */
  async function runTranslationTick(): Promise<boolean> {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);

    // Offline: every request would fail, so send nothing and report at once (no
    // failure threshold). The queue stays put; connectivity.onChange() wakes us.
    if (pageLanguageState === 'translated' && queue.length > 0 && !connectivity.isOnline()) {
      setError('Offline — translation will resume automatically once your connection is back.', 'offline');
      surfacedErrorStreak++;
      translationRoutineHandle = setTimeout(translationRoutine, 2000);
      return true;
    }

    if (pageLanguageState === 'translated' && queue.length > 0) {
      // Translate what the user is looking at first. Worth it even when the queue
      // fits in one tick: the provider dispatches groups FIFO, so earlier pieces
      // resolve first. Throttled only for large queues (LARGE_QUEUE_REORDER_THROTTLE_MS).
      const isLargeQueue = queue.length > MAX_PIECES_PER_TICK;
      const reorderThrottled = isLargeQueue && Date.now() - lastReorderTime < LARGE_QUEUE_REORDER_THROTTLE_MS;
      if (queue.length > 1 && viewportDirty && !reorderThrottled) {
        queue = prioritizeByViewport(queue, { top: 0, bottom: window.innerHeight });
        viewportDirty = false;
        lastReorderTime = Date.now();
      }
      const batch = queue.splice(0, MAX_PIECES_PER_TICK);
      const batchingHint = options.getBatchingHint();
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
      const groups = groupNodesForBatching(batch, batchingHint);
      // What is actually sent per group: one string per node, except a
      // word-per-element run, which goes as one string (see grouping.ts's
      // `slotsForGroup`). `outcome.value[i]` below indexes these slots.
      const slotGroups = groups.map(slotsForGroup);
      const requestedUnderGeneration = cycleGeneration;
      inFlightGeneration = requestedUnderGeneration;
      recomputeWorking();
      // Google drops trailing whitespace and sometimes a leading run of punctuation
      // (". The program…" loses its period), so each slot's boundary text is captured
      // here and restored at write-back. Digits are excluded so "3D …" stays intact.
      const originalWhitespace = new Map<Text, { leading: string; trailing: string }>();
      /**
       * The exact text sent per node. Write-back requeues instead of writing when a
       * node's `.data` changed in flight, so a live update isn't clobbered by a
       * stale translation.
       */
      const sentText = new Map<Text, string>();
      slotGroups.forEach((slots) => {
        slots.forEach((slot) => {
          // A run's boundary text is its whole sent string's, kept on the
          // node the translation is written into.
          const text = slot.text;
          const leading = text.match(LEADING_NON_LETTER_OR_DIGIT)?.[0] ?? '';
          const trailing = text.slice(text.trimEnd().length);
          // biome-ignore lint/style/noNonNullAssertion: a slot always has a node
          if (leading || trailing) originalWhitespace.set(slot.nodes[0]!, { leading, trailing });
          for (const node of slot.nodes) sentText.set(node, node.data);
        });
      });

      /**
       * Restores the node's boundary text and writes the translation. Called from
       * `onPieceComplete` and again by the final loop; the repeat assigns an
       * identical string, which is harmless.
       */
      function writeTranslatedNode(node: Text, rawTranslated: string): void {
        // Changed by the page while in flight: translate the current content instead.
        if (sentText.get(node) !== node.data) {
          requeueChangedTextNode(node);
          return;
        }
        // Counted here, not for a requeued stale node.
        if (!completedNodes.has(node)) translatedChars += node.data.trim().length;
        recordPieceCompleted(node);
        givenUpNodes.delete(node);
        const original = originalWhitespace.get(node);
        // See `restoreBoundaryText` for how the source's leading mark is
        // carried without doubling and the translation's own marks are kept.
        const translated = original ? restoreBoundaryText(original, rawTranslated) : rawTranslated;
        mutationWatcher.noteOwnWrite(node, translated);
        node.data = translated;
        lastSeenText.set(node, translated);
        // So this tick's second write pass doesn't mistake our own write for a page change.
        sentText.set(node, translated);
        missingResultAttempts.delete(node);
      }

      /**
       * Writes one slot. A word run's translation goes into its first node and the
       * rest of the run (words and punctuation) is emptied, recorded in
       * `nodesToRestore`; if the page changed any of it in flight, it's requeued.
       */
      function writeSlot(slot: PieceSlot, rawTranslated: string): void {
        const [head, ...tail] = slot.nodes;
        if (!head) return;
        if (tail.length === 0 && slot.separators.length === 0) {
          writeTranslatedNode(head, rawTranslated);
          return;
        }
        if (slot.nodes.some((n) => !n.isConnected || sentText.get(n) !== n.data)) {
          for (const node of slot.nodes) if (node.isConnected) requeueChangedTextNode(node);
          return;
        }
        writeTranslatedNode(head, rawTranslated);
        if (head.data !== sentText.get(head)) return;
        // The run's translation stands for every word in it, not just the head.
        for (const node of tail) if (!completedNodes.has(node)) translatedChars += node.data.trim().length;
        for (const node of [...tail, ...slot.separators]) {
          if (!node.isConnected || node.data === '') continue;
          if (!nodesToRestore.has(node)) nodesToRestore.set(node, node.data);
          mutationWatcher.noteOwnWrite(node, '');
          node.data = '';
          lastSeenText.set(node, '');
          sentText.set(node, '');
        }
        for (const node of tail) {
          recordPieceCompleted(node);
          missingResultAttempts.delete(node);
        }
      }

      try {
        const outcomes = await options.translator.translateBatch({
          sourceLanguage: sourceLanguageOverride ?? options.getSourceLanguage(),
          // Lets the provider prefer its own per-piece detection over a
          // page-level GUESS (see google.ts), while still honouring a
          // source the user picked by hand in the bubble.
          sourceLanguageIsExplicit: sourceLanguageOverride !== null,
          targetLanguage: currentTargetLanguage,
          pieces: slotGroups.map((slots) => slots.map((slot) => slot.text)),
          dontSortResults: options.getDontSortResults?.() ?? false,
          // Writes each piece as soon as its own sub-request completes instead of
          // waiting for the slowest. Only early writes of successes; everything else is
          // handled by the loop after this await.
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

        // A broken provider usually doesn't throw: translateBatch resolves with an
        // `ok: false` outcome per piece, so "every outcome failed" is the signal. The
        // catch below covers only genuine exceptions (e.g. messaging breaking).
        const failedOutcomes = outcomes.filter((o) => !o?.ok);
        const allFailed = outcomes.length > 0 && failedOutcomes.length === outcomes.length;
        // An all-'suspicious' batch got real 200s (e.g. endonyms Google won't
        // translate), so it isn't an outage: it goes through noteMissingResult's
        // bounded retry instead of the retry-forever branch.
        const allFailedAreSuspicious =
          allFailed && failedOutcomes.every((o) => o && !o.ok && o.error.kind === 'suspicious');
        if (allFailed && !allFailedAreSuspicious) {
          consecutiveBatchFailures++;
          if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
            const firstFailure = outcomes.find((o) => !o?.ok);
            const message = firstFailure && !firstFailure.ok ? firstFailure.error.message : 'translation failed';
            setError(toUserFacingErrorMessage(message));
            surfacedErrorStreak++;
          }
          // Requeue the whole batch, bypassing noteMissingResult's per-node cooldown and
          // cap (meant for one missing piece), so it's retried until the error surfaces
          // or the provider recovers. Disconnected nodes forget lastSeenText (see below).
          batch.forEach((n) => {
            if (!n.isConnected) lastSeenText.delete(n);
          });
          {
            const requeued = batch.filter((n) => n.isConnected);
            for (const node of requeued) queuedSet.add(node);
            queue.unshift(...requeued);
          }
        } else {
          // A degraded provider yields MIXED batches, so only a tick with no genuine
          // (non-'suspicious') failure resets the counters and clears the error;
          // otherwise a partial outage would never surface.
          const hasGenuineFailure = failedOutcomes.some((o) => o && !o.ok && o.error.kind !== 'suspicious');
          if (!hasGenuineFailure) {
            consecutiveBatchFailures = 0;
            surfacedErrorStreak = 0;
            if (!errorIsUntranslatedWarning) setError(null);
            refreshUntranslatedWarning();
          } else {
            consecutiveBatchFailures++;
            if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
              const firstGenuineFailure = outcomes.find((o) => o && !o.ok && o.error.kind !== 'suspicious');
              const message =
                firstGenuineFailure && !firstGenuineFailure.ok
                  ? firstGenuineFailure.error.message
                  : 'translation failed';
              setError(toUserFacingErrorMessage(message));
              surfacedErrorStreak++;
            }
          }
          slotGroups.forEach((slots, groupIdx) => {
            const outcome = outcomes[groupIdx];
            slots.forEach((slot, slotIdx) => {
              for (const node of slot.nodes) {
                if (node.isConnected) continue;
                // Left the DOM while in flight: forget lastSeenText so the node requeues
                // if it reappears with the same untranslated text.
                lastSeenText.delete(node);
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
      } catch (e) {
        // Same abandoned-cycle check as the success path — don't requeue an
        // old cycle's nodes into a queue that now belongs to a new one.
        if (requestedUnderGeneration !== cycleGeneration) return false;
        console.error('[prism] translation batch failed', e);
        // Transient failure (network blip, background restart) — retry
        // next tick. Same `lastSeenText` cleanup for disconnected nodes as
        // the `allFailed` branch above, and for the same reason.
        batch.forEach((n) => {
          if (!n.isConnected) lastSeenText.delete(n);
        });
        {
          const requeued = batch.filter((n) => n.isConnected);
          for (const node of requeued) queuedSet.add(node);
          queue.unshift(...requeued);
        }
        consecutiveBatchFailures++;
        if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
          setError(toUserFacingErrorMessage(e instanceof Error ? e.message : String(e)));
          surfacedErrorStreak++;
        }
      } finally {
        // Only the cycle that set this may clear it — see
        // `inFlightGeneration`'s declaration comment.
        if (inFlightGeneration === requestedUnderGeneration) inFlightGeneration = null;
        recomputeWorking();
      }
    }

    // With an error surfaced, back off: 8s, 12s, 18s, ... capped at 30s.
    let nextDelay: number;
    if (lastErrorMessage !== null && !errorIsUntranslatedWarning) {
      nextDelay = Math.min(30000, 8000 * 1.5 ** (surfacedErrorStreak - 1));
    } else if (consecutiveBatchFailures > 0) {
      // Space out pre-surfacing retries so a short blip can clear: rapid retries of
      // one stuck batch aren't independent signals of a broken provider.
      nextDelay = Math.min(4000, 1000 * 2 ** (consecutiveBatchFailures - 1));
    } else {
      // 0ms (still yields) while work remains; provider concurrency is capped
      // elsewhere. Requiring 'translated' stops a stray queue entry busy-spinning.
      nextDelay = pageLanguageState === 'translated' && queue.length > 0 ? 0 : 2000;
    }
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
    return true;
  }

  /**
   * Maps raw provider errors to plain language. Unrecognized messages pass
   * through unchanged, since they're still useful diagnostics.
   */
  function toUserFacingErrorMessage(raw: string): string {
    if (/kept sending text back untranslated/i.test(raw)) {
      return 'The translation service keeps sending text back untranslated. Prism keeps retrying; if it keeps happening, switch provider in Settings.';
    }
    if (/no result for this piece/i.test(raw)) {
      return "Couldn't reach the translation service — retrying automatically.";
    }
    // A rejection (bad API key, refused request) won't change on retry, so
    // don't say "retrying".
    const rejected = /rejected \(HTTP (\d+)\)(?::\s*(.+))?$/.exec(raw);
    if (rejected) {
      return rejected[2]
        ? `The translation service rejected the request: ${rejected[2]}`
        : `The translation service rejected the request (HTTP ${rejected[1]}).`;
    }
    return raw;
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
      // Bound nodesToRestore's growth; see pruneDisconnectedRestoreEntries.
      pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick);
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
  // (up to 30s); the offline error clears itself on the next tick.
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

    // The From picker's forced source sticks for this page load (later translates
    // reuse it); only an explicit argument changes it.
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
    queuedSet = new WeakSet<Text>(nodes);
    // `queue` was filled directly, not via queueNode(), so mark it dirty here.
    viewportDirty = true;

    // The real total, known up front from the synchronous collect above.
    totalPieces = nodes.length;
    completedPieces = 0;
    completedNodes = new WeakSet<Text>();
    givenUpNodes = new Set<Text>();
    translatedChars = 0;
    notifyProgress();

    consecutiveBatchFailures = 0;
    setError(null); // also recomputes `working` — queue is already populated above.
    setState('translated');
    mutationWatcher.enable();
    resweep.start();
    wakeRoutine();
    void titleTranslator.start(targetLanguage);
    void attributeTranslator.start(targetLanguage);
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
    queuedSet = new WeakSet<Text>();
    resetProgress();
    cycleGeneration++;
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = null;
    mutationWatcher.disable();
    resweep.stop();
    titleTranslator.restore();
    attributeTranslator.restore();
    consecutiveBatchFailures = 0;
    // A fresh translate after a restore starts its error backoff at 8s again.
    surfacedErrorStreak = 0;
    setError(null);
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
     * Translated text nodes and their pre-translation text. Allocates per node,
     * so the hover tooltip uses `findOriginalTextForElement` instead.
     */
    getTranslatedNodes: (): ReadonlyArray<{ node: Text; original: string }> =>
      Array.from(nodesToRestore, ([node, original]) => ({ node, original })),
    /**
     * Original text of a translated node directly under `target`, or null. Walks
     * `nodesToRestore` without allocating, since the hover tooltip calls it on
     * every mouseover/mousemove.
     */
    findOriginalTextForElement: (target: Element): string | null => {
      for (const [node, original] of nodesToRestore) {
        if (node.parentElement === target && node.data !== original) return original;
      }
      return null;
    },
    /** Non-null once failures reach `CONSECUTIVE_FAILURES_BEFORE_SURFACING` (at once when offline), or for the untranslated-share warning. */
    getLastError: (): string | null => lastErrorMessage,
    /** `'offline'` vs `'provider'` vs `null` — see the `ErrorKind` doc comment. */
    getLastErrorKind: (): ErrorKind => lastErrorKind,
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
     * `(done, total)` for the current cycle. `done` may settle short of `total`
     * (given-up or removed nodes), so hide progress UI when `working` goes false.
     */
    onProgressChange(cb: (done: number, total: number) => void): () => void {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
