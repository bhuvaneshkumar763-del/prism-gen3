import { shouldAutoTranslateOnLoad } from '../src/engine/pageTranslator/autoTranslateDecision';
import { createPageTranslator, type PageLanguageState } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
import { createOriginalLanguageTracker } from '../src/platform/originalLanguageTracker';
import { createRemoteTranslator } from '../src/platform/remoteTranslator';

/**
 * Wires the real page-translation engine (Session 5:
 * `src/engine/pageTranslator/translateLoop.ts`) into a live content
 * script. Replaces Session 2's single-hardcoded-`<p>` demo — this now
 * translates (and restores) the whole page, keeps watching for new/changed
 * content, and picks its chunking strategy per the active provider's
 * `batchingHint` (see `descriptors.ts`/`grouping.ts`).
 *
 * The engine itself never touches `browser.*` — `createRemoteTranslator()`
 * (src/platform/remoteTranslator.ts) is the one adapter bridging it to
 * `browser.runtime.sendMessage`, and `configStore` supplies the current
 * provider/source-language selection.
 *
 * Auto-translate-on-load (also Session 5): detects the page's language via
 * `originalLanguageTracker`, then defers the actual yes/no call to the pure
 * `shouldAutoTranslateOnLoad` decision function against the current
 * always/never-translate-sites/langs config lists. Main-frame only for now
 * — see `originalLanguageTracker.ts`'s header comment for why iframes are a
 * documented gap, not a silent one.
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

    interface PageTranslateMessage {
      type: 'pageTranslate';
      targetLanguage: string;
    }
    interface PageRestoreMessage {
      type: 'pageRestore';
    }
    interface GetPageStateMessage {
      type: 'getPageState';
    }

    function isPageTranslateMessage(message: unknown): message is PageTranslateMessage {
      return (
        typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'pageTranslate'
      );
    }
    function isPageRestoreMessage(message: unknown): message is PageRestoreMessage {
      return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'pageRestore';
    }
    function isGetPageStateMessage(message: unknown): message is GetPageStateMessage {
      return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'getPageState';
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isPageTranslateMessage(message)) {
        (async () => {
          await configStore.onReady();
          await pageTranslator.translatePage(message.targetLanguage);
          sendResponse(pageTranslator.getState() satisfies PageLanguageState);
        })();
        return true;
      }
      if (isPageRestoreMessage(message)) {
        pageTranslator.restorePage();
        sendResponse(pageTranslator.getState() satisfies PageLanguageState);
        return false;
      }
      if (isGetPageStateMessage(message)) {
        sendResponse(pageTranslator.getState() satisfies PageLanguageState);
        return false;
      }
      return undefined;
    });
  },
});
