import { createProvider, type ProviderConfig } from '../src/engine/providers/registry';
import { translateOne } from '../src/engine/translator';
import { configStore } from '../src/platform/configStore';
import { isTranslatePiecesMessage } from '../src/platform/remoteTranslator';

/**
 * Session 2's minimal vertical slice: exactly one message type
 * ("translateText"). A real typed messaging protocol (matching the old
 * repo's @webext-core/messaging pattern, but redesigned to fix its
 * tab-targeting duplication — see the Gen 3 plan) lands in Session 6 once
 * there are enough real message types to design well against.
 *
 * Session 4 update: provider selection now goes through
 * `registry.createProvider()` and the config store's real per-provider
 * fields (`pageTranslatorProvider` picks which one), instead of hardcoding
 * LibreTranslate.
 *
 * Session 5 update: a second message type, `translatePieces`, is the
 * backing for `src/platform/remoteTranslator.ts` — the real full-page
 * translation engine (`src/engine/pageTranslator/translateLoop.ts`) sends
 * its grouped/chunked pieces here and gets back one `PieceOutcome` per
 * piece, using the exact same provider-selection logic as `translateText`.
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

function buildProviderConfig(): ProviderConfig {
  const llmBaseUrl = configStore.get('llmBaseUrl');
  const llmApiKey = configStore.get('llmApiKey');
  const llmModel = configStore.get('llmModel');
  const googleCloudTranslateApiKey = configStore.get('googleCloudTranslateApiKey');

  return {
    libretranslate: {
      baseUrl: configStore.get('libreTranslateBaseUrl'),
      apiKey: configStore.get('libreTranslateApiKey') || undefined,
    },
    google: {},
    googleCloudTranslate: googleCloudTranslateApiKey ? { apiKey: googleCloudTranslateApiKey } : undefined,
    llm: llmBaseUrl && llmApiKey && llmModel ? { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel } : undefined,
    builtin: {},
  };
}

async function resolveActiveProvider() {
  await configStore.onReady();
  const providerId = configStore.get('pageTranslatorProvider');
  const provider = createProvider(providerId, buildProviderConfig());
  return { providerId, provider };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isTranslateTextMessage(message)) {
      (async () => {
        const { providerId, provider } = await resolveActiveProvider();
        if (!provider) {
          sendResponse({
            ok: false,
            error: { kind: 'network', message: `[${providerId}] not configured or unavailable` },
          });
          return;
        }
        const result = await translateOne(provider, message.text, message.sourceLanguage, message.targetLanguage);
        sendResponse(result);
      })();
      return true; // keep the message channel open for the async sendResponse above
    }

    if (isTranslatePiecesMessage(message)) {
      (async () => {
        const { providerId, provider } = await resolveActiveProvider();
        if (!provider) {
          const error = { kind: 'network' as const, message: `[${providerId}] not configured or unavailable` };
          sendResponse(message.pieces.map(() => ({ ok: false, error })));
          return;
        }
        const outcomes = await provider.translateBatch({
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          pieces: message.pieces,
          dontSortResults: message.dontSortResults,
        });
        sendResponse(outcomes);
      })();
      return true;
    }

    return undefined;
  });
});
