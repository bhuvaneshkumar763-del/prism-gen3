import { mountBubble } from '../components/bubble/mountBubble';
import { mountHoverTooltip } from '../components/hoverTooltip/mountHoverTooltip';
import { mountSelectionPopup } from '../components/selection/mountSelectionPopup';
import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { onMessage } from '../src/platform/messaging/protocol';
import { createOriginalLanguageTracker } from '../src/platform/originalLanguageTracker';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';
import { resolveBubbleVisibility, resolveSourceLanguageForHost } from '../src/shared/config/siteOverrides';

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
 * - The hover-to-see-original tooltip (`components/hoverTooltip/`).
 * - Translate-selected-text (`components/selection/`).
 */
export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    void configStore.onReady();

    const pageTranslator = createPageTranslator({
      translator: createRemoteTranslator(),
      getSourceLanguage: () =>
        resolveSourceLanguageForHost(
          configStore.get('sourceLanguageByHost'),
          location.hostname,
          configStore.get('sourceLanguage'),
        ),
      getBatchingHint: () => getBatchingHint(configStore.get('pageTranslatorProvider')),
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
            onTranslate: (targetLanguage) => void handleTranslateClick(targetLanguage),
            onRestore: () => pageTranslator.restorePage(),
            onClose: () => {
              bubble = null;
            },
          });
          bubble.update({
            pageState: pageTranslator.getState(),
            errorMessage: pageTranslator.getLastError(),
          });
        }
      }

      async function handleTranslateClick(targetLanguage: string): Promise<void> {
        bubble?.update({ busy: true });
        await configStore.onReady();
        try {
          await pageTranslator.translatePage(targetLanguage);
        } finally {
          // Only the awaiting caller clears `busy` — deliberately NOT done
          // from the onStateChange listener below, which fires synchronously
          // inside translatePage() itself (see translateLoop.ts's setState
          // call) and would otherwise clear it before this await even
          // resolves, the same "spinner shows for ~zero frames" bug the
          // pre-rewrite fork's bubble had.
          bubble?.update({ busy: false });
        }
      }

      pageTranslator.onStateChange((state) => {
        bubble?.update({ pageState: state });
      });
      // A translate call can keep failing silently in the background long
      // after the state-change above already fired (see translateLoop.ts's
      // consecutive-failure guard) — this is the surface that reflects it.
      pageTranslator.onError((message) => {
        bubble?.update({ errorMessage: message });
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

      mountHoverTooltip(pageTranslator);
      mountSelectionPopup({
        translator: createRemoteTranslator(),
        getSourceLanguage: () => configStore.get('sourceLanguage'),
        getTargetLanguage: () => configStore.get('targetLanguage'),
      });
    }

    if (window.self === window.top) {
      void (async () => {
        const originalLanguageTracker = createOriginalLanguageTracker();
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
        if (shouldTranslate) {
          await pageTranslator.translatePage(configStore.get('targetLanguage'));
        }
      })();
    }

    onMessage('pageTranslate', async (message) => {
      await configStore.onReady();
      await pageTranslator.translatePage(message.data.targetLanguage);
      return pageTranslator.getState();
    });
    onMessage('pageRestore', () => {
      pageTranslator.restorePage();
      return pageTranslator.getState();
    });
    onMessage('getPageState', () => pageTranslator.getState());
  },
});
