import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { providerDescriptors } from '../../src/engine/providers/descriptors';
import { translationCache } from '../../src/platform/cache/translationCache';
import { configStore } from '../../src/platform/configStore';
import { type DiagnosticsReport, runDiagnostics } from '../../src/platform/diagnostics';
import { type Config, type ConfigKey, defaultConfig } from '../../src/shared/config/schema';
import './App.css';

/**
 * The options page — General (languages) + Translation services + Auto-
 * translate list sections, per the Gen 3 plan's Session 6 scope ("start
 * with General + Translation services only"). Remaining old-repo sections
 * (Selection & hover, Voice, Dictionary, Advanced/diagnostics) don't exist
 * yet in Gen 3 at all — nothing to surface settings for — so this is 3
 * sections, not the old repo's 6-tab layout, on purpose.
 *
 * Mirrors `configStore` into a local Solid store (`settings`), synced via
 * `configStore.onChanged` — reading `configStore.get(...)` directly inside
 * JSX is a known foot-gun in this codebase's history (Solid doesn't
 * re-render on a plain object read that isn't tracked), so every field
 * here reads from the reactive `settings` store, never `configStore.get()`
 * directly.
 */

type StringListKey = 'alwaysTranslateSites' | 'neverTranslateSites' | 'alwaysTranslateLangs' | 'neverTranslateLangs';

