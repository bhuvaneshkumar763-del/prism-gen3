import { createSignal, Show } from 'solid-js';
import { TabPanel } from '../../components/options/TabPanel';
import { TabSwitcher } from '../../components/options/TabSwitcher';
import { createConfigMirror } from '../../components/shared/configMirror';
import { configStore } from '../../src/platform/configStore';
import type { Config, ConfigKey } from '../../src/shared/config/schema';
import { AdvancedTab } from './tabs/AdvancedTab';
import { BubbleTab } from './tabs/BubbleTab';
import { GeneralTab } from './tabs/GeneralTab';
import { PageTranslationTab } from './tabs/PageTranslationTab';
import { SelectionTab } from './tabs/SelectionTab';
import { describeError, type SettingsTabProps } from './tabs/types';
import './App.css';

/**
 * The options page shell: 5 tabs (no Voice/Dictionary; those subsystems don't
 * exist), one component each under `tabs/`. Config comes from
 * `createConfigMirror`; JSX never reads `configStore.get()` directly, since
 * Solid wouldn't track it.
 */

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'page', label: 'Page translation' },
  { id: 'bubble', label: 'Bubble' },
  { id: 'selection', label: 'Selection & hover' },
  { id: 'advanced', label: 'Advanced' },
];

function App() {
  const { config: settings, ready, setLocal } = createConfigMirror(configStore);

  // Deep-linkable (options.html#page): the popup and bubble open Settings
  // straight at the provider fields when you pick a provider that needs setup.
  const initialTab = TABS.find((t) => `#${t.id}` === location.hash)?.id ?? 'general';
  const [activeTab, setActiveTab] = createSignal(initialTab);
  const [savedField, setSavedField] = createSignal<ConfigKey | null>(null);
  /**
   * Shown when a storage write (setField, import, restore defaults, clear
   * cache) fails, so the page doesn't silently show an unsaved value.
   */
  const [saveError, setSaveError] = createSignal<string | null>(null);

  let savedTimeout: ReturnType<typeof setTimeout> | undefined;
  function flashSaved(key: ConfigKey): void {
    setSavedField(key);
    if (savedTimeout) clearTimeout(savedTimeout);
    savedTimeout = setTimeout(() => setSavedField(null), 1200);
  }

  async function setField<K extends ConfigKey>(key: K, value: Config[K]): Promise<void> {
    const previous = settings[key];
    setLocal(key, value);
    try {
      await configStore.set(key, value);
      flashSaved(key);
    } catch (e) {
      // Roll back the optimistic update so the field doesn't show an unsaved value.
      setLocal(key, previous);
      setSaveError(`Couldn't save this setting: ${describeError(e)}`);
    }
  }

  const tabProps: SettingsTabProps = { settings, setField, savedField, onError: setSaveError };

  return (
    <div class="app">
      <header class="header">
        <h1>Prism Settings</h1>
      </header>

      <Show when={saveError()}>
        <div class="saveError" role="alert">
          <span>{saveError()}</span>
          <button type="button" onClick={() => setSaveError(null)}>
            Dismiss
          </button>
        </div>
      </Show>

      <Show when={ready()} fallback={<p class="loading">Loading…</p>}>
        <TabSwitcher tabs={TABS} activeId={activeTab()} onSelect={setActiveTab} />

        <TabPanel id="general" active={activeTab() === 'general'}>
          <GeneralTab {...tabProps} />
        </TabPanel>

        <TabPanel id="page" active={activeTab() === 'page'}>
          <PageTranslationTab {...tabProps} />
        </TabPanel>

        <TabPanel id="bubble" active={activeTab() === 'bubble'}>
          <BubbleTab {...tabProps} />
        </TabPanel>

        <TabPanel id="selection" active={activeTab() === 'selection'}>
          <SelectionTab {...tabProps} />
        </TabPanel>

        <TabPanel id="advanced" active={activeTab() === 'advanced'}>
          <AdvancedTab {...tabProps} />
        </TabPanel>
      </Show>
    </div>
  );
}

export default App;
