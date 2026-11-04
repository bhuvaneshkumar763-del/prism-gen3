import { mountBubble } from '../components/bubble/mountBubble';
import { mountHoverTooltip } from '../components/hoverTooltip/mountHoverTooltip';
import { mountSelectionPopup } from '../components/selection/mountSelectionPopup';
import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator, type PageLanguageState } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { onTrustedMessage, sendMessage } from '../src/platform/messaging/protocol';
import {
  createOriginalLanguageTracker,
  MAIN_FRAME_DECISION_WORST_CASE_MS,
} from '../src/platform/originalLanguageTracker';
import {
  classifyFrame,
  type FollowerState,
  followTopFrame,
  type PageControl,
  pageCommandRoute,
} from '../src/platform/pageFrames';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';
import { resolveBubbleVisibility } from '../src/shared/config/siteOverrides';
import { describeFollow, describeFollowError, describeTranslated, showFrameStatus } from './lib/frameStatus';
import { FRAME_SYNC_KEY, pageKeyFromSync } from './lib/frameSync';
import { pollForFrameDecision } from './lib/subFramePoll';

/**
 * Posted by a sub-frame to the top frame when the background has no decision
 * for it (lost, or dropped on a same-document navigation). The top frame just
 * publishes its current decision again, so a page posting it changes nothing.
 */
const FRAME_ASK_KEY = 'prismFrameAsk';

type PageCommand = { kind: 'translate'; targetLanguage: string; sourceLanguage?: string } | { kind: 'restore' };

