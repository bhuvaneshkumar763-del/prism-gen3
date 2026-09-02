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
import { isTrustedSender, onMessage, sendMessage } from '../src/platform/messaging/protocol';
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
const KEEPALIVE_INTERVAL_MINUTES = 0.4; // 24s — verified directly against real Chrome (chrome.alarms.getAll()'s reported scheduledTime advanced in exact 24s steps across 12 samples over ~110s) — NOT clamped to a 1-minute floor, despite that being a real risk worth checking rather than assuming.

/**
 * Speed fix, found via audit: this alarm used to be created ONCE at
 * startup and left running for the entire browser session — waking the
 * service worker every 24s, ~2,880 times a day, for as long as the
 * browser stays open, even for a user who never translates anything in
 * that session. The alarm only needs to exist while a translate request
 * could actually be in flight (its whole purpose — see the module
 * comment above — is bridging Chrome's ~30s idle-suspend window during a
 * real `translatePieces`/`translateText` call's retries/backoff). Now
 * created lazily when a translate handler starts and cleared once none
 * are in flight, tracked via this plain in-memory counter — safe because
 * a service worker with an ACTIVE, PENDING listener invocation (which is
 * exactly what "a translate is in flight" means here) is never torn down
 * by Chrome mid-call; the only time this counter's state could be lost
 * to a worker restart is when it's already back at 0, which is the
 * correct state to restart into anyway.
 */
let activeTranslateCount = 0;

function registerKeepaliveListener(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEPALIVE_ALARM_NAME) return;
    // Self-terminating: if nothing is in flight by the time this fires
    // (the common case — most fires happen mid-request, but the last one
    // after a request just finished has nothing left to bridge), stop
    // rescheduling instead of waking the worker again for no reason.
    // Otherwise a no-op body is the whole mechanism — the listener's mere
    // existence, and Chrome waking the worker to invoke it, is what keeps
    // an in-flight request's idle clock from expiring.
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
  const llmBaseUrl = configStore.get('llmBaseUrl');
  const llmApiKey = configStore.get('llmApiKey');
  const llmModel = configStore.get('llmModel');
  const googleCloudTranslateApiKey = configStore.get('googleCloudTranslateApiKey');

  return {
    google: {},
    googleCloudTranslate: googleCloudTranslateApiKey ? { apiKey: googleCloudTranslateApiKey } : undefined,
    llm: llmBaseUrl && llmApiKey && llmModel ? { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel } : undefined,
  };
}

// Memoized per worker lifetime instead of constructed fresh on every
// message. A fresh createProvider() call gets a fresh
// createBatchedHttpProvider() closure, and that closure is where the
// maxConcurrent cap and inFlightByKey dedupe actually live (see
// batchedHttpProvider.ts) — reconstructing it per-message meant every
// concurrent message (e.g. several tabs translating at once) got its OWN
// independent rate limiter instead of sharing one, so 3 tabs could fire up
// to 3x the intended concurrent request count at the provider. The
// fingerprint check still picks up a live settings change (new API key,
// switched provider) without needing a separate configStore.onChanged wire-up.
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
 * A tab's main frame's auto-translate-on-load decision, so a same-origin
 * iframe in the same tab can inherit it instead of running its own
 * independent detection — real gap: `all_frames` was never enabled at all,
 * so no iframe got a decision, translated or not. Not cleared explicitly
 * on navigation — the main frame overwrites its own entry on every fresh
 * load, so a stale entry only matters for the brief window before that
 * happens, and `getFrameLanguageDecision` callers already retry briefly
 * rather than trusting a single query. Cleared on tab close (below) so
 * this doesn't grow unbounded over a long browser session.
 */
const frameLanguageDecisions = new Map<number, FrameLanguageDecision>();

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

function unavailableMessage(providerId: string): string {
  return `[${providerId}] not configured or unavailable`;
}

/**
 * The context menu and keyboard shortcut invoke translateActiveTab/
 * restoreActiveTab/toggleActiveTab fire-and-forget — a rejected
 * sendMessage (no content script on that tab: a chrome:// page, a PDF
 * viewer, a tab that predates install) used to produce nothing visible
 * anywhere. A brief toolbar-icon badge needs no new permission (the
 * `action` API is already available) and is visible regardless of which
 * surface triggered the action.
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
 * Speed fix, found via an audit: `google.ts`'s auth-key scrape used to
 * only ever run lazily, in-memory-only, inside the first real
 * `translateBatch` call of a fresh service-worker lifetime — paying a full
 * extra fetch to `translate.googleapis.com` serially before almost every
 * translation, since MV3 workers suspend after ~30s idle and this project
 * doesn't otherwise keep one alive between separate translate actions.
 * `browser.storage.session` (cleared on browser close, not synced —
 * appropriate for a key meant to refresh every 20 minutes anyway) lets a
 * still-fresh key survive a worker restart, and kicking the scrape off
 * here — at startup, in parallel with the content script's own startup
 * chain — instead of waiting for the first `translatePieces` message hides
 * its latency behind that other work rather than sitting on the critical
 * path. Fire-and-forget: nothing here needs to block `defineBackground`'s
 * own setup, and `google.ts`'s own `findAuth()` still runs its usual
 * lazy check if this hasn't finished (or failed) by the time a real
 * translate request needs it.
 */
