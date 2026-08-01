import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import { providerDescriptors } from '../../src/engine/providers/descriptors';
import { configStore } from '../../src/platform/configStore';
import { sendMessage } from '../../src/platform/messaging/protocol';
import { getActiveTabId } from '../../src/platform/messaging/tabTarget';
import { COMMON_LANGUAGES } from '../../src/shared/languages';
import './App.css';

/**
 * Triggers the real page-translation engine
 * (`src/engine/pageTranslator/translateLoop.ts`, wired into
 * `entrypoints/content.ts`) — translate/restore the whole active tab.
 * Rewired onto the typed messaging protocol and the shared
 * `getActiveTabId()` helper (`src/platform/messaging/tabTarget.ts`), the
 * same one `background.ts`'s context-menu/keyboard-command handlers use.
 *
 * Polish pass: a target-language quick-pick (from
 * `src/shared/languages.ts`'s curated common-language list — not the full
 * generated table Session 7 schedules) and a provider quick-switch, both
 * writing straight to `configStore` so they stay in sync with the options
 * page. Reads `configStore.get(...)` once on mount into local signals and
 * updates them on `configStore.onChanged` — never reads `configStore.get()`
 * directly inside JSX (the known Solid-reactivity foot-gun already
 * documented elsewhere in this codebase).
 */
function App() {
  const [status, setStatus] = createSignal<'idle' | 'busy' | 'error'>('idle');
  const [pageState, setPageState] = createSignal<PageLanguageState>('original');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [targetLanguage, setTargetLanguage] = createSignal('es');
  const [provider, setProvider] = createSignal('libretranslate');
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    await configStore.onReady();
    setTargetLanguage(configStore.get('targetLanguage'));
    setProvider(configStore.get('pageTranslatorProvider'));
    setReady(true);

    try {
      const tabId = await getActiveTabId();
      const state = await sendMessage('getPageState', undefined, tabId);
      setPageState(state);
    } catch {
      // No content script alive yet in this tab (e.g. a chrome:// page, or
      // a tab that predates install) — leave the default 'original' state;
      // the translate button below will still surface any real failure.
    }
  });

  const unsubscribe = configStore.onChanged((name, value) => {
    if (name === 'targetLanguage') setTargetLanguage(value as string);
    if (name === 'pageTranslatorProvider') setProvider(value as string);
  });
  onCleanup(unsubscribe);

  async function onTargetLanguageChange(code: string): Promise<void> {
    setTargetLanguage(code);
    await configStore.set('targetLanguage', code);
  }

  async function onProviderChange(id: string): Promise<void> {
    setProvider(id);
    await configStore.set('pageTranslatorProvider', id as never);
  }

  async function onTranslateClick() {
    setStatus('busy');
    setErrorMessage(null);
    try {
      await configStore.onReady();
      const tabId = await getActiveTabId();
      const state = await sendMessage('pageTranslate', { targetLanguage: targetLanguage() }, tabId);
      setPageState(state);
      setStatus('idle');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  async function onRestoreClick() {
    setStatus('busy');
    setErrorMessage(null);
    try {
      const tabId = await getActiveTabId();
      const state = await sendMessage('pageRestore', undefined, tabId);
      setPageState(state);
      setStatus('idle');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div class="app">
      <h1>Prism</h1>

      <Show when={ready()}>
        <label class="quickField">
          <span>Translate into</span>
          <select value={targetLanguage()} onChange={(e) => void onTargetLanguageChange(e.currentTarget.value)}>
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
        </label>

        <label class="quickField">
          <span>Service</span>
          <select value={provider()} onChange={(e) => void onProviderChange(e.currentTarget.value)}>
            <For each={providerDescriptors}>{(d) => <option value={d.id}>{d.displayName}</option>}</For>
          </select>
        </label>
      </Show>

      <Show
        when={pageState() === 'translated'}
        fallback={
          <button type="button" disabled={status() === 'busy'} onClick={onTranslateClick}>
            {status() === 'busy' ? 'Translating…' : 'Translate this page'}
          </button>
        }
      >
        <button type="button" disabled={status() === 'busy'} onClick={onRestoreClick}>
          {status() === 'busy' ? 'Restoring…' : 'Show original'}
        </button>
      </Show>

      <Show when={status() === 'error'}>
        <p class="error">Error: {errorMessage()}</p>
      </Show>
    </div>
  );
}

export default App;
