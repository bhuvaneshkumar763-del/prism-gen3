import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js';
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
  type ListsPatch,
} from '../../src/shared/config/listMutations';
import { missingProviderSetup } from '../../src/shared/config/providerSetup';
import { resolveBubbleVisibility, setBubbleVisibilityForHost } from '../../src/shared/config/siteOverrides';
import { baseLanguageTag, COMMON_LANGUAGES, languageName } from '../../src/shared/languages';
import { loadPageStatus } from '../../src/shared/pageStatus';
import {
  describePopupError,
  pageErrorText,
  pillRowAfterPick,
  SAVE_FAILED_MESSAGE,
  type SiteRule,
  siteRuleFor,
  siteRulePatch,
  statusPillText,
  translateButtonLabel,
} from '../../src/shared/popupView';
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

const SITE_RULES: ReadonlyArray<{ rule: SiteRule; label: string }> = [
  { rule: 'always', label: 'Always' },
  { rule: 'default', label: 'Default' },
  { rule: 'never', label: 'Never' },
];

/**
 * Toolbar popup: the translate button, target language and bubble toggle on
 * top; everything else under "More". List edits go through configMutations so
 * the always/never cross-list cleanup applies everywhere. Config is read from
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
  /** Fixed while the popup is open so pills don't move under a finger; see pillRowAfterPick. */
  const [pillRow, setPillRow] = createSignal<string[]>([]);
  let tabId: number | null = null;
  let siteRuleGroup: HTMLFieldSetElement | undefined;

  createEffect(
    on(ready, (isReady) => {
      if (isReady) setPillRow(config.targetLanguages.slice(0, MAX_QUICK_LANGUAGES));
    }),
  );

  // `pageState` turns 'translated' before the work finishes, so also require
  // not busy (kept accurate by pollUntilWorkingDone). Same rule as the bubble.
  const translated = createMemo(() => pageState() === 'translated' && status() !== 'busy');
  // The shared helper, not `.includes()`, so `www.`/apex hosts match the way
  // auto-translate matches them.
  const siteRule = createMemo(() => siteRuleFor(config, hostname()));
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
      setErrorMessage(pageErrorText(pageStatus.error));
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
        setErrorMessage(pageErrorText(result));
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
    setPillRow(pillRowAfterPick(pillRow(), code, MAX_QUICK_LANGUAGES));
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

  /** Raw messaging/internal text goes to the console; the popup shows plain words. */
  function showCaughtError(e: unknown): void {
    console.warn('[prism] popup action failed', e);
    setErrorMessage(describePopupError(e));
    setErrorKind('provider');
    setStatus('error');
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
      showCaughtError(e);
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
      showCaughtError(e);
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
      setErrorMessage(SAVE_FAILED_MESSAGE);
      setErrorKind('provider');
      setStatus('error');
      return false;
    }
  }

  /** Moving to "never" also restores a translated page: the never list means "keep this site original". */
  async function onSiteRuleChange(rule: SiteRule): Promise<void> {
    const host = hostname();
    if (!host) return;
    const patch = siteRulePatch(readListsSnapshot(configStore), host, rule);
    if (!(await saveListPatch(patch))) {
      // The saved rule didn't change, so Solid won't re-check the old radio itself.
      const current = siteRuleGroup?.querySelector<HTMLInputElement>(`input[value="${siteRule()}"]`);
      if (current) current.checked = true;
      return;
    }
    if (rule !== 'never' || tabId === null || pageState() !== 'translated') return;
    try {
      const state = await withTimeout(sendMessage('pageRestore', undefined, tabId), CONTENT_SCRIPT_TIMEOUT_MS);
      setPageState(state);
    } catch {
      // The list update already succeeded; a failed restore just leaves the
      // page as it was.
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
        <Show when={!unsupportedMessage()}>
          <span class="statusPill" classList={{ on: translated() }} role="status">
            {statusPillText(translated(), originalLanguage(), config.targetLanguage)}
          </span>
        </Show>
      </div>

      <Show when={unsupportedMessage()}>
        <p class="notice" role="status">
          {unsupportedMessage()}
        </p>
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
            {status() === 'busy' ? 'Translating…' : translateButtonLabel(config.targetLanguage)}
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

      <Show when={status() === 'error'}>
        <p class="error" classList={{ offline: errorKind() === 'offline' }} role="alert">
          {errorMessage()}
        </p>
      </Show>

      <Show when={shortcut() && !unsupportedMessage()}>
        <p class="shortcutHint">
          Shortcut: <kbd>{shortcut()}</kbd>
        </p>
      </Show>

      <Show when={ready()}>
        <label class="quickField">
          <span>Translate into</span>
          <select value={config.targetLanguage} onChange={(e) => void onTargetLanguageChange(e.currentTarget.value)}>
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
        </label>
      </Show>

      <label class="toggleRow accent">
        {/* Disabled with no hostname (chrome://, the stores, ...): the handler
            can't act there, so the checkbox mustn't flip to a state never saved. */}
        <input
          type="checkbox"
          checked={bubbleOnForSite()}
          disabled={!hostname()}
          onChange={() => void onToggleBubbleForSite()}
        />
        <span>Show the floating translate bubble</span>
      </label>

      <div class="footerRow">
        <button
          type="button"
          class="moreToggle"
          aria-expanded={showMore()}
          aria-controls="popup-more"
          onClick={() => setShowMore(!showMore())}
        >
          <span class="chevron" aria-hidden="true" />
          {showMore() ? 'Less' : 'More'}
        </button>
        <button type="button" class="settingsBtn" onClick={openSettings}>
          Settings
        </button>
      </div>

      <div id="popup-more" class="moreSection" hidden={!showMore()}>
        <Show when={pillRow().length > 0}>
          <fieldset class="section">
            <legend class="sectionLabel">Recent languages</legend>
            <div class="pillRow">
              <For each={pillRow()}>
                {(code) => (
                  <button
                    type="button"
                    class="pill"
                    classList={{ on: code === config.targetLanguage }}
                    aria-pressed={code === config.targetLanguage}
                    onClick={() => void onTargetLanguageChange(code)}
                  >
                    {languageName(code)}
                  </button>
                )}
              </For>
            </div>
          </fieldset>
        </Show>

        <fieldset
          class="section siteRule"
          disabled={!hostname()}
          ref={(el) => {
            siteRuleGroup = el;
          }}
        >
          <legend class="sectionLabel">Translate this site</legend>
          <div class="segments">
            <For each={SITE_RULES}>
              {({ rule, label }) => (
                <label class="segment">
                  <input
                    type="radio"
                    name="siteRule"
                    value={rule}
                    checked={siteRule() === rule}
                    onChange={() => void onSiteRuleChange(rule)}
                  />
                  <span>{label}</span>
                </label>
              )}
            </For>
          </div>
        </fieldset>

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

        <Show when={ready()}>
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

        <button type="button" class="menuItem" disabled={!tabUrl()} onClick={openInGoogleTranslate}>
          Open in Google Translate
        </button>
      </div>
    </div>
  );
}

export default App;
