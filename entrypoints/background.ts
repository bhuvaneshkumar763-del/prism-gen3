import { createLibreTranslateProvider } from '../src/engine/providers/libretranslate';
import { configStore } from '../src/platform/configStore';

/**
 * Session 2's minimal vertical slice: exactly one message type
 * ("translateText"). A real typed messaging protocol (matching the old
 * repo's @webext-core/messaging pattern, but redesigned to fix its
 * tab-targeting duplication — see the Gen 3 plan) lands in Session 6 once
 * there are enough real message types to design well against.
 */
interface TranslateTextMessage {
  type: 'translateText';
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

function isTranslateTextMessage(message: unknown): message is TranslateTextMessage {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'translateText';
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isTranslateTextMessage(message)) return undefined;

    (async () => {
      await configStore.onReady();
      const provider = createLibreTranslateProvider({
        baseUrl: configStore.get('providerBaseUrl'),
        apiKey: configStore.get('providerApiKey') || undefined,
      });
      const result = await provider.translate({
        text: message.text,
        sourceLanguage: message.sourceLanguage,
        targetLanguage: message.targetLanguage,
      });
      sendResponse(result);
    })();

    return true; // keep the message channel open for the async sendResponse above
  });
});
