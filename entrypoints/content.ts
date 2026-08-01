import { createPageTranslator, type PageLanguageState } from '../src/engine/pageTranslator/translateLoop';
import { getBatchingHint } from '../src/engine/providers/descriptors';
import { configStore } from '../src/platform/configStore';
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
