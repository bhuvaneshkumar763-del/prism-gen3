import { createSignal, For, Show } from 'solid-js';
import { translationCache } from '../../../src/platform/cache/translationCache';
import { type DiagnosticsReport, describeDiagnostics, runDiagnostics } from '../../../src/platform/diagnostics';
import { describeError, type SettingsTabProps } from './types';

/** Advanced tab: the translation cache and diagnostics. */
export function AdvancedTab(props: SettingsTabProps) {
  const [diagnostics, setDiagnostics] = createSignal<DiagnosticsReport | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = createSignal(false);
  const [cacheCleared, setCacheCleared] = createSignal(false);
  const [clearingCache, setClearingCache] = createSignal(false);

  async function handleRunDiagnostics(): Promise<void> {
    setDiagnosticsRunning(true);
    setDiagnostics(await runDiagnostics());
    setDiagnosticsRunning(false);
  }

  async function handleClearCache(): Promise<void> {
    setClearingCache(true);
    try {
      await translationCache.clear();
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 1200);
      if (diagnostics()) await handleRunDiagnostics();
    } catch (e) {
      props.onError(`Couldn't clear the cache: ${describeError(e)}`);
    } finally {
      setClearingCache(false);
    }
  }

  return (
    <>
      <section class="section">
        <h2>Translation cache</h2>
        <label class="toggleRow">
          <input
            type="checkbox"
            checked={props.settings.translationCacheEnabled}
            onChange={(e) => void props.setField('translationCacheEnabled', e.currentTarget.checked)}
          />
          <span>Cache translations on disk (reduces repeat requests to the provider)</span>
        </label>
        <div class="diagnosticsActions">
          <button type="button" disabled={clearingCache()} onClick={() => void handleClearCache()}>
            {clearingCache() ? 'Clearing…' : 'Clear translation cache'}
          </button>
          <Show when={cacheCleared()}>
            <span class="saved inline">Cache cleared</span>
          </Show>
        </div>
      </section>

      <section class="section">
        <h2>Diagnostics</h2>
        <p class="hint">
          Checks what works in this browser right now: saving settings, language detection, and the translation cache.
        </p>
        <div class="diagnosticsActions">
          <button type="button" disabled={diagnosticsRunning()} onClick={() => void handleRunDiagnostics()}>
            {diagnosticsRunning() ? 'Running…' : 'Run diagnostics'}
          </button>
        </div>

        <Show when={diagnostics()}>
          {(report) => (
            <dl class="diagnosticsList">
              <For each={describeDiagnostics(report())}>
                {(row) => (
                  <div class="diagnosticsRow">
                    <dt>{row.label}</dt>
                    <dd classList={{ ok: row.status === 'ok', fail: row.status === 'fail' }}>{row.value}</dd>
                  </div>
                )}
              </For>
              <div class="diagnosticsRow">
                <dt>Your settings, for a support request (API keys hidden)</dt>
                <dd>
                  <pre class="configDump">{JSON.stringify(report().effectiveConfig, null, 2)}</pre>
                </dd>
              </div>
            </dl>
          )}
        </Show>
      </section>
    </>
  );
}