function App() {
  const [settings, setSettings] = createStore<Config>({} as Config);
  const [ready, setReady] = createSignal(false);
  const [savedField, setSavedField] = createSignal<ConfigKey | null>(null);
  const [diagnostics, setDiagnostics] = createSignal<DiagnosticsReport | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = createSignal(false);
  const [cacheCleared, setCacheCleared] = createSignal(false);

  async function handleRunDiagnostics(): Promise<void> {
    setDiagnosticsRunning(true);
    setDiagnostics(await runDiagnostics());
    setDiagnosticsRunning(false);
  }

  async function handleClearCache(): Promise<void> {
    await translationCache.clear();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 1200);
    if (diagnostics()) await handleRunDiagnostics();
  }

  let savedTimeout: ReturnType<typeof setTimeout> | undefined;
  function flashSaved(key: ConfigKey): void {
    setSavedField(key);
    if (savedTimeout) clearTimeout(savedTimeout);
    savedTimeout = setTimeout(() => setSavedField(null), 1200);
  }

  onMount(async () => {
    await configStore.onReady();
    for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
      setSettings(key, configStore.get(key) as never);
    }
    setReady(true);
  });

  const unsubscribe = configStore.onChanged((name, value) => {
    setSettings(name, value as never);
  });
  onCleanup(unsubscribe);

  async function setField<K extends ConfigKey>(key: K, value: Config[K]): Promise<void> {
    setSettings(key, value as never);
    await configStore.set(key, value);
    flashSaved(key);
  }

  function parseList(text: string): string[] {
    return text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return (
    <div class="app">
      <header class="header">
        <h1>Prism Settings</h1>
      </header>

      <Show when={ready()} fallback={<p class="loading">Loading…</p>}>
        <section class="section">
          <h2>General</h2>
          <label class="field">
            <span>Translate into</span>
            <input
              type="text"
              value={settings.targetLanguage}
              onChange={(e) => void setField('targetLanguage', e.currentTarget.value)}
              placeholder="e.g. es, fr, ja"
            />
          </label>
          <label class="field">
            <span>Source language</span>
            <input
              type="text"
              value={settings.sourceLanguage}
              onChange={(e) => void setField('sourceLanguage', e.currentTarget.value)}
              placeholder="auto"
            />
          </label>
          <Show when={savedField() === 'targetLanguage' || savedField() === 'sourceLanguage'}>
            <p class="saved">Saved</p>
          </Show>
        </section>

        <section class="section">
          <h2>Translation service</h2>
          <label class="field">
            <span>Provider</span>
            <select
              value={settings.pageTranslatorProvider}
              onChange={(e) => void setField('pageTranslatorProvider', e.currentTarget.value as never)}
            >
              <For each={providerDescriptors}>{(d) => <option value={d.id}>{d.displayName}</option>}</For>
            </select>
          </label>

          <Show when={settings.pageTranslatorProvider === 'libretranslate'}>
            <div class="providerFields">
              <label class="field">
                <span>LibreTranslate base URL</span>
                <input
                  type="text"
                  value={settings.libreTranslateBaseUrl}
                  onChange={(e) => void setField('libreTranslateBaseUrl', e.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span>API key (optional)</span>
                <input
                  type="password"
                  value={settings.libreTranslateApiKey}
                  onChange={(e) => void setField('libreTranslateApiKey', e.currentTarget.value)}
                />
              </label>
            </div>
          </Show>

          <Show when={settings.pageTranslatorProvider === 'googleCloudTranslate'}>
            <div class="providerFields">
              <label class="field">
                <span>Google Cloud Translation API key</span>
                <input
                  type="password"
                  value={settings.googleCloudTranslateApiKey}
                  onChange={(e) => void setField('googleCloudTranslateApiKey', e.currentTarget.value)}
                />
              </label>
            </div>
          </Show>

          <Show when={settings.pageTranslatorProvider === 'llm'}>
            <div class="providerFields">
              <label class="field">
                <span>Base URL</span>
                <input
                  type="text"
                  value={settings.llmBaseUrl}
                  onChange={(e) => void setField('llmBaseUrl', e.currentTarget.value)}
                  placeholder="https://api.openai.com/v1/chat/completions or a local server URL"
                />
              </label>
              <label class="field">
                <span>API key</span>
                <input
                  type="password"
                  value={settings.llmApiKey}
                  onChange={(e) => void setField('llmApiKey', e.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span>Model</span>
                <input
                  type="text"
                  value={settings.llmModel}
                  onChange={(e) => void setField('llmModel', e.currentTarget.value)}
                  placeholder="e.g. gpt-4o-mini, llama3"
                />
              </label>
            </div>
          </Show>

          <Show when={settings.pageTranslatorProvider === 'google' || settings.pageTranslatorProvider === 'builtin'}>
            <p class="hint">No configuration needed for this provider.</p>
          </Show>

          <Show
            when={
              savedField() &&
              [
                'pageTranslatorProvider',
                'libreTranslateBaseUrl',
                'libreTranslateApiKey',
                'googleCloudTranslateApiKey',
                'llmBaseUrl',
                'llmApiKey',
                'llmModel',
              ].includes(savedField() ?? '')
            }
          >
            <p class="saved">Saved</p>
          </Show>
        </section>

        <section class="section">
          <h2>Automatic translation</h2>
          <p class="hint">
            One hostname or language code per line (or comma-separated). Always-translate takes priority over
            never-translate for the same site or language.
          </p>
          <StringListField label="Always translate these sites" fieldKey="alwaysTranslateSites" />
          <StringListField label="Never translate these sites" fieldKey="neverTranslateSites" />
          <StringListField label="Always translate from these languages" fieldKey="alwaysTranslateLangs" />
          <StringListField label="Never translate from these languages" fieldKey="neverTranslateLangs" />
        </section>

        <section class="section">
          <h2>Diagnostics</h2>
          <p class="hint">
            Checks what actually works in this browser — a storage round trip, capability detection, and the translation
            cache — rather than assuming.
          </p>
          <div class="diagnosticsActions">
            <button type="button" disabled={diagnosticsRunning()} onClick={() => void handleRunDiagnostics()}>
              {diagnosticsRunning() ? 'Running…' : 'Run diagnostics'}
            </button>
            <button type="button" onClick={() => void handleClearCache()}>
              Clear translation cache
            </button>
            <Show when={cacheCleared()}>
              <span class="saved inline">Cache cleared</span>
            </Show>
          </div>

          <Show when={diagnostics()}>
            {(report) => (
              <dl class="diagnosticsList">
                <dt>Storage round trip</dt>
                <dd class={report().storageRoundTripOk ? 'ok' : 'fail'}>
                  {report().storageRoundTripOk ? 'OK' : 'FAILED'}
                </dd>
                <dt>Translation cache size</dt>
                <dd>{report().cacheSizeBytes === null ? 'unavailable' : `${report().cacheSizeBytes} bytes`}</dd>
                <dt>i18n.detectLanguage available</dt>
                <dd class={report().hasI18nDetectLanguage ? 'ok' : 'fail'}>
                  {report().hasI18nDetectLanguage ? 'yes' : 'no'}
                </dd>
                <dt>scripting API available</dt>
                <dd class={report().hasScriptingApi ? 'ok' : 'fail'}>{report().hasScriptingApi ? 'yes' : 'no'}</dd>
                <dt>IndexedDB available</dt>
                <dd class={report().hasIndexedDb ? 'ok' : 'fail'}>{report().hasIndexedDb ? 'yes' : 'no'}</dd>
                <dt>Effective config (API keys redacted)</dt>
                <dd>
                  <pre class="configDump">{JSON.stringify(report().effectiveConfig, null, 2)}</pre>
                </dd>
              </dl>
            )}
          </Show>
        </section>
      </Show>
    </div>
  );

  function StringListField(props: { label: string; fieldKey: StringListKey }) {
    const [savedHere, setSavedHere] = createSignal(false);
    return (
      <label class="field">
        <span>{props.label}</span>
        <textarea
          rows={2}
          value={(settings[props.fieldKey] ?? []).join('\n')}
          onChange={async (e) => {
            await setField(props.fieldKey, parseList(e.currentTarget.value));
            setSavedHere(true);
            setTimeout(() => setSavedHere(false), 1200);
          }}
        />
        <Show when={savedHere()}>
          <span class="saved inline">Saved</span>
        </Show>
      </label>
    );
  }
}

export default App;
