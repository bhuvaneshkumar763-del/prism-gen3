import {
  type AuthKeySnapshot,
  ensureAuthReady,
  getAuthKeySnapshot,
  hydrateAuthKey,
} from '../src/engine/providers/google';
import { createProvider, type ProviderConfig } from '../src/engine/providers/registry';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../src/engine/translator';
import { translateOne } from '../src/engine/translator';
import { cacheKeyFor, translationCache } from '../src/platform/cache/translationCache';
import { configStore } from '../src/platform/configStore';
import type { FrameLanguageDecision } from '../src/platform/messaging/protocol';
import { onTrustedMessage, sendMessage } from '../src/platform/messaging/protocol';
import { getActiveTabId } from '../src/platform/messaging/tabTarget';
import { missingProviderSetup } from '../src/shared/config/providerSetup';
import { TOGGLE_TRANSLATE_COMMAND } from '../src/shared/shortcut';

/**
 * Service worker: translates for content scripts over the typed messaging
 * protocol and hosts the context-menu and keyboard-command entry points.
 * `translatePieces` goes through the per-piece cache; `translateText`
 * (selection popup, title translator) deliberately does not.
 */
const KEEPALIVE_ALARM_NAME = 'prism-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.4; // 24 s unpacked; Chrome clamps packed builds' periodic alarms to 30 s.

/**
 * MV3 keepalive: Chrome suspends an idle worker after ~30 s, which can kill a
 * translate mid-request (retries/backoff). Each alarm event resets that idle
 * timer, so the alarm runs only while a translate is in flight. A worker
 * restart loses in-flight work too, so this counter restarting at 0 is correct.
 */
let activeTranslateCount = 0;

function registerKeepaliveListener(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEPALIVE_ALARM_NAME) return;
    // Stop once nothing is in flight. Otherwise the empty handler is the
    // point: delivering the event is what resets the idle timer.
    if (activeTranslateCount === 0) void browser.alarms.clear(KEEPALIVE_ALARM_NAME);
  });
}

function beginTranslateActivity(): void {
  activeTranslateCount++;
  if (activeTranslateCount === 1)
    browser.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: KEEPALIVE_INTERVAL_MINUTES });
}

function endTranslateActivity(): void {
  activeTranslateCount = Math.max(0, activeTranslateCount - 1);
}

function buildProviderConfig(): ProviderConfig {
  const fields = {
    googleCloudTranslateApiKey: configStore.get('googleCloudTranslateApiKey'),
  };
  // "Configured" is decided by the same rule the UI uses to show "needs
  // setup" (missingProviderSetup), so the two can't disagree.
  return {
    google: {},
    googleCloudTranslate:
      missingProviderSetup('googleCloudTranslate', fields) === null
        ? { apiKey: fields.googleCloudTranslateApiKey }
        : undefined,
  };
}

// Memoized per worker lifetime: the batched provider's concurrency cap and
// in-flight dedupe live in its closure, so every tab must share one instance.
// The fingerprint picks up settings changes (API key, provider).
let cachedProvider: { providerId: string; fingerprint: string; provider: Translator | null } | null = null;

function providerFingerprint(providerId: string, config: ProviderConfig): string {
  return JSON.stringify(config[providerId as keyof ProviderConfig] ?? null);
}

async function resolveActiveProvider() {
  await configStore.onReady();
  const providerId = configStore.get('pageTranslatorProvider');
  const config = buildProviderConfig();
  const fingerprint = providerFingerprint(providerId, config);

  if (!cachedProvider || cachedProvider.providerId !== providerId || cachedProvider.fingerprint !== fingerprint) {
    cachedProvider = { providerId, fingerprint, provider: createProvider(providerId, config) };
  }
  return { providerId, provider: cachedProvider.provider };
}

/**
 * Each tab's main-frame auto-translate decision, inherited by same-origin
 * sub-frames. Cleared on navigation start and tab close; it also carries
 * `mainFrameOrigin` so a sub-frame that polls early rejects a stale entry.
 */
const frameLanguageDecisions = new Map<number, FrameLanguageDecision>();

const TRANSLATE_MENU_ID = 'prism-translate-page';
const RESTORE_MENU_ID = 'prism-show-original';
/** Gives keyboard users (Shift+F10) and anyone who dismissed the floating button a way to translate a selection. */
const TRANSLATE_SELECTION_MENU_ID = 'prism-translate-selection';

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

function unavailableMessage(providerId: string): string {
  return `[${providerId}] not configured or unavailable`;
}

/**
 * Context-menu and shortcut actions are fire-and-forget. When the tab has no
 * content script (chrome:// pages, PDF viewer, tabs predating install), a
 * toolbar badge is the only visible sign of failure and needs no permission.
 */
const FAILURE_BADGE_MS = 3000;

