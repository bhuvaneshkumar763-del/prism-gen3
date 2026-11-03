import { mountBubble } from '../components/bubble/mountBubble';
import { mountHoverTooltip } from '../components/hoverTooltip/mountHoverTooltip';
import { mountSelectionPopup } from '../components/selection/mountSelectionPopup';
import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { onTrustedMessage, sendMessage } from '../src/platform/messaging/protocol';
import {
  createOriginalLanguageTracker,
  MAIN_FRAME_DECISION_WORST_CASE_MS,
} from '../src/platform/originalLanguageTracker';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';
import { resolveBubbleVisibility } from '../src/shared/config/siteOverrides';

/** The bubble/hover tooltip/selection popup would be inert (and just clutter) on an extension-owned page. */
const SKIP_UI_PROTOCOLS = ['chrome-extension:', 'moz-extension:', 'about:'];

/**
 * Runs the page-translation engine in every frame, reaching the background
 * through `createRemoteTranslator()` (the engine never touches `browser.*`).
 * The top frame also mounts the bubble, hover tooltip and selection popup,
 * makes the auto-translate-on-load decision and answers popup messages.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  // Every frame gets a page translator; UI and popup-facing handlers stay
  // top-frame only (the `window.self === window.top` checks below).
  allFrames: true,
  // document_end, not the default document_idle: config load, the
  // auto-translate decision and the mutation observer shouldn't wait on slow
  // subresources, and nothing here needs them.
  runAt: 'document_end',
  main() {
    // Cross-origin sub-frames (most ad/embed iframes) can never inherit an
    // auto-translate decision or receive `pageTranslate`, so skip all setup
    // there; `pageRestore` would be a no-op for them anyway.
    if (window.self !== window.top) {
      try {
        void window.top?.location.href;
      } catch {
        return;
      }
    }

    void configStore.onReady();

    // Shared by getSourceLanguage and the getOriginalLanguage handler. Only
    // started in the top frame; until then get() returns 'und'.
    const originalLanguageTracker = createOriginalLanguageTracker();

    const pageTranslator = createPageTranslator({
      translator: createRemoteTranslator(),
      // This page's freshly detected language rather than 'auto': Google's
      // auto-detect silently echoes some pieces back untranslated on some
      // sites. Never persisted; a manual "From" pick still overrides it.
      getSourceLanguage: () => {
        const detected = originalLanguageTracker.get();
        return detected === 'und' ? 'auto' : detected;
      },
      getBatchingHint: () =>
        getBatchingHint(configStore.get('pageTranslatorProvider'), configStore.get('groupParagraphs')),
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

      // Always visible, not gated on translated state: the bubble is the main
      // in-page way to start a translation. Per-host via bubbleEnabled/bubbleByHost.
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
      // Busy tracks real queued/in-flight work (translatePage() returns before
      // any translating happens), so it also covers auto-translate-on-load.
      pageTranslator.onWorkingChange((working) => {
        bubble?.update({ busy: working });
      });
      // `progress` can settle short of 1 by design; the bubble hides it when
      // `busy` goes false (see onProgressChange in translateLoop.ts).
      pageTranslator.onProgressChange((done, total) => {
        bubble?.update({ progress: total > 0 ? done / total : null });
      });
      configStore.onChanged((name) => {
        if (name === 'bubbleEnabled' || name === 'bubbleByHost') syncBubbleVisibility();
      });
      // Awaited: FloatingBubble seeds its language, service and position
      // signals from configStore.get() once at mount, so mounting before
      // storage loads would show defaults instead of saved values.
      void (async () => {
        await configStore.onReady();
        syncBubbleVisibility();
      })();

      // Global toggles only; unlike the bubble, neither has a per-site "Hide".
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
      onTrustedMessage('translateSelection', (message) => {
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
        // Report even "don't translate" so same-origin sub-frames stop polling.
        // Handled, not `void`, to avoid an unhandled rejection in the page's
        // console; sub-frames then just don't inherit a decision.
        sendMessage('reportFrameLanguageDecision', {
          shouldTranslate,
          targetLanguage: configStore.get('targetLanguage'),
          originalLanguage: originalLanguageTracker.get(),
          mainFrameOrigin: location.origin,
        }).catch((e) => {
          console.warn('[prism] could not share the language decision with frames', e);
        });
        if (shouldTranslate) {
          await pageTranslator.translatePage(configStore.get('targetLanguage'));
        }
      })();
    } else {
      void (async () => {
        await configStore.onReady();
        // The main frame's report may arrive after this sub-frame loads, so
        // poll, bounded in case the main frame never reports.
        const POLL_INTERVAL_MS = 200;
        // Covers the main frame's worst case (visibility wait plus language
        // detection, serial, e.g. a background tab) plus ~1 s of margin.
        const MAX_ATTEMPTS = Math.ceil(MAIN_FRAME_DECISION_WORST_CASE_MS / POLL_INTERVAL_MS) + 5; // ~9s
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const decision = await sendMessage('getFrameLanguageDecision', undefined);
          // A previous page's entry may still be there; an origin mismatch
          // means "not updated for this load yet", so keep polling.
          if (decision && decision.mainFrameOrigin === window.top?.location.origin) {
            // Explicit source = the main frame's detection. It goes to the
            // provider as-is, so 'und' must become 'auto' here.
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

    // Registered in every frame: same-origin sub-frames auto-translate
    // themselves, and "Show original" (sent with no frameId, so to every
    // frame) must restore them too.
    onTrustedMessage('pageRestore', () => {
      pageTranslator.restorePage();
      return pageTranslator.getState();
    });

    if (window.self === window.top) {
      onTrustedMessage('pageTranslate', async (message) => {
        await configStore.onReady();
        await pageTranslator.translatePage(message.data.targetLanguage);
        return pageTranslator.getState();
      });
      onTrustedMessage('getPageState', () => {
        return pageTranslator.getState();
      });
      onTrustedMessage('getOriginalLanguage', () => {
        return originalLanguageTracker.get();
      });
      onTrustedMessage('getPageError', () => {
        const lastError = pageTranslator.getLastError();
        return lastError ? { message: lastError, kind: pageTranslator.getLastErrorKind() } : null;
      });
      onTrustedMessage('getPageWorking', () => {
        return pageTranslator.isWorking();
      });
    }
  },
});
