import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { StringListEditor } from '../../components/options/StringListEditor';
import { TabPanel } from '../../components/options/TabPanel';
import { TabSwitcher } from '../../components/options/TabSwitcher';
import { providerDescriptors } from '../../src/engine/providers/descriptors';
import { translationCache } from '../../src/platform/cache/translationCache';
import { configStore } from '../../src/platform/configStore';
import { type DiagnosticsReport, runDiagnostics } from '../../src/platform/diagnostics';
import { parseBackup, serializeBackup } from '../../src/shared/config/backup';
import {
  addLangToAlwaysTranslate,
  addLangToNeverTranslate,
  addSiteToAlwaysTranslate,
  addSiteToNeverTranslate,
  type ListsSnapshot,
  removeLangFromAlwaysTranslate,
  removeLangFromNeverTranslate,
  removeSiteFromAlwaysTranslate,
  removeSiteFromNeverTranslate,
} from '../../src/shared/config/listMutations';
import { type Config, type ConfigKey, defaultConfig } from '../../src/shared/config/schema';
import { clearBubbleOverrideForHost, clearSourceLanguageOverrideForHost } from '../../src/shared/config/siteOverrides';
import { COMMON_LANGUAGES } from '../../src/shared/languages';
import './App.css';

/**
 * The options page — 5 tabs, restored toward the pre-rewrite fork's 6-tab
 * layout (no Voice/Dictionary tabs: those engine subsystems don't exist in
 * Gen 3 at all, so there's nothing to build settings UI for — a deliberate
 * scope boundary, not an oversight, agreed with the user alongside the
 * rest of this post-launch UI-depth pass; see this repo's CLAUDE.md).
 *
 * `TabSwitcher`/`TabPanel` (`components/options/`) are the ARIA APG
 * automatic-activation tablist ported from the fork, `StringListEditor`
 * the shared add/remove list widget. Keyboard math lives in
 * `src/shared/ui/tabNavigation.ts` (unit-tested, coverage-gated).
 *
 * Mirrors `configStore` into a local Solid store (`settings`), synced via
 * `configStore.onChanged` — reading `configStore.get(...)` directly inside
 * JSX is a known foot-gun in this codebase's history (Solid doesn't
 * re-render on a plain object read that isn't tracked), so every field
 * here reads from the reactive `settings` store, never `configStore.get()`
 * directly.
 */

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'page', label: 'Page translation' },
  { id: 'bubble', label: 'Bubble' },
  { id: 'selection', label: 'Selection & hover' },
  { id: 'advanced', label: 'Advanced' },
];