function showFailureBadge(e: unknown): void {
  console.warn('[prism] page action failed', e);
  void browser.action.setBadgeBackgroundColor({ color: '#d93025' });
  void browser.action.setBadgeText({ text: '!' });
  setTimeout(() => {
    void browser.action.setBadgeText({ text: '' });
  }, FAILURE_BADGE_MS);
}

const GOOGLE_AUTH_STORAGE_KEY = 'googleAuthKeySnapshot';

/**
 * Warms Google's auth key at startup, off the first translate's critical
 * path, and keeps it in `storage.session` (cleared on browser close) so it
 * survives MV3 worker restarts. Best-effort: `google.ts` still fetches lazily.
 */
async function prefetchGoogleAuthKey(): Promise<void> {
  try {
    // Users on another provider shouldn't contact Google at all.
    await configStore.onReady();
    if (configStore.get('pageTranslatorProvider') !== 'google') return;

    const stored = await browser.storage.session.get(GOOGLE_AUTH_STORAGE_KEY);
    const snapshot = stored[GOOGLE_AUTH_STORAGE_KEY] as AuthKeySnapshot | undefined;
    // Stored data may come from another extension version; check its shape.
    if (snapshot && typeof snapshot.key === 'string' && typeof snapshot.time === 'number') {
      hydrateAuthKey(snapshot);
    }

    await ensureAuthReady();

    const fresh = getAuthKeySnapshot();
    if (fresh) await browser.storage.session.set({ [GOOGLE_AUTH_STORAGE_KEY]: fresh });
  } catch (e) {
    console.warn('[prism] speculative Google auth-key prefetch failed, continuing without it', e);
  }
}

