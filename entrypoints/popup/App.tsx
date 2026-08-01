import { createSignal, onMount, Show } from 'solid-js';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import { configStore } from '../../src/platform/configStore';
import './App.css';

/**
 * Session 5 update: triggers the real page-translation engine
 * (`src/engine/pageTranslator/translateLoop.ts`, wired into
 * `entrypoints/content.ts`) — translate/restore the whole active tab, not
 * just a demo `<p>`. Still not the real popup UI (language pickers,
 * service switcher, ... — that's Session 6); this is the minimal control
 * surface needed to exercise the real engine end to end.
 */
function App() {
  const [status, setStatus] = createSignal<'idle' | 'busy' | 'error'>('idle');
  const [pageState, setPageState] = createSignal<PageLanguageState>('original');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  async function activeTabId(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    return tab.id;
  }

  onMount(async () => {
    try {
      const tabId = await activeTabId();
      const state = (await browser.tabs.sendMessage(tabId, { type: 'getPageState' })) as PageLanguageState;
      setPageState(state);
    } catch {
      // No content script alive yet in this tab (e.g. a chrome:// page, or
      // a tab that predates install) — leave the default 'original' state;
      // the translate button below will still surface any real failure.
    }
  });

  async function onTranslateClick() {
    setStatus('busy');
    setErrorMessage(null);
    try {
      await configStore.onReady();
      const targetLanguage = configStore.get('targetLanguage');
      const tabId = await activeTabId();
      const state = (await browser.tabs.sendMessage(tabId, {
        type: 'pageTranslate',
        targetLanguage,
      })) as PageLanguageState;
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
      const tabId = await activeTabId();
      const state = (await browser.tabs.sendMessage(tabId, { type: 'pageRestore' })) as PageLanguageState;
      setPageState(state);
      setStatus('idle');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div class="app">
      <h1>Prism (Gen 3)</h1>
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
