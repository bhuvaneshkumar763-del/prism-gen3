import {
  type AuthKeySnapshot,
  ensureAuthReady,
  getAuthKeySnapshot,
  hydrateAuthKey,
} from '../src/engine/providers/google';
import { createProvider } from '../src/engine/providers/registry';
import { translationCache } from '../src/platform/cache/translationCache';
import { configStore } from '../src/platform/configStore';
import type { FrameLanguageDecision } from '../src/platform/messaging/protocol';
import { onTrustedMessage, sendMessage } from '../src/platform/messaging/protocol';
import { getActiveTabId } from '../src/platform/messaging/tabTarget';
import {
  createProviderResolver,
  translatePiecesWithCache,
  translateTextWithProvider,
} from '../src/platform/pieceTranslation';
import { type OpenExtensionTab, planOpenSettings } from '../src/shared/settingsTab';
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

// One resolver per worker lifetime, so every tab shares one provider instance.
const resolveActiveProvider = createProviderResolver(configStore, createProvider);

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
      return await translateTextWithProvider(resolveActiveProvider, message.data);
    } finally {
      endTranslateActivity();
    }
  });

  onTrustedMessage('translatePieces', async (message) => {
    beginTranslateActivity();
    try {
      return await translatePiecesWithCache(message.data, message.sender, {
        resolveProvider: resolveActiveProvider,
        config: configStore,
        cache: translationCache,
        sendProgress: (data, target) => sendMessage('translatePiecesProgress', data, target),
      });
    } finally {
      endTranslateActivity();
    }
  });

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
    void openSettings(message.data?.section);
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

/**
 * The extension's own pages open in tabs, or null when this browser can't
 * list them. Without the `tabs` permission a URL query sees nothing in Chrome,
 * but `runtime.getContexts` (Chrome 116+) lists them; the query is the
 * fallback where that's missing, and counts only if it finds something.
 */
async function openExtensionTabs(optionsUrl: string): Promise<OpenExtensionTab[] | null> {
  try {
    if (typeof browser.runtime.getContexts === 'function') {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['TAB' as Browser.runtime.ContextType] });
      return contexts
        .filter((c) => c.tabId >= 0)
        .map((c) => ({ tabId: c.tabId, windowId: c.windowId, url: c.documentUrl }));
    }
    const tabs = await browser.tabs.query({ url: `${optionsUrl}*` });
    const found = tabs.flatMap((t) => (t.id === undefined ? [] : [{ tabId: t.id, windowId: t.windowId, url: t.url }]));
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

/** Shows Settings (at `section`, if given), reusing an open Settings tab instead of adding another. */
async function openSettings(section: string | undefined): Promise<void> {
  const optionsUrl = browser.runtime.getURL('/options.html');
  const openTabs = await openExtensionTabs(optionsUrl);
  const plan = planOpenSettings(openTabs ?? [], optionsUrl, section, { canSeeOpenTabs: openTabs !== null });
  try {
    if (plan.kind === 'focus') {
      await browser.tabs.update(plan.tabId, plan.url ? { active: true, url: plan.url } : { active: true });
      // Phones have no windows API to focus with; the tab switch is enough there.
      if (plan.windowId !== undefined) await browser.windows?.update(plan.windowId, { focused: true }).catch(() => {});
      return;
    }
    if (plan.kind === 'create') {
      await browser.tabs.create({ url: plan.url });
      return;
    }
    await browser.runtime.openOptionsPage();
  } catch {
    // The Settings tab closed in between: open a fresh one.
    if (plan.kind === 'focus') await browser.tabs.create({ url: plan.url ?? optionsUrl }).catch(() => {});
  }
}