/**
 * Runs the page-translation engine in the top frame and every same-origin
 * sub-frame, reaching the background through `createRemoteTranslator()` (the
 * engine never touches `browser.*`). The top frame is the page controller:
 * every control (bubble, popup, menu, shortcut, auto-translate) goes through
 * its `runPageCommand`, which applies the command and publishes it to the
 * sub-frames (see `pageFrames.ts`). It also mounts the bubble, hover tooltip
 * and selection popup and answers popup messages.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  // Same-origin sub-frames get a page translator that follows the top frame;
  // UI and popup-facing handlers are top-frame only.
  allFrames: true,
  // document_end, not the default document_idle: config load, the
  // auto-translate decision and the mutation observer shouldn't wait on slow
  // subresources, and nothing here needs them.
  runAt: 'document_end',
  main() {
    const isTop = window.self === window.top;
    let canReadTopLocation = true;
    if (!isTop) {
      try {
        void window.top?.location.href;
      } catch {
        canReadTopLocation = false;
      }
    }
    // Cross-origin sub-frames (most ad/embed iframes) can't read the top
    // frame's decision, so they get no setup at all.
    const frameKind = classifyFrame(isTop, canReadTopLocation);
    if (frameKind === 'crossOriginSubFrame') return;

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

    /** Set once any control has translated or restored; the on-load decision then no longer applies. */
    let pageCommandSeen = false;
    /** The From pick sticks for the page load, as in the page translator, so sub-frames keep using it too. */
    let pickedSourceLanguage: string | undefined;
    let publishing: Promise<void> = Promise.resolve();
    /** The last command published to sub-frames, re-published when a sub-frame finds no decision. */
    let lastPublished: PageCommand | null = null;
    let republishQueued = false;
    /** Handed to sub-frames so they find this page's decision even when the browser names no tab for them (Safari). */
    const pageKey = crypto.randomUUID();

    /** The one entry point for translate/restore in the top frame, whichever control sent it. */
    async function runPageCommand(command: PageCommand, control: PageControl): Promise<PageLanguageState> {
      if (control !== 'autoTranslate') pageCommandSeen = true;
      const route = pageCommandRoute(frameKind, control);
      if (command.kind === 'translate') {
        await configStore.onReady();
        if (command.sourceLanguage !== undefined) pickedSourceLanguage = command.sourceLanguage;
        if (route.runHere) await pageTranslator.translatePage(command.targetLanguage, command.sourceLanguage);
      } else if (route.runHere) {
        pageTranslator.restorePage();
      }
      if (route.forwardToSameOriginSubFrames) publishToSubFrames(command);
      return pageTranslator.getState();
    }

    /**
     * Stores the command as the tab's frame decision in the background (what
     * sub-frames read, including ones that load later), then tells loaded
     * sub-frames to re-read it. Chained so decisions land in command order.
     */
    function publishToSubFrames(command: PageCommand): void {
      lastPublished = command;
      const shouldTranslate = command.kind === 'translate';
      const targetLanguage = shouldTranslate ? command.targetLanguage : configStore.get('targetLanguage');
      const pickedSource = pickedSourceLanguage;
      publishing = publishing
        .then(async () => {
          // Shared with the bubble and the auto-translate decision, so this
          // waits for the one detection rather than starting another.
          await originalLanguageTracker.start();
          await sendMessage('reportFrameLanguageDecision', {
            shouldTranslate,
            targetLanguage,
            originalLanguage: pickedSource ?? originalLanguageTracker.get(),
            mainFrameOrigin: location.origin,
            pageKey,
          });
          notifySubFrames(window);
        })
        .catch((e) => {
          // Handled, not `void`, to keep it out of the page's console as an
          // unhandled rejection; sub-frames then just keep their last state.
          console.warn('[prism] could not share the page command with frames', e);
        });
    }

    /** Walks the whole frame tree; the target origin keeps cross-origin frames from receiving it. */
    function notifySubFrames(parent: Window): void {
      for (let i = 0; i < parent.frames.length; i++) {
        const child = parent.frames[i];
        if (!child) continue;
        try {
          child.postMessage({ [FRAME_SYNC_KEY]: true, pageKey }, location.origin);
        } catch {
          // A frame that went away mid-walk.
        }
        notifySubFrames(child);
      }
    }

    if (isTop) {
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
            onTranslate: (targetLanguage, sourceLanguage) =>
              void runPageCommand({ kind: 'translate', targetLanguage, sourceLanguage }, 'bubble'),
            onRestore: () => void runPageCommand({ kind: 'restore' }, 'bubble'),
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

    if (isTop) {
      void (async () => {
        await Promise.all([configStore.onReady(), originalLanguageTracker.start()]);
        // A control used while detection ran already decided this page.
        if (pageCommandSeen) return;

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
        if (shouldTranslate) {
          await runPageCommand(
            { kind: 'translate', targetLanguage: configStore.get('targetLanguage') },
            'autoTranslate',
          );
        } else if (pageCommandRoute(frameKind, 'autoTranslate').forwardToSameOriginSubFrames) {
          // Published even when not translating, so sub-frames stop polling.
          publishToSubFrames({ kind: 'restore' });
        }
      })();

      // Sent to every frame of the tab; only the top frame registers them, so
      // each command is applied once per frame and answered by the top frame.
      onTrustedMessage('pageTranslate', (message) =>
        runPageCommand({ kind: 'translate', targetLanguage: message.data.targetLanguage }, 'pageMessage'),
      );
      onTrustedMessage('pageRestore', () => runPageCommand({ kind: 'restore' }, 'pageMessage'));
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

      // One re-publish at a time, however many sub-frames (or page scripts) ask.
      window.addEventListener('message', (event) => {
        if (event.data?.[FRAME_ASK_KEY] !== true || event.origin !== location.origin) return;
        if (!lastPublished || republishQueued) return;
        republishQueued = true;
        publishToSubFrames(lastPublished);
        void publishing.then(() => {
          republishQueued = false;
        });
      });
    } else {
      let followerState: FollowerState = { translated: false };
      let following: Promise<unknown> = Promise.resolve();
      /** The top frame's page key, from its sync message; a forged one finds no decision. */
      let pageKey: string | undefined;

      /** Applies the top frame's latest decision; false while there is none for this page load yet. */
      async function followOnce(): Promise<boolean> {
        const decision = await sendMessage('getFrameLanguageDecision', pageKey ? { pageKey } : undefined);
        const topOrigin = window.top?.location.origin ?? '';
        const step = followTopFrame(decision, topOrigin, followerState);
        showFrameStatus(document, describeFollow(decision, topOrigin, step.action));
        if (step.action === 'translate') {
          followerState = {
            translated: true,
            targetLanguage: step.targetLanguage,
            sourceLanguage: step.sourceLanguage,
          };
          await pageTranslator.translatePage(step.targetLanguage, step.sourceLanguage);
          showFrameStatus(document, describeTranslated(pageTranslator.getState(), pageTranslator.getLastErrorKind()));
        } else if (step.action === 'restore') {
          followerState = { translated: false };
          pageTranslator.restorePage();
        }
        return step.action !== 'wait';
      }

      /** One sync at a time, so two quick commands can't apply out of order. */
      function syncWithTopFrame(): Promise<boolean> {
        const run = following.then(followOnce);
        following = run.catch(() => undefined);
        return run;
      }

      window.addEventListener('message', (event) => {
        if (event.data?.[FRAME_SYNC_KEY] !== true) return;
        // A sync carries no command: the frame re-reads the decision from the
        // background, so a page posting one itself changes nothing.
        pageKey = pageKeyFromSync(event.data, event.origin, location.origin) ?? pageKey;
        syncWithTopFrame().catch((e) => {
          showFrameStatus(document, describeFollowError(e));
          console.warn('[prism] could not follow the page command', e);
        });
      });

      void (async () => {
        await configStore.onReady();
        // The main frame's report may arrive after this sub-frame loads, so
        // poll, bounded in case the main frame never reports.
        const POLL_INTERVAL_MS = 200;
        await pollForFrameDecision({
          sync: syncWithTopFrame,
          intervalMs: POLL_INTERVAL_MS,
          // Covers the main frame's worst case (visibility wait plus language
          // detection, serial, e.g. a background tab) plus ~1 s of margin.
          maxAttempts: Math.ceil(MAIN_FRAME_DECISION_WORST_CASE_MS / POLL_INTERVAL_MS) + 5, // ~9s
          onFirstWait: () => window.top?.postMessage({ [FRAME_ASK_KEY]: true }, location.origin),
          onError: (e) => {
            showFrameStatus(document, describeFollowError(e));
            console.warn('[prism] could not follow the page command', e);
          },
        });
      })();
    }
  },
});
