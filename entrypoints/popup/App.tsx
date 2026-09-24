import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { ErrorKind, PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import { type ProviderId, providerDescriptors } from '../../src/engine/providers/descriptors';
import { applyListPatch, readListsSnapshot } from '../../src/platform/configMutations';
import { configStore } from '../../src/platform/configStore';
import { sendMessage } from '../../src/platform/messaging/protocol';
import { getActiveTab, getActiveTabId } from '../../src/platform/messaging/tabTarget';
import {
  addLangToAlwaysTranslate,
  addRecentTargetLanguage,
  addSiteToAlwaysTranslate,
  addSiteToNeverTranslate,
  removeSiteFromAlwaysTranslate,
  removeSiteFromNeverTranslate,
  siteListIncludesHostname,
} from '../../src/shared/config/listMutations';
import { missingProviderSetup, type ProviderSetupFields } from '../../src/shared/config/providerSetup';
import { resolveBubbleVisibility, setBubbleVisibilityForHost } from '../../src/shared/config/siteOverrides';
import { COMMON_LANGUAGES, languageName, translationDirection } from '../../src/shared/languages';
import { loadPageStatus } from '../../src/shared/pageStatus';
import { translateShortcut } from '../../src/shared/shortcut';
import { CANT_TRANSLATE_MESSAGE, describeUnsupportedPage } from '../../src/shared/unsupportedPage';
import { withTimeout } from '../../src/shared/withTimeout';
import './App.css';

/**
 * A content script that never replies (page navigated away mid-request, or
 * its tab crashed) used to leave the popup stuck on its "busy"/"translating…"
 * state forever, since a promise that never settles never reaches these
 * calls' existing try/catch either. Every content-script-directed message
 * from this popup goes through this so a hang becomes a real, catchable
 * error instead.
 */
const CONTENT_SCRIPT_TIMEOUT_MS = 5000;

const MAX_QUICK_LANGUAGES = 5;

/**
 * Triggers the real page-translation engine
 * (`src/engine/pageTranslator/translateLoop.ts`, wired into
 * `entrypoints/content.ts`) — translate/restore the whole active tab.
 *
 * Post-launch UI-depth pass, Phase 2: rebuilt on the pre-rewrite fork's
 * popup layout (status pill, quick-language pills, per-site/per-language
 * toggles, a "More" section, a small menu) — see this repo's CLAUDE.md for
 * the full comparison that motivated it. All list/site mutations go through
 * `src/platform/configMutations.ts` + `src/shared/config/listMutations.ts`
 * rather than a raw `configStore.set(...)` on the four always/never-translate
 * keys, so the cross-list cleanup (adding to "always" removes from "never")
 * applies consistently everywhere, not just here.
 *
 * Every value read into local `createSignal`s on mount and kept live via
 * `configStore.onChanged` — never `configStore.get()` directly inside JSX
 * (the documented Solid-reactivity foot-gun, mechanically enforced by
 * `scripts/check-solid-reactivity.mjs`).
 */
function App() {
  const [status, setStatus] = createSignal<'idle' | 'busy' | 'error'>('idle');
  const [pageState, setPageState] = createSignal<PageLanguageState>('original');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [errorKind, setErrorKind] = createSignal<ErrorKind>(null);
  const [targetLanguage, setTargetLanguage] = createSignal('en');
  const [provider, setProvider] = createSignal('google');
  const [ready, setReady] = createSignal(false);
  const [hostname, setHostname] = createSignal('');
  const [tabUrl, setTabUrl] = createSignal('');
  const [originalLanguage, setOriginalLanguage] = createSignal('und');
  const [quickLanguages, setQuickLanguages] = createSignal<string[]>([]);
  const [alwaysSites, setAlwaysSites] = createSignal<string[]>([]);
  const [neverSites, setNeverSites] = createSignal<string[]>([]);
  const [alwaysLangs, setAlwaysLangs] = createSignal<string[]>([]);
  const [bubbleEnabled, setBubbleEnabled] = createSignal(true);
  const [bubbleByHost, setBubbleByHost] = createSignal<Record<string, boolean>>({});
  const [hoverTooltipEnabled, setHoverTooltipEnabled] = createSignal(true);
  const [selectionPopupEnabled, setSelectionPopupEnabled] = createSignal(true);
  const [showMore, setShowMore] = createSignal(false);
  /** The live translate/restore key binding, or null — see translateShortcut. */
  const [shortcut, setShortcut] = createSignal<string | null>(null);
  const [setupFields, setSetupFields] = createSignal<ProviderSetupFields>({
    googleCloudTranslateApiKey: '',
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
  });
  /** What each provider still needs, or null — see missingProviderSetup. */
  const providerGaps = (id: ProviderId) => missingProviderSetup(id, setupFields());
  function readSetupFields(): ProviderSetupFields {
    return {
      googleCloudTranslateApiKey: configStore.get('googleCloudTranslateApiKey'),
      llmBaseUrl: configStore.get('llmBaseUrl'),
      llmApiKey: configStore.get('llmApiKey'),
      llmModel: configStore.get('llmModel'),
    };
  }
  /** Set when there's no Prism running in this tab — see `describeUnsupportedPage`. */
  const [unsupportedMessage, setUnsupportedMessage] = createSignal<string | null>(null);
  let tabId: number | null = null;

  // Real bug this replaced: `pageState` flips to 'translated' well before
  // any real work is done (translatePage() queues nodes and schedules the
  // routine without awaiting it) — `status() !== 'busy'` (kept accurate by
  // pollUntilWorkingDone below) must also hold before this counts as done.
  // Same fix as FloatingBubble.tsx's `translated()`.
  const translated = createMemo(() => pageState() === 'translated' && status() !== 'busy');
  // Via the shared helper, not `.includes()`: a `www.`/apex mismatch used
  // to make these toggles read OFF while auto-translate fired anyway.
  const alwaysSiteOn = createMemo(() => siteListIncludesHostname(alwaysSites(), hostname()));
  const neverSiteOn = createMemo(() => siteListIncludesHostname(neverSites(), hostname()));
  const alwaysLangOn = createMemo(() => alwaysLangs().includes(originalLanguage()));
  const bubbleOnForSite = createMemo(() =>
    resolveBubbleVisibility({ hostname: hostname(), bubbleEnabled: bubbleEnabled(), bubbleByHost: bubbleByHost() }),
  );

  onMount(async () => {
    await configStore.onReady();
    setTargetLanguage(configStore.get('targetLanguage'));
    setProvider(configStore.get('pageTranslatorProvider'));
    setQuickLanguages(configStore.get('targetLanguages'));
    setAlwaysSites(configStore.get('alwaysTranslateSites'));
    setNeverSites(configStore.get('neverTranslateSites'));
    setAlwaysLangs(configStore.get('alwaysTranslateLangs'));
    setBubbleEnabled(configStore.get('bubbleEnabled'));
    setBubbleByHost(configStore.get('bubbleByHost'));
    setHoverTooltipEnabled(configStore.get('hoverTooltipEnabled'));
    setSelectionPopupEnabled(configStore.get('selectionPopupEnabled'));
    setSetupFields(readSetupFields());
    setReady(true);
    // Not every browser exposes commands.getAll — no hint is better than a broken one.
    browser.commands
      ?.getAll?.()
      .then((commands) => setShortcut(translateShortcut(commands)))
      .catch(() => {});

    let tab: Awaited<ReturnType<typeof getActiveTab>>;
    try {
      tab = await getActiveTab();
    } catch {
      setUnsupportedMessage(CANT_TRANSLATE_MESSAGE);
      return;
    }
    tabId = tab.id ?? null;
    if (tab.url) {
      setTabUrl(tab.url);
      try {
        setHostname(new URL(tab.url).hostname);
      } catch {
        // non-http(s) URL (chrome://, about:, ...) — leave hostname empty, per-site controls stay disabled
      }
    }
    if (tabId === null) {
      setUnsupportedMessage(CANT_TRANSLATE_MESSAGE);
      return;
    }
    const id = tabId;
    // Concurrent, not three round trips in a row — see loadPageStatus. The
    // error question matters here: a translation can keep failing in the
    // background well after the page reports 'translated' (translateLoop.ts
    // never reverts pageLanguageState on error), and without it the popup
    // showed a plain "Translated" for a tab the on-page bubble correctly
    // shows as failing.
    const pageStatus = await loadPageStatus({
      getPageState: () => withTimeout(sendMessage('getPageState', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
      getOriginalLanguage: () =>
        withTimeout(sendMessage('getOriginalLanguage', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
      getPageError: () => withTimeout(sendMessage('getPageError', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
    });
    // Replaces the browser's raw "Receiving end does not exist" with advice
    // the user can act on — see describeUnsupportedPage.
    setUnsupportedMessage(describeUnsupportedPage(tab.url ?? '', pageStatus.reachable));
    if (pageStatus.pageState) setPageState(pageStatus.pageState);
    if (pageStatus.originalLanguage) setOriginalLanguage(pageStatus.originalLanguage);
    if (pageStatus.error) {
      setErrorMessage(pageStatus.error.message);
      setErrorKind(pageStatus.error.kind);
      setStatus('error');
    }
  });

  const unsubscribe = configStore.onChanged((name, value) => {
    if (name === 'targetLanguage') setTargetLanguage(value as string);
    if (name === 'pageTranslatorProvider') setProvider(value as string);
    if (name === 'targetLanguages') setQuickLanguages(value as string[]);
    if (name === 'alwaysTranslateSites') setAlwaysSites(value as string[]);
    if (name === 'neverTranslateSites') setNeverSites(value as string[]);
    if (name === 'alwaysTranslateLangs') setAlwaysLangs(value as string[]);
    if (name === 'bubbleEnabled') setBubbleEnabled(value as boolean);
    if (name === 'bubbleByHost') setBubbleByHost(value as Record<string, boolean>);
    if (name === 'hoverTooltipEnabled') setHoverTooltipEnabled(value as boolean);
    if (name === 'selectionPopupEnabled') setSelectionPopupEnabled(value as boolean);
    if (name === 'googleCloudTranslateApiKey' || name === 'llmBaseUrl' || name === 'llmApiKey' || name === 'llmModel') {
      setSetupFields(readSetupFields());
    }
  });
  onCleanup(unsubscribe);

  /**
   * A translate call can keep failing silently in the background well
   * after `pageTranslate`'s own request/response round trip already
   * resolved (see `translateLoop.ts`'s consecutive-failure guard) — this
   * popup, unlike the always-open bubble, isn't subscribed to
   * `pageTranslator.onError()` and typically closes before that fires.
   * Polling `getPageError` once shortly after and once again a bit later
   * is a reasonable middle ground without keeping the popup's message port
   * open indefinitely.
   */
  async function refreshError(): Promise<void> {
    if (tabId === null) return;
    try {
      const result = await withTimeout(sendMessage('getPageError', undefined, tabId), CONTENT_SCRIPT_TIMEOUT_MS);
      if (result) {
        setErrorMessage(result.message);
        setErrorKind(result.kind);
        setStatus('error');
      }
    } catch {
      // Tab may have navigated away or closed since the click — nothing to surface.
    }
  }

  /**
   * Real bug this closed, found via a UI audit: changing the language here
   * used to only SAVE it — the page stayed in its old language, while the
   * quick-language pill (highlighted when `translated() && code ===
   * targetLanguage()`) claimed the page was now in the new one. The bubble's
   * own To/Service pickers already retranslate immediately; this now matches
   * them. Keyed on `pageState` rather than `translated()` so picking a new
   * language mid-translation also takes effect — `translatePage` restores and
   * restarts cleanly. On an untranslated page the choice is just saved for
   * the Translate button, as before.
   */
  async function onTargetLanguageChange(code: string): Promise<void> {
    setTargetLanguage(code);
    await configStore.set('targetLanguage', code);
    await configStore.set('targetLanguages', addRecentTargetLanguage(quickLanguages(), code, MAX_QUICK_LANGUAGES));
    if (pageState() === 'translated') await onTranslateClick();
  }

  async function onProviderChange(id: ProviderId): Promise<void> {
    setProvider(id);
    // Awaited before retranslating: the provider is read from config by the
    // background at translate time, so the write has to have landed first.
    await configStore.set('pageTranslatorProvider', id);
    // Improvement, found via a UI audit: an unconfigured provider used to be
    // accepted silently and fail on the next translate. Now it opens Settings
    // at the fields it still needs, rather than retranslating into an error.
    if (providerGaps(id)) {
      // The popup can open Settings itself if the background doesn't answer
      // — just without jumping to the provider section.
      sendMessage('openOptionsPage', { section: 'page' }).catch(() => {
        void browser.runtime.openOptionsPage();
      });
      return;
    }
    if (pageState() === 'translated') await onTranslateClick();
  }

  /**
   * `pageTranslate`'s own response resolves as soon as real work is
   * QUEUED, not once it's actually done — same real bug fixed for the
   * on-page bubble (`entrypoints/content.ts`'s `onWorkingChange` wiring):
   * `translatePage()` never awaits real translate work, so awaiting the
   * message alone made the popup's busy state clear in ~zero frames, with
   * `pageState` already reporting 'translated' well before anything on the
   * page had changed. Poll `getPageWorking` afterward (same shape as
   * `refreshError`'s existing polling below) until real work actually
   * finishes, and only then clear `busy` — bounded so a page that's still
   * genuinely working after a while doesn't leave the button stuck.
   */
  async function pollUntilWorkingDone(id: number): Promise<void> {
    const POLL_INTERVAL_MS = 400;
    const MAX_POLLS = 50; // ~20s ceiling — generous even for a very large page
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      let working: boolean;
      try {
        working = await withTimeout(sendMessage('getPageWorking', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS);
      } catch {
        // Tab navigated away or closed since the click — nothing to poll for anymore.
        return;
      }
      if (!working) {
        setStatus('idle');
        return;
      }
    }
    // Gave up waiting rather than leaving the button stuck on "busy" forever
    // — translation itself keeps going in the background either way (see
    // translateLoop.ts's own retry/backoff), this only affects this popup's
    // own busy indicator if it's still open that long.
    setStatus('idle');
  }

  async function onTranslateClick() {
    setStatus('busy');
    setErrorMessage(null);
    setErrorKind(null);
    try {
      await configStore.onReady();
      const id = await getActiveTabId();
      tabId = id;
      const state = await withTimeout(
        sendMessage('pageTranslate', { targetLanguage: targetLanguage() }, id),
        CONTENT_SCRIPT_TIMEOUT_MS,
      );
      setPageState(state);
      void pollUntilWorkingDone(id);
      setTimeout(() => void refreshError(), 2000);
      setTimeout(() => void refreshError(), 6000);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setErrorKind('provider');
      setStatus('error');
    }
  }

  async function onRestoreClick() {
    setStatus('busy');
    setErrorMessage(null);
    setErrorKind(null);
    try {
      const id = await getActiveTabId();
      tabId = id;
      const state = await withTimeout(sendMessage('pageRestore', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS);
      setPageState(state);
      setStatus('idle');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setErrorKind('provider');
      setStatus('error');
    }
  }

  async function onToggleAlwaysSite(): Promise<void> {
    const host = hostname();
    if (!host) return;
    const snapshot = readListsSnapshot(configStore);
    const patch = alwaysSiteOn()
      ? removeSiteFromAlwaysTranslate(snapshot, host)
      : addSiteToAlwaysTranslate(snapshot, host);
    await applyListPatch(configStore, patch);
  }

  async function onToggleNeverSite(): Promise<void> {
    const host = hostname();
    if (!host) return;
    const snapshot = readListsSnapshot(configStore);
    if (neverSiteOn()) {
      await applyListPatch(configStore, removeSiteFromNeverTranslate(snapshot, host));
      return;
    }
    await applyListPatch(configStore, addSiteToNeverTranslate(snapshot, host));
    if (tabId !== null && pageState() === 'translated') {
      try {
        const state = await withTimeout(sendMessage('pageRestore', undefined, tabId), CONTENT_SCRIPT_TIMEOUT_MS);
        setPageState(state);
      } catch {
        // The never-translate-list update above already succeeded; a
        // failed/timed-out restore here just means the page's own state
        // stays whatever it was — nothing else to surface for this action.
      }
    }
  }

  async function onToggleAlwaysLang(): Promise<void> {
    const host = hostname();
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (alwaysLangOn()) {
      await applyListPatch(configStore, { alwaysTranslateLangs: alwaysLangs().filter((l) => l !== lang) });
      return;
    }
    const snapshot = readListsSnapshot(configStore);
    await applyListPatch(configStore, addLangToAlwaysTranslate(snapshot, lang, host || undefined));
  }

  async function onToggleBubbleForSite(): Promise<void> {
    const host = hostname();
    if (!host) return;
    await configStore.set('bubbleByHost', setBubbleVisibilityForHost(bubbleByHost(), host, !bubbleOnForSite()));
  }

  function openSettings(): void {
    void browser.runtime.openOptionsPage();
  }

  function openInGoogleTranslate(): void {
    if (!tabUrl()) return;
    const base = targetLanguage().split('-')[0];
    void browser.tabs.create({
      url: `https://translate.google.com/translate?sl=auto&tl=${base}&u=${encodeURIComponent(tabUrl())}`,
    });
  }

  return (
    <div class="app">
      <div class="header">
        <h1>Prism</h1>
        <span class="statusPill" classList={{ on: translated() }} role="status">
          {translated()
            ? (translationDirection(originalLanguage(), targetLanguage()) ?? 'Translated')
            : `Original · ${originalLanguage() === 'und' ? '…' : languageName(originalLanguage())}`}
        </span>
      </div>

      <Show when={unsupportedMessage()}>
        <p class="notice">{unsupportedMessage()}</p>
      </Show>

      <Show
        when={translated()}
        fallback={
          <button
            type="button"
            class="primaryBtn"
            classList={{ busy: status() === 'busy' }}
            disabled={status() === 'busy' || unsupportedMessage() !== null}
            onClick={onTranslateClick}
          >
            {/* Perceived-speed fix: previously text-only while busy, the one
                translate-triggering surface with no motion at all — see
                FloatingBubble.tsx's matching .spinner for the pattern this
                reuses. */}
            <span class="spinner" />
            {status() === 'busy' ? 'Translating…' : 'Translate this page'}
          </button>
        }
      >
        <button
          type="button"
          class="primaryBtn"
          classList={{ busy: status() === 'busy' }}
          disabled={status() === 'busy'}
          onClick={onRestoreClick}
        >
          <span class="spinner" />
          {status() === 'busy' ? 'Restoring…' : 'Show original'}
        </button>
      </Show>

      <Show when={shortcut() && !unsupportedMessage()}>
        <p class="shortcutHint">
          Shortcut: <kbd>{shortcut()}</kbd>
        </p>
      </Show>

      <Show when={quickLanguages().length > 0}>
        <div class="pillRow">
          <For each={quickLanguages().slice(0, MAX_QUICK_LANGUAGES)}>
            {(code) => (
              <button
                type="button"
                class="pill"
                classList={{ on: translated() && code === targetLanguage() }}
                onClick={() => void onTargetLanguageChange(code)}
              >
                {languageName(code)}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={ready()}>
        <label class="quickField">
          <span>Translate into</span>
          <select value={targetLanguage()} onChange={(e) => void onTargetLanguageChange(e.currentTarget.value)}>
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
        </label>

        <label class="quickField">
          <span>Service</span>
          <select value={provider()} onChange={(e) => void onProviderChange(e.currentTarget.value as ProviderId)}>
            <For each={providerDescriptors}>
              {(d) => (
                <option value={d.id}>
                  {d.displayName}
                  {providerGaps(d.id) ? ' — needs setup' : ''}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>

      <div class="toggleList">
        <Show when={originalLanguage() !== 'und' && originalLanguage() !== targetLanguage()}>
          <label class="toggleRow">
            <input type="checkbox" checked={alwaysLangOn()} onChange={() => void onToggleAlwaysLang()} />
            <span>Always translate from {languageName(originalLanguage())}</span>
          </label>
        </Show>
        <label class="toggleRow">
          {/* Disabled with no hostname (chrome://, the stores, ...): the handler
              can't act there, but the native checkbox used to flip anyway and
              show "on" for a setting that was never saved. */}
          <input
            type="checkbox"
            checked={alwaysSiteOn()}
            disabled={!hostname()}
            onChange={() => void onToggleAlwaysSite()}
          />
          <span>Always translate this site</span>
        </label>
        <label class="toggleRow accent">
          <input
            type="checkbox"
            checked={bubbleOnForSite()}
            disabled={!hostname()}
            onChange={() => void onToggleBubbleForSite()}
          />
          <span>Show the floating translate bubble</span>
        </label>
      </div>

      <button type="button" class="moreToggle" aria-expanded={showMore()} onClick={() => setShowMore(!showMore())}>
        {showMore() ? 'Less' : 'More settings'}
      </button>

      <Show when={showMore()}>
        <div class="toggleList">
          <label class="toggleRow">
            <input
              type="checkbox"
              checked={hoverTooltipEnabled()}
              onChange={(e) => void configStore.set('hoverTooltipEnabled', e.currentTarget.checked)}
            />
            <span>Show original text when hovering</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              checked={selectionPopupEnabled()}
              onChange={(e) => void configStore.set('selectionPopupEnabled', e.currentTarget.checked)}
            />
            <span>Show the button to translate selected text</span>
          </label>
        </div>
      </Show>

      <nav class="menuList">
        <button
          type="button"
          class="menuItem"
          classList={{ on: neverSiteOn() }}
          aria-pressed={neverSiteOn()}
          disabled={!hostname()}
          onClick={() => void onToggleNeverSite()}
        >
          Never translate this site
        </button>
        <button type="button" class="menuItem" onClick={openInGoogleTranslate}>
          Open in Google Translate
        </button>
        <button type="button" class="menuItem" onClick={openSettings}>
          More options…
        </button>
      </nav>

      <Show when={status() === 'error'}>
        <p class="error" classList={{ offline: errorKind() === 'offline' }} role="alert">
          {errorKind() === 'offline' ? errorMessage() : `Error: ${errorMessage()}`}
        </p>
      </Show>
    </div>
  );
}

export default App;
