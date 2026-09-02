import { connectivity } from '../connectivity';
import type { BatchingHint } from '../providers/descriptors';
import type { Translator } from '../translator';
import { createAttributeTranslator } from './attributeTranslator';
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

// Post-launch speed pass: raised from 100 — real bug, found via a live user
// report: this cap forced a large page into many sequential ticks even
// though provider-side concurrency is capped independently and separately
// (batchedHttpProvider.ts's DEFAULT_MAX_CONCURRENT), so the real limiting
// factor was this number, not actual network/provider capacity. Left well
// under DEFAULT_MAX_CONCURRENT × a request's typical piece count so one
// tick still fits comfortably inside a handful of concurrent HTTP batches
// rather than queueing hundreds of them at once.
const MAX_PIECES_PER_TICK = 300;
const HAS_LETTER = /\p{L}/u;

/**
 * Drops a `nodesToRestore` entry once its node has been disconnected for
 * two CONSECUTIVE resweep ticks, not one — see the call site (onResweep,
 * below) for the real bug this closed. Exported as a standalone, timing-free
 * function so this two-tick debounce is unit-testable directly (map/set
 * manipulation) instead of only through the full resweep-scheduler/
 * MutationObserver timing stack, which is real-clock/interval-driven and
 * not something a test can pin to an exact tick count deterministically.
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
  /**
   * Nodes onResweep saw disconnected on the PREVIOUS tick — see onResweep's
   * comment for why a node needs two consecutive disconnected ticks before
   * its `nodesToRestore` entry is pruned, not one.
   */
  const disconnectedLastTick = new WeakSet<Text>();
  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();
  /**
   * Guards against piling up duplicate cooldown-retry timers for the same
   * node in `noteMissingResult` — see its doc comment for the bug this
   * closes.
   */
  const cooldownRetryScheduled = new WeakSet<Text>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();
  const errorListeners = new Set<(message: string | null, kind: ErrorKind) => void>();
  const workingListeners = new Set<(working: boolean) => void>();

  /**
   * Real bug, found via a live user report: `setState('translated')` in
   * `translatePage()` below fires synchronously before any translate
   * request has even been sent — the UI's busy/spinner round trip
   * (`entrypoints/content.ts`'s old `busy: true` → `await` → `busy: false`)
   * completed in ~zero frames since `translatePage()` never actually awaits
   * real work, just queues nodes and schedules the routine. The bubble
   * turned green instantly with nothing translated yet, and no visible
   * progress indicator during the (sometimes several-second) real work.
   * `working` is a separate signal from `pageLanguageState` on purpose —
   * that type crosses the messaging protocol and gates several other real
   * behaviors (mutationWatcher, restorePage's guard); repurposing it as
   * "done" would be a much bigger, regression-prone change for what's
   * fundamentally a UI-feedback gap.
   */
  let working = false;
  let batchInFlight = false;

  function setWorking(next: boolean): void {
    if (next === working) return;
    working = next;
    workingListeners.forEach((cb) => {
      cb(next);
    });
  }

  /**
   * There's real work outstanding (queued or a batch actively in flight)
   * AND nothing has given up and surfaced an error yet — once an error
   * surfaces, requeued nodes keep retrying in the background forever (see
   * this file's error-surfacing comments), and without the `lastErrorMessage`
   * check here a spinner would run forever alongside the red error panel
   * instead of yielding to it (`FloatingBubble.tsx`'s `errored()` already
   * outranks `translated()` — this just stops `busy` from also staying
   * true once red has taken over).
   */
  function recomputeWorking(): void {
    setWorking((queue.length > 0 || batchInFlight) && lastErrorMessage === null);
  }

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
    // Nodes discovered after the initial translatePage() sweep (new DOM from
    // the mutation watcher/resweep) need their pre-translation text recorded
    // too, or restorePage() silently leaves them translated forever — the
    // initial batch records this in bulk in translatePage() itself, this
    // covers everything found afterwards.
    nodesToRestore.set(node, node.data);
    viewportDirty = true;
    recomputeWorking();
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
    // Speed/correctness fix, found via audit: this used to push
    // unconditionally, with no check for whether `node` was already
    // sitting in `queue` — a node that changes more than once (a live
    // score, a streaming chat message, a counter) before the previous
    // change's entry was ever spliced out by `runTranslationTick`
    // (`mutationWatcher.onChangedTextNode` calls this directly, once per
    // characterData mutation, unthrottled) accumulated a duplicate entry
    // per change. A duplicate entry means the same node can land in the
    // SAME batch/group twice, wasting a translate request and racing two
    // outcomes' write-backs against each other for one node.
    if (!queue.includes(node)) queue.push(node);
    recomputeWorking();
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

  /**
   * Real bug this closed, found via audit and reproduced directly: a node
   * whose piece keeps coming back missing/suspicious while OTHER pieces in
   * the same batch keep succeeding (so `allFailed` below never fires, no
   * error ever surfaces) used to get silently abandoned after only 1-2
   * tries, permanently stuck in its original language with no error and no
   * way back into the queue. The cause: the cooldown check below used to
   * just `return` when a node's last requeue was under 1500ms ago — not
   * only skipping THIS attempt (reasonable, avoids a tight retry loop) but
   * dropping the node out of `queue` and every future consideration too,
   * since it neither re-pushed the node nor incremented its attempt count.
   * Worse, resweep's own backstop can't rescue it either:
   * `queueOrRequeueIfChanged` only re-adds a node when `lastSeenText`
   * doesn't match its current `.data`, but `requeueChangedTextNode` (called
   * on the PRIOR attempt) already set `lastSeenText` to this exact
   * (still-untranslated) text, so a later resweep sees no change and skips
   * it too. Now schedules a real retry once the cooldown window actually
   * elapses instead of dropping it — `cooldownRetryScheduled` prevents
   * piling up duplicate timers if this is called again for the same node
   * before that fires.
   */
  function noteMissingResult(node: Text): void {
    if (!node.isConnected) return;
    const text = (node.textContent ?? '').trim();
    if (!text || !HAS_LETTER.test(text)) return;
    const last = requeueAt.get(node);
    if (last !== undefined && Date.now() - last < 1500) {
      if (!cooldownRetryScheduled.has(node)) {
        cooldownRetryScheduled.add(node);
        setTimeout(
          () => {
            cooldownRetryScheduled.delete(node);
            noteMissingResult(node);
          },
          1500 - (Date.now() - last),
        );
      }
      return;
    }
    const attempts = (missingResultAttempts.get(node) ?? 0) + 1;
    if (attempts > 3) return; // give up after 3 tries — a genuinely untranslatable fragment
    missingResultAttempts.set(node, attempts);
    requeueChangedTextNode(node);
  }

  /**
   * Reliability fix, found via audit: `wakeRoutine()` only cancels a
   * PENDING (not-yet-fired) scheduled call via `clearTimeout` — it can't
   * stop an ALREADY-RUNNING invocation that's mid-`await` (e.g. awaiting a
   * `translateBatch()` HTTP round trip). Without this guard, a wake fired
   * while a tick was still in flight for the SAME cycle (rapid
   * characterData mutations each calling `requeueChangedTextNode`, which
   * calls `wakeRoutine()` every time) scheduled a SECOND, concurrent
   * invocation racing the first: both set `batchInFlight = true`, and
   * whichever's `finally` ran first cleared it — so `isWorking()` could
   * report "done" while a batch was still genuinely in flight — and both
   * independently computed and scheduled their own next tick, doubling the
   * effective polling rate and the resulting HTTP request volume.
   *
   * Deliberately keyed by `cycleGeneration`, not a plain boolean: a plain
   * "only one tick running, ever" lock would have also blocked the
   * INTENTIONAL case this engine already relies on and tests directly — a
   * fresh `translatePage()` call bumps `cycleGeneration` and must be able
   * to start draining its own new queue immediately, even while an old,
   * now-abandoned cycle's batch is still resolving in the background (its
   * response gets safely discarded on arrival via the
   * `requestedUnderGeneration !== cycleGeneration` check inside
   * `runTranslationTick`, not by never having started). Keying on
   * generation blocks only a truly redundant re-entrant tick for the SAME
   * cycle, while still letting a new cycle's tick run concurrently with an
   * old cycle's still-draining one.
   */
  let runningForGeneration: number | null = null;

  async function translationRoutine(): Promise<void> {
    if (runningForGeneration === cycleGeneration) return;
    const myGeneration = cycleGeneration;
    runningForGeneration = myGeneration;
    try {
      await runTranslationTick();
    } finally {
      if (runningForGeneration === myGeneration) runningForGeneration = null;
    }
  }

  async function runTranslationTick(): Promise<void> {
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
      batchInFlight = true;
      recomputeWorking();
      // Real gap this closed, found via a real-page audit (Google strips
      // TRAILING whitespace from a piece's own translated content but
      // generally preserves LEADING whitespace — confirmed directly
      // against the live endpoint: `" start with either "` came back
      // `"comenzar con cualquiera"`, both ends gone; `" or "` came back
      // `" o"`, only the trailing space gone). This is a SEPARATE issue
      // from google.ts's padding-slot reflow fix (which only reconciles
      // the throwaway `<a i=1>` slot) — nothing restored the ORIGINAL
      // node's own whitespace, so adjacent sibling Text nodes (`"Read "`
      // + `"more"`, `<p>Read <b>more</b></p>`) wrote back jammed together
      // ("Leermás") on any real page with inline markup, at high
      // frequency. Deterministic and provider-independent by construction
      // — captured from the same `node.data` used to build `pieces` below,
      // reapplied at write-back regardless of which provider translated it.
      const originalWhitespace = new Map<Text, { leading: string; trailing: string }>();
      /**
       * Real bug this closed, found via audit: write-back only ever
       * checked `node.isConnected`, never that `node.data` was still the
       * text that was actually SENT for translation. A node the page
       * updates in place while its translation is in flight (a live
       * score, a streaming chat message, a countdown) — connected the
       * whole time, so that check alone says nothing changed — used to
       * get silently clobbered with the translation of the STALE text
       * once the response came back, discarding whatever the page had
       * legitimately written in the meantime. Captured here (alongside
       * `originalWhitespace`, from the same `node.data` used to build
       * `pieces` below) and checked in `writeTranslatedNode`.
       */
      const sentText = new Map<Text, string>();
      groups.forEach((group) => {
        group.forEach((node) => {
          const text = node.data;
          const leading = text.slice(0, text.length - text.trimStart().length);
          const trailing = text.slice(text.trimEnd().length);
          if (leading || trailing) originalWhitespace.set(node, { leading, trailing });
          sentText.set(node, text);
        });
      });

      /**
       * Re-wraps with the ORIGINAL node's own leading/trailing whitespace
       * (see `originalWhitespace`'s declaration comment above) and writes
       * it to the DOM — the exact same logic the final write-back loop
       * below always ran, now factored out so `onPieceComplete` (below)
       * can call it the instant a single piece is known, not just once
       * the whole tick's `translateBatch()` promise resolves. Calling this
       * twice for the same already-correct value (once here, once again
       * from the unchanged loop below) is safe and deliberately left
       * that way rather than threading a "don't redo this" flag through
       * both paths: `node.data = translated` assigning an identical
       * string is a no-op the page can't observe, and
       * `mutationWatcher.noteOwnWrite` recording the same text twice
       * doesn't change what its own-write loop guard does.
       */
      function writeTranslatedNode(node: Text, rawTranslated: string): void {
        // See `sentText`'s declaration comment above — a node whose live
        // content no longer matches what was actually sent has been
        // updated by the page while this translation was in flight.
        // Writing the (now stale) translation over it would silently
        // discard that legitimate update; requeue for a fresh translation
        // of the CURRENT content instead, exactly as an in-place
        // characterData mutation observed by mutationWatcher would.
        if (sentText.get(node) !== node.data) {
          requeueChangedTextNode(node);
          return;
        }
        const original = originalWhitespace.get(node);
        const translated = original ? original.leading + rawTranslated.trim() + original.trailing : rawTranslated;
        mutationWatcher.noteOwnWrite(node, translated);
        node.data = translated;
        lastSeenText.set(node, translated);
        // Keeps this in sync with the just-written value — without this,
        // the SAME tick's redundant second write-back pass (see this
        // function's own doc comment: onPieceComplete writes first, the
        // final loop below always runs too) would see `node.data` (now
        // the translated text) no longer match the ORIGINAL `sentText`
        // entry, mistake its own already-applied write for an external
        // page update, and wastefully requeue the node to re-translate
        // its own output.
        sentText.set(node, translated);
        missingResultAttempts.delete(node);
      }

      try {
        const outcomes = await options.translator.translateBatch({
          sourceLanguage: sourceLanguageOverride ?? options.getSourceLanguage(),
          targetLanguage: currentTargetLanguage,
          pieces: groups.map((group) => group.map((node) => node.data)),
          dontSortResults: options.getDontSortResults?.() ?? false,
          // Speed fix, found via audit: without this, a whole tick's
          // translated pieces were withheld from the DOM until the
          // SLOWEST of its (up to MAX_PIECES_PER_TICK-worth of) underlying
          // HTTP sub-requests finished — see translator.ts's
          // `onPieceComplete` doc comment. This writes each piece the
          // instant its OWN sub-request completes, well before this
          // `await` below resolves. Only ever an early, opportunistic
          // write of an already-successful, still-connected node — every
          // other concern (missing pieces, disconnected nodes, retries,
          // error surfacing) stays exclusively in the unchanged loop
          // below, which still runs against the complete `outcomes` array
          // once this await settles.
          onPieceComplete: (groupIdx, outcome) => {
            if (requestedUnderGeneration !== cycleGeneration) return;
            const group = groups[groupIdx];
            if (!group || !outcome.ok) return;
            group.forEach((node, nodeIdx) => {
              if (!node.isConnected) return;
              const raw = outcome.value[nodeIdx];
              if (raw) writeTranslatedNode(node, raw);
            });
          },
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
        const failedOutcomes = outcomes.filter((o) => !o?.ok);
        const allFailed = outcomes.length > 0 && failedOutcomes.length === outcomes.length;
        // Reliability fix, found via audit and reproduced live (Wikipedia's
        // language-switcher endonyms — a language's own name written in its
        // own script, which Google correctly declines to translate): a
        // batch whose failures are ALL `kind: 'suspicious'` is not evidence
        // the provider is down — every request in it got a real 200 OK,
        // the response just kept looking like a silent-echo failure (see
        // translator.ts's `'suspicious'` kind doc comment). Retrying that
        // forever via the branch below produced an unbounded request loop
        // against a provider that was never actually broken and was never
        // going to return anything different. A batch like this instead
        // falls through to the per-node loop, which routes it through
        // noteMissingResult()'s existing bounded (give-up-after-3) retry —
        // exactly the mechanism already used for an isolated missing
        // piece within an otherwise-successful batch. A batch with ANY
        // genuine network/http/parse failure still takes the unconditional
        // retry-forever branch below, since that failure kind IS real
        // evidence of a broken provider.
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
          //
          // Real bug this closed, found via audit: a DISCONNECTED node in
          // this batch was silently dropped here — filtered out of the
          // requeue (correctly; it's not on the page right now) but,
          // unlike the success path's per-node loop just below, never had
          // its `lastSeenText` entry cleared either. A node the page
          // detaches, re-mutates the content of WHILE OFF-DOM (no mutation
          // record fires for a disconnected node), and reattaches with
          // that SAME new content — routine in virtualized/recycled list
          // widgets — would then reappear with `lastSeenText` still
          // matching its ORIGINAL (translated-attempt-failed) text, so
          // `queueOrRequeueIfChanged` sees no change and never requeues
          // it: permanently stuck untranslated, same bug class the
          // success path's own `lastSeenText.delete` below already
          // guards against.
          batch.forEach((n) => {
            if (!n.isConnected) lastSeenText.delete(n);
          });
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
              const rawTranslated = outcome?.ok ? outcome.value[nodeIdx] : undefined;
              // Usually already written by `onPieceComplete` above, well
              // before this loop runs — see `writeTranslatedNode`'s doc
              // comment for why redoing it here is safe. Kept unconditional
              // (not skipped for nodes onPieceComplete already handled) so
              // this loop's behavior doesn't depend on the translator
              // actually supporting incremental delivery.
              if (rawTranslated) {
                writeTranslatedNode(node, rawTranslated);
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
        // Transient failure (network blip, background restart) — retry
        // next tick. Same `lastSeenText` cleanup for disconnected nodes as
        // the `allFailed` branch above, and for the same reason.
        batch.forEach((n) => {
          if (!n.isConnected) lastSeenText.delete(n);
        });
        queue.unshift(...batch.filter((n) => n.isConnected));
        consecutiveBatchFailures++;
        if (consecutiveBatchFailures >= CONSECUTIVE_FAILURES_BEFORE_SURFACING) {
          setError(toUserFacingErrorMessage(e instanceof Error ? e.message : String(e)));
          surfacedErrorStreak++;
        }
      } finally {
        batchInFlight = false;
        recomputeWorking();
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
    } else if (consecutiveBatchFailures > 0) {
      // Real bug, found via a live user report: pre-surfacing failures used
      // to retry at the same fixed pace as ordinary successful draining
      // (previously 150ms), so CONSECUTIVE_FAILURES_BEFORE_SURFACING could
      // be reached in well under a second on a flaky connection — 3 rapid
      // retries of the *same* stuck batch, not 3 independent signals — and
      // surface "Translation failed" even though the rest of a long page
      // had already translated successfully. Space these out so a short
      // blip has a real chance to clear before it counts against the
      // threshold; a genuinely broken provider still reaches it and
      // surfaces, just a couple seconds later than before.
      nextDelay = Math.min(4000, 1000 * 2 ** (consecutiveBatchFailures - 1));
    } else {
      // Post-launch speed pass: removed the unconditional 150ms pause
      // between batches while real work remains queued — real bug, found
      // via a live user report: on a large page this added seconds of pure
      // idle time for no benefit (provider-side concurrency is already
      // capped independently — see batchedHttpProvider.ts's
      // DEFAULT_MAX_CONCURRENT). setTimeout(..., 0) still yields to the
      // event loop between batches rather than looping synchronously.
      nextDelay = queue.length > 0 ? 0 : 2000;
    }
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
  }

  /**
   * The raw per-piece error (`batchedHttpProvider.ts`'s own internal
   * `[provider-name] no result for this piece`, or a bare exception
   * message) is accurate but not something a user should have to parse —
   * real bug, found via a live user report showing that exact string in
   * the bubble's red panel. Recognized shapes get a plain-language
   * message; anything unrecognized passes through unchanged rather than
   * being silently hidden, since a novel message is still real diagnostic
   * signal worth showing.
   */
  function toUserFacingErrorMessage(raw: string): string {
    if (/no result for this piece/i.test(raw)) {
      return "Couldn't reach the translation service — retrying automatically.";
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
    // Accuracy fix, found via audit: this used to pass `options.getSourceLanguage`
    // straight through, bypassing `sourceLanguageOverride` entirely — the
    // bubble's manual "From" picker (a one-off forced source language, see
    // that field's declaration comment) correctly applied to every body
    // text node's translate request (line ~464 below), but the tab title
    // kept using whatever `options.getSourceLanguage()` reports (always
    // `'auto'` in this extension's real wiring) regardless. A page
    // mis-detected as the wrong language, manually corrected via the
    // picker, would translate correctly everywhere except the title.
    getSourceLanguage: () => sourceLanguageOverride ?? options.getSourceLanguage(),
    isPageVisible: () => document.visibilityState === 'visible',
  });

  // Attribute translation (round-3 audit follow-up): `placeholder`/`alt`/
  // `value`/`title` — search boxes, image alt text, button labels, and
  // tooltips used to stay in the original language on an otherwise fully
  // translated page, since none of them are `Text` nodes this module's own
  // walk ever reaches. Same `sourceLanguageOverride` fix as titleTranslator
  // just above, for the same reason.
  const attributeTranslator = createAttributeTranslator({
    translator: options.translator,
    getSourceLanguage: () => sourceLanguageOverride ?? options.getSourceLanguage(),
  });

  const resweep = createResweepScheduler({
    isTranslated: () => pageLanguageState === 'translated',
    isPageVisible: () => document.visibilityState === 'visible',
    onResweep() {
      // Bound nodesToRestore's growth: drop entries for nodes the page has
      // since removed from the DOM, so a long-lived SPA session doesn't
      // hold onto every detached Text node it ever translated — see the
      // field's declaration comment above.
      //
      // Real bug this closed: pruning on a SINGLE disconnected tick raced
      // virtualized/recycled list widgets, which routinely detach a node
      // and reattach the SAME node (same identity, same already-translated
      // .data) within one resweep interval as the user scrolls. A node
      // caught disconnected mid-tick lost its nodesToRestore entry right
      // then — and never got it back, because queueOrRequeueIfChanged only
      // re-adds a reappearing node when its content actually changed
      // (lastSeenText still matches unchanged, already-translated text).
      // That node was then permanently unrestorable: restorePage() had no
      // original text to roll it back to. `pruneDisconnectedRestoreEntries`
      // (above) requires two CONSECUTIVE disconnected ticks — a real
      // removal, not a recycle-pool blip — before pruning, giving a full
      // resweep interval for a transient detach/reattach to resolve first.
      pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick);
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
      mutationWatcher.enable();
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
    cycleGeneration++;
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = null;
    mutationWatcher.disable();
    resweep.stop();
    titleTranslator.restore();
    attributeTranslator.restore();
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
    /** True while there's real translate work queued or in flight and nothing has given up and surfaced an error — see this file's `working`/`recomputeWorking` header comment. */
    isWorking: (): boolean => working,
    onWorkingChange(cb: (working: boolean) => void): () => void {
      workingListeners.add(cb);
      return () => workingListeners.delete(cb);
    },
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;
