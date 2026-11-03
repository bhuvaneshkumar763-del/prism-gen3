import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { createConfigMirror } from '../../components/shared/configMirror';
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
  type ListsPatch,
  removeSiteFromAlwaysTranslate,
  removeSiteFromNeverTranslate,
  siteListIncludesHostname,
} from '../../src/shared/config/listMutations';
import { missingProviderSetup } from '../../src/shared/config/providerSetup';
import { resolveBubbleVisibility, setBubbleVisibilityForHost } from '../../src/shared/config/siteOverrides';
import { baseLanguageTag, COMMON_LANGUAGES, languageName, translationDirection } from '../../src/shared/languages';
import { loadPageStatus } from '../../src/shared/pageStatus';
import { translateShortcut } from '../../src/shared/shortcut';
import { CANT_TRANSLATE_MESSAGE, describeUnsupportedPage } from '../../src/shared/unsupportedPage';
import { withTimeout } from '../../src/shared/withTimeout';
import './App.css';

/**
 * Bounds every content-script message: a tab that never replies (navigated
 * away, crashed) becomes a catchable error instead of a popup stuck on busy.
 */
const CONTENT_SCRIPT_TIMEOUT_MS = 5000;

const MAX_QUICK_LANGUAGES = 5;

/**
 * Toolbar popup: translate/restore the active tab, quick languages and
 * per-site/per-language toggles. List edits go through configMutations so the
 * always/never cross-list cleanup applies everywhere. Config is read from
 * `createConfigMirror`, never with `configStore.get()` in JSX (enforced by
 * scripts/check-solid-reactivity.mjs).
 */