export default defineBackground(() => {
  // No `persistent: false` option here: a non-persistent page is suspected (not
  // verified) of being suspended mid-request in MV2 browsers that load this
  // package directly, such as Orion. Safari requires it; see scripts/sync-safari.mjs.
  registerKeepaliveListener();
  void prefetchGoogleAuthKey();

  onTrustedMessage('translateText', async (message) => {
    beginTranslateActivity();
    try {
      const { providerId, provider } = await resolveActiveProvider();
      if (!provider) {
        return { ok: false, error: { kind: 'network', message: unavailableMessage(providerId) } };
      }
      return await translateOne(provider, message.data.text, message.data.sourceLanguage, message.data.targetLanguage);
    } finally {
      endTranslateActivity();
    }
  });

  onTrustedMessage('translatePieces', async (message) => {
    beginTranslateActivity();
    try {
      return await translatePiecesWithCache(message.data, message.sender);
    } finally {
      endTranslateActivity();
    }
  });

  async function translatePiecesWithCache(
    data: TranslateBatchRequest & { requestId: number },
    sender: Browser.runtime.MessageSender,
  ): Promise<PieceOutcome[]> {
    const { providerId, provider } = await resolveActiveProvider();
    const { sourceLanguage, targetLanguage, pieces, dontSortResults, requestId } = data;

    if (!provider) {
      const error = { kind: 'network' as const, message: unavailableMessage(providerId) };
      return pieces.map(() => ({ ok: false, error }));
    }

    // One worker serves normal and incognito windows ("spanning" mode), so an
    // incognito translate skips the cache entirely: it neither writes page text
    // into the normal profile's IndexedDB nor reads from it.
    const cacheEnabled = configStore.get('translationCacheEnabled') && !sender.tab?.incognito;
    const pieceKeys = pieces.map((piece) =>
      cacheKeyFor(providerId, sourceLanguage, targetLanguage, JSON.stringify(piece)),
    );
    // The cache is only an optimization: a failed read or unparseable entry is
    // a miss, and a failed write is a no-op. getMany() reads every key in one
    // IndexedDB transaction.
    const rawCachedValues = cacheEnabled
      ? await translationCache.getMany(pieceKeys).catch((e) => {
          console.warn('[prism] translation cache read failed, treating every piece as a cache miss', e);
          return pieces.map(() => null);
        })
      : pieces.map(() => null);
    const cachedValues: Array<string[] | null> = rawCachedValues.map((raw) => {
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as string[];
      } catch (e) {
        console.warn('[prism] cached entry failed to parse, treating as a cache miss', e);
        return null;
      }
    });

    const missingIndices: number[] = [];
    pieces.forEach((_, i) => {
      if (cachedValues[i] === null) missingIndices.push(i);
    });

    let freshOutcomes: PieceOutcome[] = [];
    if (missingIndices.length > 0) {
      const missingPieces = missingIndices
        .map((i) => pieces[i])
        .filter((p): p is (typeof pieces)[number] => p !== undefined);
      // Streams each fresh piece back to the requesting frame as it resolves
      // (a callback can't cross the messaging boundary; see remoteTranslator.ts).
      // `missingIndices` maps it back to the original request's index.
      // Best-effort: the returned outcomes still carry every piece.
      const tabId = sender.tab?.id;
      freshOutcomes = await provider.translateBatch({
        sourceLanguage,
        targetLanguage,
        pieces: missingPieces,
        dontSortResults,
        onPieceComplete:
          tabId === undefined
            ? undefined
            : (missingIdx, outcome) => {
                const index = missingIndices[missingIdx];
                if (index === undefined) return;
                void sendMessage(
                  'translatePiecesProgress',
                  { requestId, index, outcome },
                  { tabId, frameId: sender.frameId },
                ).catch(() => {
                  // Tab/frame gone; the final reply still carries this piece.
                });
              },
      });
    }

    // O(1) lookup per piece instead of indexOf(); on a cold or disabled cache
    // every piece is missing.
    const missingIdxByPiece = new Map(missingIndices.map((i, idx) => [i, idx]));

    const outcomes: PieceOutcome[] = pieces.map((_, i) => {
      const cached = cachedValues[i];
      if (cached !== null && cached !== undefined) return { ok: true, value: cached };
      const missingIdx = missingIdxByPiece.get(i);
      const fresh = missingIdx !== undefined ? freshOutcomes[missingIdx] : undefined;
      return fresh ?? { ok: false, error: { kind: 'parse', message: 'no result for this piece' } };
    });

    if (cacheEnabled) {
      // setMany(): one transaction and one eviction pass for all fresh pieces.
      const freshEntries = missingIndices
        .map((i, idx) => {
          const outcome = freshOutcomes[idx];
          const key = pieceKeys[i];
          return outcome?.ok && key ? { key, value: JSON.stringify(outcome.value) } : null;
        })
        .filter((e): e is { key: string; value: string } => e !== null);
      // Not awaited: the reply the page is waiting on shouldn't sit behind the
      // IndexedDB commit and eviction (a full store scan on a cold worker).
      void translationCache.setMany(freshEntries).catch((e) => {
        console.warn('[prism] translation cache write failed, continuing without caching these pieces', e);
      });
    }

    return outcomes;
  }

  // Context-menu items outlive the worker, which re-runs this file on every
  // wake, so they're created only on install/update. Reading lastError
  // silences the duplicate-id error an update can still raise.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: TRANSLATE_MENU_ID, title: 'Translate this page', contexts: ['page'] }, () => {
      void browser.runtime.lastError;
    });
    browser.contextMenus.create({ id: RESTORE_MENU_ID, title: 'Show original text', contexts: ['page'] }, () => {
      void browser.runtime.lastError;
    });
    // %s is replaced by the browser with the selected text.
    browser.contextMenus.create(
      { id: TRANSLATE_SELECTION_MENU_ID, title: 'Translate “%s”', contexts: ['selection'] },
      () => {
        void browser.runtime.lastError;
      },
    );
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === TRANSLATE_MENU_ID) translateActiveTab().catch(showFailureBadge);
    if (info.menuItemId === RESTORE_MENU_ID) restoreActiveTab().catch(showFailureBadge);
    if (info.menuItemId === TRANSLATE_SELECTION_MENU_ID) {
      const text = info.selectionText?.trim();
      if (text && tab?.id !== undefined) {
        sendMessage('translateSelection', { text }, tab.id).catch(showFailureBadge);
      }
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === TOGGLE_TRANSLATE_COMMAND) toggleActiveTab().catch(showFailureBadge);
  });

  onTrustedMessage('openOptionsPage', (message) => {
    const section = message.data?.section;
    // openOptionsPage() can't carry a URL fragment, so a specific section
    // opens as a tab. Restricted to a plain word: it only ever names a tab.
    if (section && /^[a-z]+$/.test(section)) {
      void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#${section}` });
    } else {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    frameLanguageDecisions.delete(tabId);
  });

  // Drop the tab's decision as soon as a top-level navigation starts (needs
  // only `changeInfo.status`, no extra permission). The `mainFrameOrigin`
  // check in content.ts covers the race this can't close.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') frameLanguageDecisions.delete(tabId);
  });

  onTrustedMessage('reportFrameLanguageDecision', (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId === undefined) return;
    frameLanguageDecisions.set(tabId, message.data);
  });

  onTrustedMessage('getFrameLanguageDecision', (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId === undefined) return null;
    return frameLanguageDecisions.get(tabId) ?? null;
  });

  onTrustedMessage('detectTabLanguage', async (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId === undefined) return 'und';
    try {
      return (await browser.tabs.detectLanguage(tabId)) || 'und';
    } catch (e) {
      console.warn('[prism] tabs.detectLanguage failed', e);
      return 'und';
    }
  });
});