function App() {
  const [settings, setSettings] = createStore<Config>({} as Config);
  const [ready, setReady] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal('general');
  const [savedField, setSavedField] = createSignal<ConfigKey | null>(null);
  const [diagnostics, setDiagnostics] = createSignal<DiagnosticsReport | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = createSignal(false);
  const [cacheCleared, setCacheCleared] = createSignal(false);
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [restoredDefaults, setRestoredDefaults] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

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

  function listsSnapshot(): ListsSnapshot {
    return {
      alwaysTranslateSites: settings.alwaysTranslateSites,
      neverTranslateSites: settings.neverTranslateSites,
      alwaysTranslateLangs: settings.alwaysTranslateLangs,
      neverTranslateLangs: settings.neverTranslateLangs,
    };
  }

  async function applyPatch(patch: Partial<ListsSnapshot>): Promise<void> {
    await Promise.all(
      (Object.keys(patch) as Array<keyof ListsSnapshot>).map((key) => {
        const value = patch[key];
        return value === undefined ? Promise.resolve() : setField(key, value);
      }),
    );
  }

  // Every add/remove here goes through src/shared/config/listMutations.ts,
  // not a bare array push/filter — this is the fix for a real pre-rewrite
  // fork inconsistency: its popup applied cross-list cleanup (adding a
  // site to "always" removed it from "never"), its options page didn't.
  function handleExport(): void {
    const json = serializeBackup(settings as Config, Date.now());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prism-settings-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick(): void {
    fileInput?.click();
  }

  async function handleImportFile(e: Event): Promise<void> {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      setBackupMessage(result.error);
      return;
    }
    await configStore.import(JSON.stringify(result.value));
    setBackupMessage('Settings imported.');
    setTimeout(() => setBackupMessage(null), 3000);
    (e.currentTarget as HTMLInputElement).value = '';
  }

  async function handleRestoreDefaults(): Promise<void> {
    if (!confirm('Restore all settings to their defaults? This cannot be undone.')) return;
    await configStore.restoreToDefault();
    setRestoredDefaults(true);
    setTimeout(() => setRestoredDefaults(false), 2000);
  }

  function bubbleHostEntries(): Array<[string, boolean]> {
    return Object.entries(settings.bubbleByHost ?? {});
  }

  async function removeBubbleOverride(host: string): Promise<void> {
    await setField('bubbleByHost', clearBubbleOverrideForHost(settings.bubbleByHost, host));
  }

  function sourceLanguageHostEntries(): Array<[string, string]> {
    return Object.entries(settings.sourceLanguageByHost ?? {});
  }

  async function removeSourceLanguageOverride(host: string): Promise<void> {
    await setField('sourceLanguageByHost', clearSourceLanguageOverrideForHost(settings.sourceLanguageByHost, host));
  }

  return (
    <div class="app">
      <header class="header">
        <h1>Prism Settings</h1>
      </header>

      <Show when={ready()} fallback={<p class="loading">Loading…</p>}>
        <TabSwitcher tabs={TABS} activeId={activeTab()} onSelect={setActiveTab} />

        <TabPanel id="general" active={activeTab() === 'general'}>
          <section class="section">
            <h2>General</h2>
            <label class="field">
              <span>Theme</span>
              <select value={settings.theme} onChange={(e) => void setField('theme', e.currentTarget.value as never)}>
                <option value="auto">Match system</option>
                <option value="light">Always light</option>
                <option value="dark">Always dark</option>
              </select>
            </label>
            <label class="field">
              <span>Translate into</span>
              <select
                value={settings.targetLanguage}
                onChange={(e) => void setField('targetLanguage', e.currentTarget.value)}
              >
                <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
              </select>
            </label>
            <label class="field">
              <span>Source language</span>
              <select
                value={settings.sourceLanguage}
                onChange={(e) => void setField('sourceLanguage', e.currentTarget.value)}
              >
                <option value="auto">Detect automatically</option>
                <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
              </select>
            </label>
            <StringListEditor
              label="Preferred target languages"
              values={settings.targetLanguages ?? []}
              languageOptions
              onAdd={(code) =>
                void setField('targetLanguages', [...new Set([...(settings.targetLanguages ?? []), code])])
              }
              onRemove={(code) =>
                void setField(
                  'targetLanguages',
                  (settings.targetLanguages ?? []).filter((c) => c !== code),
                )
              }
            />
            <Show
              when={savedField() === 'theme' || savedField() === 'targetLanguage' || savedField() === 'sourceLanguage'}
            >
              <p class="saved">Saved</p>
            </Show>
          </section>

          <section class="section">
            <h2>Backup</h2>
            <p class="hint">
              Settings are stored on this device only (see the Advanced tab's diagnostics for why —
              `chrome.storage.sync` caused real, hard-to-diagnose bugs on some browsers). Export/import is the supported
              way to move them between devices.
            </p>
            <div class="backupActions">
              <button type="button" onClick={handleExport}>
                Export settings
              </button>
              <button type="button" class="secondary" onClick={handleImportClick}>
                Import settings
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(e) => void handleImportFile(e)}
              />
              <button type="button" class="danger" onClick={() => void handleRestoreDefaults()}>
                Restore defaults
              </button>
            </div>
            <Show when={backupMessage()}>
              <p class="saved">{backupMessage()}</p>
            </Show>
            <Show when={restoredDefaults()}>
              <p class="saved">Defaults restored.</p>
            </Show>
          </section>
        </TabPanel>

        <TabPanel id="page" active={activeTab() === 'page'}>
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

            <Show when={settings.pageTranslatorProvider === 'google'}>
              <p class="hint">No configuration needed for this provider.</p>
            </Show>

            <Show
              when={
                savedField() &&
                [
                  'pageTranslatorProvider',
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
            <StringListEditor
              label="Always translate these sites"
              values={settings.alwaysTranslateSites ?? []}
              placeholder="example.com"
              onAdd={(host) => void applyPatch(addSiteToAlwaysTranslate(listsSnapshot(), host))}
              onRemove={(host) => void applyPatch(removeSiteFromAlwaysTranslate(listsSnapshot(), host))}
            />
            <StringListEditor
              label="Never translate these sites"
              values={settings.neverTranslateSites ?? []}
              placeholder="example.com"
              onAdd={(host) => void applyPatch(addSiteToNeverTranslate(listsSnapshot(), host))}
              onRemove={(host) => void applyPatch(removeSiteFromNeverTranslate(listsSnapshot(), host))}
            />
            <StringListEditor
              label="Always translate from these languages"
              values={settings.alwaysTranslateLangs ?? []}
              languageOptions
              onAdd={(lang) => void applyPatch(addLangToAlwaysTranslate(listsSnapshot(), lang))}
              onRemove={(lang) => void applyPatch(removeLangFromAlwaysTranslate(listsSnapshot(), lang))}
            />
            <StringListEditor
              label="Never translate from these languages"
              values={settings.neverTranslateLangs ?? []}
              languageOptions
              onAdd={(lang) => void applyPatch(addLangToNeverTranslate(listsSnapshot(), lang))}
              onRemove={(lang) => void applyPatch(removeLangFromNeverTranslate(listsSnapshot(), lang))}
            />
          </section>
        </TabPanel>

        <TabPanel id="bubble" active={activeTab() === 'bubble'}>
          <section class="section">
            <h2>Floating bubble</h2>
            <label class="toggleRow">
              <input
                type="checkbox"
                checked={settings.bubbleEnabled}
                onChange={(e) => void setField('bubbleEnabled', e.currentTarget.checked)}
              />
              <span>Show the floating translate bubble by default</span>
            </label>
            <div class="bubbleActions">
              <button type="button" class="secondary" onClick={() => void setField('bubblePosition', null)}>
                Reset remembered position
              </button>
            </div>

            <p class="hint">Per-site overrides (set from the popup or the bubble's Hide chip):</p>
            <Show when={bubbleHostEntries().length > 0} fallback={<p class="listEditorEmpty">None</p>}>
              <ul class="siteTable">
                <For each={bubbleHostEntries()}>
                  {([host, shown]) => (
                    <li>
                      <span>
                        {host}: <span class="siteValue">{shown ? 'shown' : 'hidden'}</span>
                      </span>
                      <button
                        type="button"
                        class="removeBtn"
                        aria-label={`Remove override for ${host}`}
                        onClick={() => void removeBubbleOverride(host)}
                      >
                        ×
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </TabPanel>

        <TabPanel id="selection" active={activeTab() === 'selection'}>
          <section class="section">
            <h2>Selection & hover</h2>
            <label class="toggleRow">
              <input
                type="checkbox"
                checked={settings.hoverTooltipEnabled}
                onChange={(e) => void setField('hoverTooltipEnabled', e.currentTarget.checked)}
              />
              <span>Show original text when hovering over translated text</span>
            </label>
            <label class="toggleRow">
              <input
                type="checkbox"
                checked={settings.selectionPopupEnabled}
                onChange={(e) => void setField('selectionPopupEnabled', e.currentTarget.checked)}
              />
              <span>Show a button to translate selected text</span>
            </label>

            <p class="hint">Per-site source-language overrides (set from the bubble's "From" select):</p>
            <Show when={sourceLanguageHostEntries().length > 0} fallback={<p class="listEditorEmpty">None</p>}>
              <ul class="siteTable">
                <For each={sourceLanguageHostEntries()}>
                  {([host, lang]) => (
                    <li>
                      <span>
                        {host}: <span class="siteValue">{lang}</span>
                      </span>
                      <button
                        type="button"
                        class="removeBtn"
                        aria-label={`Remove override for ${host}`}
                        onClick={() => void removeSourceLanguageOverride(host)}
                      >
                        ×
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </TabPanel>

        <TabPanel id="advanced" active={activeTab() === 'advanced'}>
          <section class="section">
            <h2>Translation cache</h2>
            <label class="toggleRow">
              <input
                type="checkbox"
                checked={settings.translationCacheEnabled}
                onChange={(e) => void setField('translationCacheEnabled', e.currentTarget.checked)}
              />
              <span>Cache translations on disk (reduces repeat requests to the provider)</span>
            </label>
            <div class="diagnosticsActions">
              <button type="button" onClick={() => void handleClearCache()}>
                Clear translation cache
              </button>
              <Show when={cacheCleared()}>
                <span class="saved inline">Cache cleared</span>
              </Show>
            </div>
          </section>

          <section class="section">
            <h2>Diagnostics</h2>
            <p class="hint">
              Checks what actually works in this browser — a storage round trip, capability detection, and the
              translation cache — rather than assuming.
            </p>
            <div class="diagnosticsActions">
              <button type="button" disabled={diagnosticsRunning()} onClick={() => void handleRunDiagnostics()}>
                {diagnosticsRunning() ? 'Running…' : 'Run diagnostics'}
              </button>
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
        </TabPanel>
      </Show>
    </div>
  );
}

export default App;
