import { createProvider, type ProviderConfig } from '../src/engine/providers/registry';
import { translateOne } from '../src/engine/translator';
import { configStore } from '../src/platform/configStore';
import { onMessage, sendMessage } from '../src/platform/messaging/protocol';
import { getActiveTabId } from '../src/platform/messaging/tabTarget';

/**
 * Session 6 update: rewired onto the typed messaging protocol
 * (`src/platform/messaging/protocol.ts`) — `translateText`/`translatePieces`
 * handlers are unchanged in behavior, just declared via `onMessage()`
 * instead of a hand-rolled `browser.runtime.onMessage` listener with type
 * guards. Also adds the context-menu and keyboard-command entry points for
 * full-page translate/restore, both going through `getActiveTabId()`
 * (`tabTarget.ts`) — the same helper `popup/App.tsx` uses, so tab-lookup
 * logic exists in exactly one place, not hand-duplicated per entry point
 * (the exact smell the Gen 3 plan called out in the old repo).
 */

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

const TRANSLATE_MENU_ID = 'prism-translate-page';
const RESTORE_MENU_ID = 'prism-show-original';

async function translateActiveTab(): Promise<void> {
  await configStore.onReady();
  const tabId = await getActiveTabId();
  await sendMessage('pageTranslate', { targetLanguage: configStore.get('targetLanguage') }, tabId);
}

async function restoreActiveTab(): Promise<void> {
  const tabId = await getActiveTabId();
  await sendMessage('pageRestore', undefined, tabId);
}

/** Toggles based on the active tab's current state — used by the keyboard command, where there's no separate "translate" vs "restore" affordance to pick from. */
async function toggleActiveTab(): Promise<void> {
  const tabId = await getActiveTabId();
  const state = await sendMessage('getPageState', undefined, tabId);
  if (state === 'translated') {
    await sendMessage('pageRestore', undefined, tabId);
  } else {
    await configStore.onReady();
    await sendMessage('pageTranslate', { targetLanguage: configStore.get('targetLanguage') }, tabId);
  }
}

export default defineBackground(() => {
  onMessage('translateText', async (message) => {
    const { providerId, provider } = await resolveActiveProvider();
    if (!provider) {
      return { ok: false, error: { kind: 'network', message: `[${providerId}] not configured or unavailable` } };
    }
    return translateOne(provider, message.data.text, message.data.sourceLanguage, message.data.targetLanguage);
  });

  onMessage('translatePieces', async (message) => {
    const { providerId, provider } = await resolveActiveProvider();
    if (!provider) {
      const error = { kind: 'network' as const, message: `[${providerId}] not configured or unavailable` };
      return message.data.pieces.map(() => ({ ok: false, error }));
    }
    return provider.translateBatch(message.data);
  });

  browser.contextMenus.create({
    id: TRANSLATE_MENU_ID,
    title: 'Translate this page',
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: RESTORE_MENU_ID,
    title: 'Show original text',
    contexts: ['page'],
  });
  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === TRANSLATE_MENU_ID) void translateActiveTab();
    if (info.menuItemId === RESTORE_MENU_ID) void restoreActiveTab();
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translate-page') void toggleActiveTab();
  });
});