function App() {
  const { config, ready, setLocal } = createConfigMirror(configStore);
  const [status, setStatus] = createSignal<'idle' | 'busy' | 'error'>('idle');
  const [pageState, setPageState] = createSignal<PageLanguageState>('original');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [errorKind, setErrorKind] = createSignal<ErrorKind>(null);
  const [hostname, setHostname] = createSignal('');
  const [tabUrl, setTabUrl] = createSignal('');
  const [originalLanguage, setOriginalLanguage] = createSignal('und');
  const [showMore, setShowMore] = createSignal(false);
  /** The live translate/restore key binding, or null — see translateShortcut. */
  const [shortcut, setShortcut] = createSignal<string | null>(null);
  /** What each provider still needs, or null — see missingProviderSetup. */
  const providerGaps = (id: ProviderId) => missingProviderSetup(id, config);
  /** Set when there's no Prism running in this tab — see `describeUnsupportedPage`. */
  const [unsupportedMessage, setUnsupportedMessage] = createSignal<string | null>(null);
  let tabId: number | null = null;

  // `pageState` turns 'translated' before the work finishes, so also require
  // not busy (kept accurate by pollUntilWorkingDone). Same rule as the bubble.
  const translated = createMemo(() => pageState() === 'translated' && status() !== 'busy');
  // The shared helper, not `.includes()`, so `www.`/apex hosts match the way
  // auto-translate matches them.
  const alwaysSiteOn = createMemo(() => siteListIncludesHostname(config.alwaysTranslateSites, hostname()));
  const neverSiteOn = createMemo(() => siteListIncludesHostname(config.neverTranslateSites, hostname()));
  const alwaysLangOn = createMemo(() =>
    config.alwaysTranslateLangs.some((l) => baseLanguageTag(l) === baseLanguageTag(originalLanguage())),
  );
  const bubbleOnForSite = createMemo(() =>
    resolveBubbleVisibility({
      hostname: hostname(),
      bubbleEnabled: config.bubbleEnabled,
      bubbleByHost: config.bubbleByHost,
    }),
  );

  onMount(async () => {
    await configStore.onReady();
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
        // Non-http(s) URL (chrome://, about:): no hostname, per-site controls stay disabled.
      }
    }
    if (tabId === null) {
      setUnsupportedMessage(CANT_TRANSLATE_MESSAGE);
      return;
    }
    const id = tabId;
    // Concurrent (see loadPageStatus). The error matters: translateLoop.ts never
    // reverts 'translated' on error, so without it a failing page would show
    // "Translated".
    const pageStatus = await loadPageStatus({
      getPageState: () => withTimeout(sendMessage('getPageState', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
      getOriginalLanguage: () =>
        withTimeout(sendMessage('getOriginalLanguage', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
      getPageError: () => withTimeout(sendMessage('getPageError', undefined, id), CONTENT_SCRIPT_TIMEOUT_MS),
    });
    // Actionable advice instead of the browser's raw "Receiving end does not
    // exist" (see describeUnsupportedPage).
    setUnsupportedMessage(describeUnsupportedPage(tab.url ?? '', pageStatus.reachable));
    if (pageStatus.pageState) setPageState(pageStatus.pageState);
    if (pageStatus.originalLanguage) setOriginalLanguage(pageStatus.originalLanguage);
    if (pageStatus.error) {
      setErrorMessage(pageStatus.error.message);
      setErrorKind(pageStatus.error.kind);
      setStatus('error');
    }
  });

  /**
   * A translation can start failing after `pageTranslate` has answered, and
   * the popup doesn't subscribe to onError like the bubble does, so it checks
   * `getPageError` twice after a translate instead.
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
   * Retranslates immediately, like the bubble's pickers, so the quick-language
   * pill can't claim a language the page isn't in. Keyed on `pageState` so it
   * also applies mid-translation; on an untranslated page it only saves.
   */
  async function onTargetLanguageChange(code: string): Promise<void> {
    setLocal('targetLanguage', code);
    await configStore.set('targetLanguage', code);
    await configStore.set(
      'targetLanguages',
      addRecentTargetLanguage(config.targetLanguages, code, MAX_QUICK_LANGUAGES),
    );
    if (pageState() === 'translated') await onTranslateClick();
  }

  async function onProviderChange(select: HTMLSelectElement): Promise<void> {
    const id = select.value as ProviderId;
    // A provider that still needs setup is not switched to (every page would
    // fail until its key is entered); Settings opens where it is set up. The
    // popup opens Settings itself if the background doesn't answer.
    if (providerGaps(id)) {
      select.value = config.pageTranslatorProvider;
      sendMessage('openOptionsPage', { section: 'page' }).catch(() => {
        void browser.runtime.openOptionsPage();
      });
      return;
    }
    setLocal('pageTranslatorProvider', id);
    // Awaited before retranslating: the provider is read from config by the
    // background at translate time, so the write has to have landed first.
    await configStore.set('pageTranslatorProvider', id);
    if (pageState() === 'translated') await onTranslateClick();
  }

  /**
   * `pageTranslate` answers once work is queued, not done, so poll
   * `getPageWorking` (like refreshError above) before clearing busy. Bounded
   * so a long-running page can't leave the button stuck.
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
    // Give up on the indicator only; translation keeps going in the page.
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
        sendMessage('pageTranslate', { targetLanguage: config.targetLanguage }, id),
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

  /**
   * Applies a list patch; on failure shows the error and flips `input` back,
   * since the saved value never changed and Solid won't re-render it.
   */
  async function saveListPatch(patch: ListsPatch, input?: HTMLInputElement): Promise<boolean> {
    try {
      await applyListPatch(configStore, patch);
      return true;
    } catch (e) {
      console.warn('[prism] failed to save site/language list', e);
      if (input) input.checked = !input.checked;
      setErrorMessage(`Could not save the setting (${e instanceof Error ? e.message : String(e)})`);
      setErrorKind('provider');
      setStatus('error');
      return false;
    }
  }

  async function onToggleAlwaysSite(input: HTMLInputElement): Promise<void> {
    const host = hostname();
    if (!host) return;
    const snapshot = readListsSnapshot(configStore);
    const patch = alwaysSiteOn()
      ? removeSiteFromAlwaysTranslate(snapshot, host)
      : addSiteToAlwaysTranslate(snapshot, host);
    await saveListPatch(patch, input);
  }

  async function onToggleNeverSite(): Promise<void> {
    const host = hostname();
    if (!host) return;
    const snapshot = readListsSnapshot(configStore);
    if (neverSiteOn()) {
      await saveListPatch(removeSiteFromNeverTranslate(snapshot, host));
      return;
    }
    if (!(await saveListPatch(addSiteToNeverTranslate(snapshot, host)))) return;
    if (tabId !== null && pageState() === 'translated') {
      try {
        const state = await withTimeout(sendMessage('pageRestore', undefined, tabId), CONTENT_SCRIPT_TIMEOUT_MS);
        setPageState(state);
      } catch {
        // The list update already succeeded; a failed restore just leaves the
        // page as it was.
      }
    }
  }

  async function onToggleAlwaysLang(input: HTMLInputElement): Promise<void> {
    const host = hostname();
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (alwaysLangOn()) {
      const langBase = baseLanguageTag(lang);
      await saveListPatch(
        { alwaysTranslateLangs: config.alwaysTranslateLangs.filter((l) => baseLanguageTag(l) !== langBase) },
        input,
      );
      return;
    }
    const snapshot = readListsSnapshot(configStore);
    await saveListPatch(addLangToAlwaysTranslate(snapshot, lang, host || undefined), input);
  }

  async function onToggleBubbleForSite(): Promise<void> {
    const host = hostname();
    if (!host) return;
    await configStore.set('bubbleByHost', setBubbleVisibilityForHost(config.bubbleByHost, host, !bubbleOnForSite()));
  }

  function openSettings(): void {
    void browser.runtime.openOptionsPage();
  }

  function openInGoogleTranslate(): void {
    if (!tabUrl()) return;
    const base = config.targetLanguage.split('-')[0];
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
            ? (translationDirection(originalLanguage(), config.targetLanguage) ?? 'Translated')
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
            {/* Same spinner pattern as FloatingBubble.tsx's .spinner. */}
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

      <Show when={config.targetLanguages.length > 0}>
        <div class="pillRow">
          <For each={config.targetLanguages.slice(0, MAX_QUICK_LANGUAGES)}>
            {(code) => (
              <button
                type="button"
                class="pill"
                classList={{ on: translated() && code === config.targetLanguage }}
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
          <select value={config.targetLanguage} onChange={(e) => void onTargetLanguageChange(e.currentTarget.value)}>
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
        </label>

        <label class="quickField">
          <span>Service</span>
          <select value={config.pageTranslatorProvider} onChange={(e) => void onProviderChange(e.currentTarget)}>
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
        <Show when={originalLanguage() !== 'und' && originalLanguage() !== config.targetLanguage}>
          <label class="toggleRow">
            <input
              type="checkbox"
              checked={alwaysLangOn()}
              onChange={(e) => void onToggleAlwaysLang(e.currentTarget)}
            />
            <span>Always translate from {languageName(originalLanguage())}</span>
          </label>
        </Show>
        <label class="toggleRow">
          {/* Disabled with no hostname (chrome://, the stores, ...): the handler
              can't act there, so the checkbox mustn't flip to a state never saved. */}
          <input
            type="checkbox"
            checked={alwaysSiteOn()}
            disabled={!hostname()}
            onChange={(e) => void onToggleAlwaysSite(e.currentTarget)}
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
              checked={config.hoverTooltipEnabled}
              onChange={(e) => void configStore.set('hoverTooltipEnabled', e.currentTarget.checked)}
            />
            <span>Show original text when hovering</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              checked={config.selectionPopupEnabled}
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
