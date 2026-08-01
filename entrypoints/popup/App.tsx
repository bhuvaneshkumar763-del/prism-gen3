import { createSignal, onMount, Show } from 'solid-js';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import { configStore } from '../../src/platform/configStore';
import { sendMessage } from '../../src/platform/messaging/protocol';
import { getActiveTabId } from '../../src/platform/messaging/tabTarget';
import './App.css';

/**
 * Triggers the real page-translation engine
 * (`src/engine/pageTranslator/translateLoop.ts`, wired into
 * `entrypoints/content.ts`) — translate/restore the whole active tab.
 * Session 6: rewired onto the typed messaging protocol and the shared
 * `getActiveTabId()` helper (`src/platform/messaging/tabTarget.ts`), the
 * same one `background.ts`'s context-menu/keyboard-command handlers use —
 * no more hand-duplicated tab-lookup logic per entry point. Still not the
 * fully polished popup UI (language pickers, service switcher, ... —
 * options page lands this session; further popup polish is a follow-up).
 */
function App() {
  const [status, setStatus] = createSignal<'idle' | 'busy' | 'error'>('idle');
  const [pageState, setPageState] = createSignal<PageLanguageState>('original');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  onMount(async () => {
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

  async function onTranslateClick() {
    setStatus('busy');
    setErrorMessage(null);
    try {
      await configStore.onReady();
      const targetLanguage = configStore.get('targetLanguage');
      const tabId = await getActiveTabId();
      const state = await sendMessage('pageTranslate', { targetLanguage }, tabId);
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
