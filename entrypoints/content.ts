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

const MOBILE_VIEWPORT_QUERY = '(max-width: 480px)';

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
 * UI surfaces (Session 6), all main-frame only — an iframe translating
 * independently doesn't get its own copy of any of these, a documented
 * limitation shared with auto-translate-on-load, not a silent gap:
 * - The floating bubble (`components/bubble/`): post-translate control,
 *   AND (its `showTranslatePrompt` role) a mobile in-page translate
 *   trigger on a narrow viewport — folding what the old repo built as a
 *   separate `MobilePopup.tsx` into the bubble that already exists for
 *   the post-translate case, see `FloatingBubble.tsx`'s header comment.
 * - The hover-to-see-original tooltip (`components/hoverTooltip/`).
 * - Translate-selected-text (`components/selection/`).
 */
export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    void configStore.onReady();

    const pageTranslator = createPageTranslator({
      translator: createRemoteTranslator(),
      getSourceLanguage: () => configStore.get('sourceLanguage'),
      getBatchingHint: () => getBatchingHint(configStore.get('pageTranslatorProvider')),
    });

    if (window.self === window.top) {
      const mobileViewportQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
      let bubble: ReturnType<typeof mountBubble> | null = null;
      let translateBusy = false;

      function syncBubble(): void {
        const state = pageTranslator.getState();
        const showTranslatePrompt = state === 'original' && mobileViewportQuery.matches;
        const shouldShow = state === 'translated' || showTranslatePrompt;

        if (!shouldShow) {
          bubble?.unmount();
          bubble = null;
          return;
        }
        bubble ??= mountBubble({
          onTranslateClick: () => void handleTranslateClick(),
          onRestoreClick: () => pageTranslator.restorePage(),
          onClose: () => {
            bubble = null;
          },
        });
        bubble.update(state, translateBusy, showTranslatePrompt, pageTranslator.getLastError());
      }

      async function handleTranslateClick(): Promise<void> {
        translateBusy = true;
        syncBubble();
        await configStore.onReady();
        await pageTranslator.translatePage(configStore.get('targetLanguage'));
        translateBusy = false;
        syncBubble();
      }

      // Reopens on every translate (including a re-translate over a
      // manually-closed bubble) — closing is a per-view dismissal, not a
      // permanent opt-out; a persistent "don't show again" preference is
      // a documented follow-up, not built here.
      pageTranslator.onStateChange(() => {
        translateBusy = false;
        syncBubble();
      });
      // A translate call can keep failing silently in the background long
      // after the state-change above already fired (see translateLoop.ts's
      // consecutive-failure guard) — this is the surface that reflects it.
      pageTranslator.onError(() => {
        syncBubble();
      });
      mobileViewportQuery.addEventListener('change', syncBubble);
      syncBubble();

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