async function prefetchGoogleAuthKey(): Promise<void> {
  try {
    const stored = await browser.storage.session.get(GOOGLE_AUTH_STORAGE_KEY);
    const snapshot = stored[GOOGLE_AUTH_STORAGE_KEY] as AuthKeySnapshot | undefined;
    // Defensive shape check — this is stored data, not a value this
    // module ever fully controls the origin of (a stale shape from a
    // future/past version of this extension is plausible).
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
  registerKeepaliveListener();
  void prefetchGoogleAuthKey();

  onMessage('translateText', async (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
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

  onMessage('translatePieces', async (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
    beginTranslateActivity();
    try {
      return await translatePiecesWithCache(message.data);
    } finally {
      endTranslateActivity();
    }
  });

  async function translatePiecesWithCache(data: TranslateBatchRequest): Promise<PieceOutcome[]> {
    const { providerId, provider } = await resolveActiveProvider();
    const { sourceLanguage, targetLanguage, pieces, dontSortResults } = data;

    if (!provider) {
      const error = { kind: 'network' as const, message: unavailableMessage(providerId) };
      return pieces.map(() => ({ ok: false, error }));
    }

    const cacheEnabled = configStore.get('translationCacheEnabled');
    const pieceKeys = pieces.map((piece) =>
      cacheKeyFor(providerId, sourceLanguage, targetLanguage, JSON.stringify(piece)),
    );
    // Caching is purely an optimization — a cache-layer failure (a closed
    // IndexedDB connection, a quota/permission issue, or a corrupt/truncated
    // stored entry) must never break an otherwise-successful translation.
    // Treat a failed read OR a value that fails to parse as a cache miss
    // (falls through to a live provider call below) and a failed write as a
    // no-op, all logged but not propagated. getMany() reads every piece
    // key in ONE IndexedDB transaction instead of one per key — a tick with
    // ~40 pieces used to open ~40 separate transactions just to check the
    // cache.
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
      freshOutcomes = await provider.translateBatch({
        sourceLanguage,
        targetLanguage,
        pieces: missingPieces,
        dontSortResults,
      });
    }

    // Built once so the reconstruction below is O(1) per piece instead of
    // an indexOf() scan (O(n) per piece, O(n^2) overall — real cost on a
    // cold/disabled cache, where every piece is "missing").
    const missingIdxByPiece = new Map(missingIndices.map((i, idx) => [i, idx]));

    const outcomes: PieceOutcome[] = pieces.map((_, i) => {
      const cached = cachedValues[i];
      if (cached !== null && cached !== undefined) return { ok: true, value: cached };
      const missingIdx = missingIdxByPiece.get(i);
      const fresh = missingIdx !== undefined ? freshOutcomes[missingIdx] : undefined;
      return fresh ?? { ok: false, error: { kind: 'parse', message: 'no result for this piece' } };
    });

    if (cacheEnabled) {
      // setMany() writes every fresh piece in ONE IndexedDB transaction and
      // runs ONE eviction pass, instead of set()'s old per-piece path (two
      // transactions each — up to 2N for N fresh pieces in a tick).
      const freshEntries = missingIndices
        .map((i, idx) => {
          const outcome = freshOutcomes[idx];
          const key = pieceKeys[i];
          return outcome?.ok && key ? { key, value: JSON.stringify(outcome.value) } : null;
        })
        .filter((e): e is { key: string; value: string } => e !== null);
      // Speed fix, found via audit: this used to be awaited, so the reply
      // carrying the freshly-translated outcomes — the thing the content
      // script is actually waiting on to write text to the page — sat
      // behind an IndexedDB commit AND, on a cold service worker, its
      // first-call full-store cursor scan (`ensureRunningTotal`) plus a
      // full eviction pass. Caching is purely an optimization (see the
      // comment above the read path); a future request benefiting from
      // this write a few milliseconds later than the reply already went
      // out is the correct trade, not a regression.
      void translationCache.setMany(freshEntries).catch((e) => {
        console.warn('[prism] translation cache write failed, continuing without caching these pieces', e);
      });
    }

    return outcomes;
  }

  // Registered inside onInstalled (fires on install/update/browser-update),
  // NOT unconditionally at the top of main() — an MV3 service worker is
  // fully re-executed on every wake from suspension (unlike a persistent
  // background page), but context-menu items persist in the browser
  // independently of the worker's own lifetime. Creating them unconditionally
  // meant every wake after the first successful install called create() with
  // an already-existing id, which the browser reports via
  // runtime.lastError — unread here, so it printed as an unchecked-error
  // warning on every single wake (which happens constantly: the keepalive
  // alarm alone fires every ~24s while a page is translating). The callback
  // reading lastError is a belt-and-braces guard, not the primary fix — a
  // genuine extension update can still legitimately re-create an id that
  // survived from the prior version.
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: TRANSLATE_MENU_ID, title: 'Translate this page', contexts: ['page'] }, () => {
      void browser.runtime.lastError;
    });
    browser.contextMenus.create({ id: RESTORE_MENU_ID, title: 'Show original text', contexts: ['page'] }, () => {
      void browser.runtime.lastError;
    });
  });
  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === TRANSLATE_MENU_ID) translateActiveTab().catch(showFailureBadge);
    if (info.menuItemId === RESTORE_MENU_ID) restoreActiveTab().catch(showFailureBadge);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translate-page') toggleActiveTab().catch(showFailureBadge);
  });

  onMessage('openOptionsPage', (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
    void browser.runtime.openOptionsPage();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    frameLanguageDecisions.delete(tabId);
  });

  onMessage('reportFrameLanguageDecision', (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
    const tabId = message.sender.tab?.id;
    if (tabId === undefined) return;
    frameLanguageDecisions.set(tabId, message.data);
  });

  onMessage('getFrameLanguageDecision', (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
    const tabId = message.sender.tab?.id;
    if (tabId === undefined) return null;
    return frameLanguageDecisions.get(tabId) ?? null;
  });

  onMessage('detectTabLanguage', async (message) => {
    if (!isTrustedSender(message.sender)) throw new Error('[prism] rejected a message from an untrusted sender');
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
