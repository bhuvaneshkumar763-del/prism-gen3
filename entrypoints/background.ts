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
 *
 * Post-launch UI-depth pass, Phase 3: `translationCacheEnabled` (settings
 * page toggle) actually skips both the cache read and the cache write when
 * off — not a checkbox with no wiring behind it.
 *
 * Session 8 (hardening pass): MV3 keepalive via chrome.alarms. A service
 * worker with no pending listener callback is eligible for suspension by
 * Chrome after ~30s of idle time — a translatePieces call involving
 * several provider round trips (retries/backoff in
 * batchedHttpProvider.ts) can outlast that window, which would kill the
 * in-flight request with no error surfaced to the page. A recurring
 * chrome.alarms alarm is the standard MV3 workaround: alarms fire even on
 * a suspended worker (Chrome wakes it to deliver the event), and simply
 * having a live alarms.onAlarm listener keeps the worker classified as
 * active in between. The interval is deliberately short (under the ~30s
 * idle threshold) — a longer period would let the worker suspend in the
 * gap anyway, defeating the point.
 */
const KEEPALIVE_ALARM_NAME = 'prism-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.4; // 24s — under Chrome's ~30s idle-suspend window

function setupKeepalive(): void {
  browser.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: KEEPALIVE_INTERVAL_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM_NAME) {
      // Intentionally a no-op body — the listener's mere existence, and
      // Chrome waking the worker to invoke it, is the keepalive mechanism.
    }
  });
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
  setupKeepalive();

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

    const cacheEnabled = configStore.get('translationCacheEnabled');
    const pieceKeys = pieces.map((piece) =>
      cacheKeyFor(providerId, sourceLanguage, targetLanguage, JSON.stringify(piece)),
    );
    // Caching is purely an optimization — a cache-layer failure (a closed
    // IndexedDB connection, a quota/permission issue) must never break an
    // otherwise-successful translation. Treat a failed read as a cache
    // miss (falls through to a live provider call below) and a failed
    // write as a no-op, both logged but not propagated.
    const cachedValues = cacheEnabled
      ? await Promise.all(
          pieceKeys.map((key) =>
            translationCache.get(key).catch((e) => {
              console.warn('[prism] translation cache read failed, treating as a cache miss', e);
              return null;
            }),
          ),
        )
      : pieces.map(() => null);

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

    if (cacheEnabled) {
      await Promise.all(
        missingIndices.map(async (i, idx) => {
          const outcome = freshOutcomes[idx];
          const key = pieceKeys[i];
          if (!outcome?.ok || !key) return;
          try {
            await translationCache.set(key, JSON.stringify(outcome.value));
          } catch (e) {
            console.warn('[prism] translation cache write failed, continuing without caching this piece', e);
          }
        }),
      );
    }

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

  onMessage('openOptionsPage', () => {
    void browser.runtime.openOptionsPage();
  });
});
