import { createProvider, type ProviderConfig } from '../src/engine/providers/registry';
import type { PieceOutcome } from '../src/engine/translator';
import { translateOne } from '../src/engine/translator';
import { cacheKeyFor, translationCache } from '../src/platform/cache/translationCache';
import { configStore } from '../src/platform/configStore';
import { onMessage, sendMessage } from '../src/platform/messaging/protocol';
import { getActiveTabId } from '../src/platform/messaging/tabTarget';

/**
 * Session 6: rewired onto the typed messaging protocol
 * (`src/platform/messaging/protocol.ts`) — `translateText`/`translatePieces`
 * handlers declared via `onMessage()` instead of a hand-rolled
 * `browser.runtime.onMessage` listener with type guards. Also adds the
 * context-menu and keyboard-command entry points for full-page
 * translate/restore, both going through `getActiveTabId()`
 * (`tabTarget.ts`) — the same helper `popup/App.tsx` uses.
 *
 * Session 7: `translatePieces` checks `translationCache`
 * (`src/platform/cache/translationCache.ts`) before hitting the provider —
 * cache key is the provider + language pair + the piece's own text (a
 * JSON-stringified string array, since a piece can hold more than one
 * grouped string). Only the pieces that miss actually get sent to the
 * provider; fresh results are written back for next time. `translateText`
 * deliberately does NOT go through the cache — it backs the selection
 * popup and title translator, both already have their own narrower
 * caching (title translator: an in-memory 50-entry cache; selection: a
 * one-off translation the user just asked for, no repeat-request pattern
 * to optimize).
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
    const { sourceLanguage, targetLanguage, pieces, dontSortResults } = message.data;

    if (!provider) {
      const error = { kind: 'network' as const, message: `[${providerId}] not configured or unavailable` };
      return pieces.map(() => ({ ok: false, error }));
    }

    const pieceKeys = pieces.map((piece) =>
      cacheKeyFor(providerId, sourceLanguage, targetLanguage, JSON.stringify(piece)),
    );
    const cachedValues = await Promise.all(pieceKeys.map((key) => translationCache.get(key)));

    const missingIndices: number[] = [];
    pieces.forEach((_, i) => {
      if (cachedValues[i] === null) missingIndices.push(i);
    });

    let freshOutcomes: PieceOutcome[] = [];
    if (missingIndices.length > 0) {
      const missingPieces = missingIndices
        .map((i) => pieces[i])
        .filter((p): p is (typeof pieces)[number] => p !== undefined);
      freshOutcomes = await provider.translateBatch({
        sourceLanguage,
        targetLanguage,
        pieces: missingPieces,
        dontSortResults,
      });
    }

    const outcomes: PieceOutcome[] = pieces.map((_, i) => {
      const cached = cachedValues[i];
      if (cached !== null && cached !== undefined) return { ok: true, value: JSON.parse(cached) };
      const missingIdx = missingIndices.indexOf(i);
      return freshOutcomes[missingIdx] ?? { ok: false, error: { kind: 'parse', message: 'no result for this piece' } };
    });

    await Promise.all(
      missingIndices.map(async (i, idx) => {
        const outcome = freshOutcomes[idx];
        const key = pieceKeys[i];
        if (outcome?.ok && key) await translationCache.set(key, JSON.stringify(outcome.value));
      }),
    );

    return outcomes;
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
