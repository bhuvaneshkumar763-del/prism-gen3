import { mountBubble } from '../components/bubble/mountBubble';
import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { onMessage } from '../src/platform/messaging/protocol';
import { createOriginalLanguageTracker } from '../src/platform/originalLanguageTracker';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';

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
 * always/never-translate-sites/langs config lists. Main-frame only for now
 * — see `originalLanguageTracker.ts`'s header comment for why iframes are a
 * documented gap, not a silent one.
 *
 * Session 6: `pageTranslate`/`pageRestore`/`getPageState` are now declared
 * via the typed protocol's `onMessage()` (`src/platform/messaging/protocol.ts`)
 * instead of a hand-rolled `browser.runtime.onMessage` listener with
 * manual type guards — both the popup and `background.ts`'s context-menu/
 * keyboard-command handlers send these same 3 message types.
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

    // The floating bubble (components/bubble/) only makes sense in the
    // main frame — an iframe translating independently doesn't need its
    // own bubble UI stacked on top of the main page's. Reopens on every
    // translate (including a re-translate over a manually-closed bubble)
    // — closing is a per-translation dismissal, not a permanent opt-out;
    // a persistent "don't show again" preference is a documented
    // follow-up, not built here.
    if (window.self === window.top) {
      let bubble: ReturnType<typeof mountBubble> | null = null;

      pageTranslator.onStateChange((state) => {
        if (state === 'translated') {
          bubble ??= mountBubble(
            () => pageTranslator.restorePage(),
            () => {
              bubble = null;
            },
          );
          bubble.update('translated', false);
        } else {
          bubble?.unmount();
          bubble = null;
        }
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
