import { createSignal, Show } from 'solid-js';
import './App.css';

/**
 * Session 2's minimal vertical slice popup: click "Translate" to fetch the
 * active tab's first <p> text, translate it via the background script's
 * LibreTranslate provider, and write the result back onto the page. Not
 * the real popup UI (that's a later session) — just enough to prove the
 * pipeline works end to end with a real network call.
 */
function App() {
  const [status, setStatus] = createSignal<'idle' | 'translating' | 'done' | 'error'>('idle');
  const [original, setOriginal] = createSignal<string | null>(null);
  const [translated, setTranslated] = createSignal<string | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  async function onTranslateClick() {
    setStatus('translating');
    setErrorMessage(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');

      const sampleText = (await browser.tabs.sendMessage(tab.id, { type: 'getSampleText' })) as string | null;
      if (!sampleText) throw new Error('No <p> found on this page');
      setOriginal(sampleText);

      const result = (await browser.runtime.sendMessage({
        type: 'translateText',
        text: sampleText,
        sourceLanguage: 'en',
        targetLanguage: 'es',
      })) as { ok: true; value: string } | { ok: false; error: { message: string } };

      if (!result.ok) throw new Error(result.error.message);
      setTranslated(result.value);

      await browser.tabs.sendMessage(tab.id, { type: 'applyTranslatedText', text: result.value });
      setStatus('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div class="app">
      <h1>Prism (Gen 3)</h1>
      <button type="button" disabled={status() === 'translating'} onClick={onTranslateClick}>
        {status() === 'translating' ? 'Translating…' : 'Translate first paragraph'}
      </button>

      <Show when={original()}>
        <p>
          <strong>Original:</strong> {original()}
        </p>
      </Show>
      <Show when={translated()}>
        <p>
          <strong>Translated:</strong> {translated()}
        </p>
      </Show>
      <Show when={status() === 'error'}>
        <p class="error">Error: {errorMessage()}</p>
      </Show>
    </div>
  );
}

export default App;
