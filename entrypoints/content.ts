import { mountBubble } from '../components/bubble/mountBubble';
import { mountHoverTooltip } from '../components/hoverTooltip/mountHoverTooltip';
import { mountSelectionPopup } from '../components/selection/mountSelectionPopup';
import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { isTrustedSender, onMessage, sendMessage } from '../src/platform/messaging/protocol';
import {
  createOriginalLanguageTracker,
  MAIN_FRAME_DECISION_WORST_CASE_MS,
} from '../src/platform/originalLanguageTracker';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';
import { resolveBubbleVisibility } from '../src/shared/config/siteOverrides';

/** The bubble/hover tooltip/selection popup would be inert (and just clutter) on an extension-owned page. */
const SKIP_UI_PROTOCOLS = ['chrome-extension:', 'moz-extension:', 'about:'];

/**
 * Wires the real page-translation engine (Session 5:
 * `src/engine/pageTranslator/translateLoop.ts`) into a live content
 * script. Translates (and restores) the whole page, keeps watching for
 * new/changed content, and picks its chunking strategy per the active
 * provider's `batchingHint` (see `descriptors.ts`/`grouping.ts`).
 *
 * The engine itself never touches `browser.*` — `createRemoteTranslator()`
 * (src/platform/remoteTranslator.ts) is the one adapter bridging it to
 * the typed messaging protocol, and `configStore` supplies the current
 * provider/source-language selection.
 *
 * Auto-translate-on-load: detects the page's language via
 * `originalLanguageTracker`, then defers the actual yes/no call to the pure
 * `shouldAutoTranslateOnLoad` decision function against the current
 * always/never-translate-sites/langs config lists.
 *
 * `pageTranslate`/`pageRestore`/`getPageState` are declared via the typed
 * protocol's `onMessage()` (`src/platform/messaging/protocol.ts`) — the
 * popup and `background.ts`'s context-menu/keyboard-command handlers send
 * these same 3 message types.
 *
 * UI surfaces, all main-frame only — an iframe translating independently
 * doesn't get its own copy of any of these, a documented limitation shared
 * with auto-translate-on-load, not a silent gap:
 * - The floating bubble (`components/bubble/`): always visible (not gated
 *   on translated state — see `FloatingBubble.tsx`'s header comment for why
 *   that changed post-launch), the primary in-page way to start/undo a
 *   translation and to reach the From/To/Service pickers, on both desktop
 *   and mobile. Visibility is per-host via `bubbleEnabled`/`bubbleByHost`.
 * - The hover-to-see-original tooltip (`components/hoverTooltip/`), gated
 *   by `hoverTooltipEnabled` (global toggle — Phase 2 popup/settings work,
 *   previously hardcoded-on with no config at all).
 * - Translate-selected-text (`components/selection/`), gated by
 *   `selectionPopupEnabled`, same history as above.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  // Real gap: iframe content got no translation of any kind (not just no
  // auto-translate decision) — the content script never ran there at all.
  // Now it runs in every frame; main() below still scopes UI mounting and
  // the popup-facing onMessage handlers to the top frame only (see the
  // `window.self === window.top` checks), so this alone doesn't change any
  // existing single-frame behavior — it only adds a frame-scoped
  // pageTranslator plus the auto-translate relay for same-origin sub-frames.
  allFrames: true,
  // Post-launch speed pass: no explicit runAt meant WXT/Chrome defaulted to
  // document_idle (roughly "after the page's load event"), which on a page
  // with slow images/ads/trackers can start this script — and therefore
  // config load, the auto-translate decision, and the mutation observer's
  // attachment — meaningfully late. document_end fires right after DOM
  // parsing, well before subresources finish; nothing here depends on
  // subresources being loaded (configStore.onReady() is still awaited
  // before anything real happens).
  runAt: 'document_end',
  main() {
    // Round-5 bloat audit: a CROSS-ORIGIN sub-frame — the overwhelming
    // majority of real-world ad/tracker/embed iframes — never gets an
    // auto-translate decision (that always required passing this exact
    // same-origin check, previously performed again further down, after
    // all the construction below had already run) and can never receive a
    // `pageTranslate` message (that handler, further down, is registered
    // top-frame-only). So
    // building a full `PageTranslator` and reading the whole config store
    // for one was pure dead weight, paid unconditionally on every such
    // frame of every page — `matches: ['*://*/*']` + `allFrames: true`
    // means this script runs there too. Bail before any of that work
    // starts; `pageRestore`'s handler (registered further down,
    // unconditionally, for the beta.48 iframe-restore fix) is also skipped
    // here, which is safe: restoring a `PageTranslator` that never
    // translated is already a no-op, and a cross-origin frame's
    // `PageTranslator` was never reachable to translate it in the first
    // place. A same-origin sub-frame (or the top frame) is unaffected —
    // this only short-circuits the case that was always fully inert.
    if (window.self !== window.top) {
      try {
        void window.top?.location.href;
      } catch {
        return;
      }
    }

    void configStore.onReady();

    // Hoisted above pageTranslator (not a fire-and-forget IIFE-local
    // variable) so both getSourceLanguage below and the getOriginalLanguage
    // message handler further down read the same tracker instead of
    // re-detecting. Only actually started (top-level frames only) further
    // down — get() stays 'und' until then, which getSourceLanguage below
    // treats the same as "detection unavailable," not an error.
    const originalLanguageTracker = createOriginalLanguageTracker();

    const pageTranslator = createPageTranslator({
      translator: createRemoteTranslator(),
      // Prism's own freshly-detected language for THIS page load, not the
      // literal string 'auto' — real bug found via a live user report
      // (novel543.com translated only partially, no error shown): Google's
      // own auto-detection silently no-ops (200 OK, content echoed back
      // unchanged) for a large, inconsistent fraction of pieces on some
      // sites, confirmed by testing the identical text directly against
      // the endpoint with 'auto' vs an explicit source language. Falls
      // back to 'auto' when detection hasn't resolved or came back 'und'
      // — no worse than the prior always-'auto' behavior in that case.
      //
      // Not a repeat of the beta.22 bug this replaced (a manually-picked
      // source language forced onto every future request forever, fighting
      // per-request auto-detection and mistranslating already-correct
      // content): that was a STALE, PERSISTED, cross-session value.
      // originalLanguageTracker re-detects fresh from this page's own real
      // text on every load and is never persisted — the manually-picked
      // "From" override (FloatingBubble.tsx) still takes precedence when
      // set, via translateLoop.ts's sourceLanguageOverride, unaffected by
      // this change.
      getSourceLanguage: () => {
        const detected = originalLanguageTracker.get();
        return detected === 'und' ? 'auto' : detected;
      },
      getBatchingHint: () => getBatchingHint(configStore.get('pageTranslatorProvider')),
      getTranslatePreTags: () => configStore.get('translatePreTags'),
    });

    if (window.self === window.top && !SKIP_UI_PROTOCOLS.includes(location.protocol)) {
      let bubble: ReturnType<typeof mountBubble> | null = null;

      function bubbleShouldShow(): boolean {
        return resolveBubbleVisibility({
          hostname: location.hostname,
          bubbleEnabled: configStore.get('bubbleEnabled'),
          bubbleByHost: configStore.get('bubbleByHost'),
        });
      }

      // Always visible (not gated on translated state) — the bubble is the
      // primary in-page way to start a translation, not just a post-translate
      // control. Visibility is per-host, via bubbleEnabled/bubbleByHost
      // (Hide chip, and the popup/options toggles that write the same keys).
      function syncBubbleVisibility(): void {
        if (!bubbleShouldShow()) {
          bubble?.unmount();
          bubble = null;
          return;
        }
        if (!bubble) {
          bubble = mountBubble({
            hostname: location.hostname,
            onTranslate: (targetLanguage, sourceLanguage) => void handleTranslateClick(targetLanguage, sourceLanguage),
            onRestore: () => pageTranslator.restorePage(),
            onClose: () => {
              bubble = null;
            },
          });
          bubble.update({
            pageState: pageTranslator.getState(),
            errorMessage: pageTranslator.getLastError(),
            errorKind: pageTranslator.getLastErrorKind(),
            originalLanguage: originalLanguageTracker.get(),
          });
          // Detection may still be running; start() is shared, so this
          // doesn't detect a second time — it just waits for the one result.
          void originalLanguageTracker.start().then(() => {
            bubble?.update({ originalLanguage: originalLanguageTracker.get() });
          });
        }
      }

      async function handleTranslateClick(targetLanguage: string, sourceLanguage?: string): Promise<void> {
        await configStore.onReady();
        await pageTranslator.translatePage(targetLanguage, sourceLanguage);
      }

      pageTranslator.onStateChange((state) => {
        bubble?.update({ pageState: state });
      });
      // A translate call can keep failing silently in the background long
      // after the state-change above already fired (see translateLoop.ts's
      // consecutive-failure guard) — this is the surface that reflects it.
      pageTranslator.onError((message, kind) => {
        bubble?.update({ errorMessage: message, errorKind: kind });
      });
      // Real bug this replaced: `busy` used to be toggled manually around
      // handleTranslateClick's own await, which resolved in ~zero frames —
      // translatePage() queues nodes and schedules the routine but never
      // awaits any real translate work, so the bubble turned green
      // instantly with nothing actually translated yet, and there was no
      // indicator during the real (sometimes several-second) work that
      // followed. `isWorking`/`onWorkingChange` (translateLoop.ts) track
      // real activity — queued or in-flight work, cleared once the queue
      // drains or an error surfaces — so this now reflects the bubble's
      // busy state accurately, and for free also covers the
      // auto-translate-on-load path below, which never had an indicator
      // before at all.
      pageTranslator.onWorkingChange((working) => {
        bubble?.update({ busy: working });
      });
      // Perceived-speed fix: real progress instead of just a binary busy
      // flag — see `onProgressChange`'s own doc comment (translateLoop.ts)
      // for why `progress` can settle short of `1` and why that's by
      // design, not a bug (FloatingBubble.tsx hides on `busy` going false,
      // same as it already does for the spinner, not on `progress === 1`).
      pageTranslator.onProgressChange((done, total) => {
        bubble?.update({ progress: total > 0 ? done / total : null });
      });
      configStore.onChanged((name) => {
        if (name === 'bubbleEnabled' || name === 'bubbleByHost') syncBubbleVisibility();
      });
      // Awaited, not fired-and-forgotten — FloatingBubble reads configStore.get()
      // once at construction to seed its target/source-language, service, and
      // remembered-position signals (see its header comment). On a fresh
      // content-script load, browser.storage's own read is genuinely async;
      // mounting before it resolves would seed those signals from
      // defaultConfig instead of the real saved values (confirmed for real —
      // a dragged-to-left bubble briefly rendered docked right again on
      // reload before this await was added).
      void (async () => {
        await configStore.onReady();
        syncBubbleVisibility();
      })();

      // Hover tooltip / selection popup: previously hardcoded-on with no
      // config at all — now gated by hoverTooltipEnabled/selectionPopupEnabled
      // (global only, no per-host override — unlike the bubble, neither of
      // these has a per-site "Hide" affordance of its own to justify one).
      let hoverTooltip: ReturnType<typeof mountHoverTooltip> | null = null;
      let selectionPopup: ReturnType<typeof mountSelectionPopup> | null = null;

      function syncHoverTooltip(): void {
        const enabled = configStore.get('hoverTooltipEnabled');
        if (enabled && !hoverTooltip) {
          hoverTooltip = mountHoverTooltip(pageTranslator);
        } else if (!enabled && hoverTooltip) {
          hoverTooltip.destroy();
          hoverTooltip = null;
        }
      }

      /** Whether the mounted selection popup shows its floating button automatically, or only answers explicit requests. */
      let selectionPopupAuto = false;

      function createSelectionPopup(autoTrigger: boolean): ReturnType<typeof mountSelectionPopup> {
        return mountSelectionPopup({
          translator: createRemoteTranslator(),
          getSourceLanguage: () => configStore.get('sourceLanguage'),
          getTargetLanguage: () => configStore.get('targetLanguage'),
          getSkipInvalidText: () => configStore.get('selectionPopupSkipInvalidText'),
          getSkipTargetLanguageText: () => configStore.get('selectionPopupSkipTargetLanguageText'),
          autoTrigger,
        });
      }

      function syncSelectionPopup(): void {
        const enabled = configStore.get('selectionPopupEnabled');
        if (enabled && (!selectionPopup || !selectionPopupAuto)) {
          // Replaces an explicit-only popup (mounted by a right-click while the
          // button was off) with the normal one, so turning the button back on
          // actually brings the button back.
          selectionPopup?.destroy();
          selectionPopup = createSelectionPopup(true);
          selectionPopupAuto = true;
        } else if (!enabled && selectionPopup && selectionPopupAuto) {
          selectionPopup.destroy();
          selectionPopup = null;
          selectionPopupAuto = false;
        }
      }

      // Right-click "Translate selection". Works even with the floating
      // button turned off: that's an explicit request, so an explicit-only
      // popup (no selection listeners, zero cost until now) is mounted on
      // demand rather than quietly turning the button back on.
      onMessage('translateSelection', (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        if (!selectionPopup) {
          selectionPopup = createSelectionPopup(false);
          selectionPopupAuto = false;
        }
        selectionPopup.translateText(message.data.text);
      });

      configStore.onChanged((name) => {
        if (name === 'hoverTooltipEnabled') syncHoverTooltip();
        if (name === 'selectionPopupEnabled') syncSelectionPopup();
      });
      void (async () => {
        await configStore.onReady();
        syncHoverTooltip();
        syncSelectionPopup();
      })();
    }

    if (window.self === window.top) {
      void (async () => {
        await Promise.all([configStore.onReady(), originalLanguageTracker.start()]);

        const shouldTranslate = shouldAutoTranslateOnLoad({
          originalLanguage: originalLanguageTracker.get(),
          hostname: location.hostname,
          targetLanguage: configStore.get('targetLanguage'),
          pageLanguageState: pageTranslator.getState(),
          alwaysTranslateSites: configStore.get('alwaysTranslateSites'),
          neverTranslateSites: configStore.get('neverTranslateSites'),
          alwaysTranslateLangs: configStore.get('alwaysTranslateLangs'),
          neverTranslateLangs: configStore.get('neverTranslateLangs'),
          isIncognito: browser.extension?.inIncognitoContext ?? false,
        });
        // Report unconditionally (even "don't translate") — a same-origin
        // sub-frame needs to know the main frame HAS decided, not just
        // what a positive decision was, so it can stop retrying below
        // instead of waiting the full retry budget out on every load.
        void sendMessage('reportFrameLanguageDecision', {
          shouldTranslate,
          targetLanguage: configStore.get('targetLanguage'),
          originalLanguage: originalLanguageTracker.get(),
          mainFrameOrigin: location.origin,
        });
        if (shouldTranslate) {
          await pageTranslator.translatePage(configStore.get('targetLanguage'));
        }
      })();
    } else {
      void (async () => {
        await configStore.onReady();
        // The main frame's own report can arrive after this sub-frame
        // has already loaded (e.g. the iframe's own document finishes
        // parsing first) — poll briefly rather than querying once and
        // giving up. Bounded, not indefinite: a main frame that never
        // reports (translation disabled, an error) must not leave this
        // polling forever.
        const POLL_INTERVAL_MS = 200;
        // Round-5 bloat audit: derived from the main frame's own real
        // worst case (`MAIN_FRAME_DECISION_WORST_CASE_MS` —
        // `waitUntilVisible`'s 5s plus language detection's 3s, fully
        // serial) instead of an independently-chosen 15 (~3s). The old
        // fixed budget was SMALLER than the producer's worst case, so a
        // page opened in a background tab (never visible, burning the
        // full visibility timeout) or with slow detection left every
        // same-origin sub-frame exhausting its poll budget and giving up
        // silently — never translating — before the main frame's own
        // perfectly good decision had even arrived. +5 attempts (~1s) of
        // margin for this poll's own round-trip overhead on top of the
        // producer's bound.
        const MAX_ATTEMPTS = Math.ceil(MAIN_FRAME_DECISION_WORST_CASE_MS / POLL_INTERVAL_MS) + 5; // ~9s
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const decision = await sendMessage('getFrameLanguageDecision', undefined);
          // Reliability/privacy fix, found via a round-4 audit: a stale
          // entry from the PREVIOUS page (frameLanguageDecisions is only
          // ever overwritten by the new main frame's own fresh report,
          // never proactively cleared) could otherwise be accepted here
          // immediately, before that fresh report has a chance to land —
          // see FrameLanguageDecision's `mainFrameOrigin` doc comment.
          // `window.top.location.origin` reflects THIS frame's own
          // current page the instant its navigation commits, so a
          // mismatch here reliably means "not yet updated for this
          // load," not a permanent condition — treated exactly like "no
          // decision yet" and left to the existing retry budget.
          if (decision && decision.mainFrameOrigin === window.top?.location.origin) {
            // Accuracy fix, found via audit: this used to omit the
            // second argument, so every sub-frame translate silently
            // used the literal 'auto' regardless of what the main frame
            // actually detected — see FrameLanguageDecision's
            // `originalLanguage` doc comment for why that's the same
            // input beta.29 replaced everywhere else. Same 'und' → 'auto'
            // normalization as `pageTranslator`'s own `getSourceLanguage`
            // above — `sourceLanguageOverride` (what this second argument
            // sets) is sent to the provider AS-IS with no fallback
            // handling of its own, unlike the ambient path, so 'und'
            // must be normalized here rather than passed through raw.
            if (decision.shouldTranslate) {
              const sourceLanguage = decision.originalLanguage === 'und' ? 'auto' : decision.originalLanguage;
              await pageTranslator.translatePage(decision.targetLanguage, sourceLanguage);
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      })();
    }

    // Reliability/privacy fix, found via a round-4 audit: `pageRestore`
    // used to be registered top-frame-only, like every other popup-facing
    // handler here — but unlike those (genuinely fine to scope to the top
    // frame; the popup's own UI only ever needs the main frame's state), a
    // same-origin sub-frame DOES auto-translate itself (see the polling
    // relay above), so "Show original" never reaching it left the page
    // permanently half-translated: the sub-frame's mutation watcher kept
    // right on translating new content and sending it to the provider
    // after the user had explicitly asked for the original page back.
    // `tabs.sendMessage(tabId, message)` with no explicit `frameId` already
    // broadcasts to every frame in the tab — the gap was purely that only
    // the top frame ever installed a listener to receive it.
    onMessage('pageRestore', (message) => {
      if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
      pageTranslator.restorePage();
      return pageTranslator.getState();
    });

    if (window.self === window.top) {
      onMessage('pageTranslate', async (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        await configStore.onReady();
        await pageTranslator.translatePage(message.data.targetLanguage);
        return pageTranslator.getState();
      });
      onMessage('getPageState', (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        return pageTranslator.getState();
      });
      onMessage('getOriginalLanguage', (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        return originalLanguageTracker.get();
      });
      onMessage('getPageError', (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        const lastError = pageTranslator.getLastError();
        return lastError ? { message: lastError, kind: pageTranslator.getLastErrorKind() } : null;
      });
      onMessage('getPageWorking', (message) => {
        if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
        return pageTranslator.isWorking();
      });
    }
  },
});
