import { createSignal, For, Show } from 'solid-js';
import { StringListEditor } from '../../../components/options/StringListEditor';
import { providerDescriptors } from '../../../src/engine/providers/descriptors';
import { sendMessage } from '../../../src/platform/messaging/protocol';
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
} from '../../../src/shared/config/listMutations';
import { missingProviderSetup } from '../../../src/shared/config/providerSetup';
import { clearSourceLanguageOverrideForHost } from '../../../src/shared/config/siteOverrides';
import { languageLabel } from '../../../src/shared/languageLabel';
import { describeTranslationTest, pickTranslationTestSample } from '../../../src/shared/translationTest';
import { describeError, type SettingsTabProps } from './types';

/**
 * Page translation tab: provider and its setup, the always/never lists, the
 * bubble's per-site source languages, content handling.
 */
export function PageTranslationTab(props: SettingsTabProps) {
  const [testRunning, setTestRunning] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  const providerGaps = () => missingProviderSetup(props.settings.pageTranslatorProvider, props.settings);

  /**
   * Provider fields save on change, as focus leaves them, which can be after
   * the Test button's click starts. The test saves a key still in the box and
   * waits for pending saves, so it never runs on the old key.
   */
  let providerSaves: Promise<unknown> = Promise.resolve();
  let apiKeyInput: HTMLInputElement | undefined;
  function saveProviderField(...args: Parameters<SettingsTabProps['setField']>): void {
    providerSaves = Promise.all([providerSaves, props.setField(...args)]);
  }

  /**
   * Diagnostics test: sends one short sample through the same background path
   * page translation uses, to answer "does translation work right now?".
   */
  async function handleTestTranslation(): Promise<void> {
    setTestRunning(true);
    setTestResult(null);
    const sample = pickTranslationTestSample(props.settings.targetLanguage);
    const started = performance.now();
    try {
      if (apiKeyInput?.isConnected && apiKeyInput.value !== props.settings.googleCloudTranslateApiKey) {
        saveProviderField('googleCloudTranslateApiKey', apiKeyInput.value);
      }
      await providerSaves;
      const result = await sendMessage('translateText', sample);
      setTestResult(describeTranslationTest(sample, result, performance.now() - started));
    } catch (e) {
      setTestResult({ ok: false, message: `Not working: ${describeError(e)}` });
    } finally {
      setTestRunning(false);
    }
  }

  // Every add/remove goes through src/shared/config/listMutations.ts so the
  // always/never cross-list cleanup matches the popup's.
  function listsSnapshot(): ListsSnapshot {
    return {
      alwaysTranslateSites: props.settings.alwaysTranslateSites,
      neverTranslateSites: props.settings.neverTranslateSites,
      alwaysTranslateLangs: props.settings.alwaysTranslateLangs,
      neverTranslateLangs: props.settings.neverTranslateLangs,
    };
  }

  async function applyPatch(patch: Partial<ListsSnapshot>): Promise<void> {
    await Promise.all(
      (Object.keys(patch) as Array<keyof ListsSnapshot>).map((key) => {
        const value = patch[key];
        return value === undefined ? Promise.resolve() : props.setField(key, value);
      }),
    );
  }

  function sourceLanguageHostEntries(): Array<[string, string]> {
    return Object.entries(props.settings.sourceLanguageByHost ?? {});
  }

  async function removeSourceLanguageOverride(host: string): Promise<void> {
    await props.setField(
      'sourceLanguageByHost',
      clearSourceLanguageOverrideForHost(props.settings.sourceLanguageByHost, host),
    );
  }

  return (
    <>
      <section class="section">
        <h2>Translation service</h2>
        <label class="field">
          <span>Provider</span>
          <select
            value={props.settings.pageTranslatorProvider}
            onChange={(e) => saveProviderField('pageTranslatorProvider', e.currentTarget.value as never)}
          >
            <For each={providerDescriptors}>{(d) => <option value={d.id}>{d.displayName}</option>}</For>
          </select>
        </label>

        <Show when={props.settings.pageTranslatorProvider === 'googleCloudTranslate'}>
          <div class="providerFields">
            <label class="field">
              <span>Google Cloud Translation API key</span>
              <input
                ref={apiKeyInput}
                type="password"
                value={props.settings.googleCloudTranslateApiKey}
                onChange={(e) => saveProviderField('googleCloudTranslateApiKey', e.currentTarget.value)}
              />
            </label>
          </div>
        </Show>

        <Show when={props.settings.pageTranslatorProvider === 'google'}>
          <p class="hint">No configuration needed for this provider.</p>
        </Show>

        <Show when={providerGaps()}>
          {(gaps) => (
            <p class="setupWarning" role="status">
              Needs setup: {gaps().join(', ')}.
            </p>
          )}
        </Show>

        <div class="testRow">
          <button type="button" disabled={testRunning()} onClick={() => void handleTestTranslation()}>
            {testRunning() ? 'Testing…' : 'Test translation'}
          </button>
          <Show when={testResult()}>
            {(result) => (
              <p class="testResult" classList={{ ok: result().ok, bad: !result().ok }} role="status">
                {result().message}
              </p>
            )}
          </Show>
        </div>

        <Show
          when={
            props.savedField() &&
            ['pageTranslatorProvider', 'googleCloudTranslateApiKey'].includes(props.savedField() ?? '')
          }
        >
          <p class="saved">Saved</p>
        </Show>
      </section>

      <section class="section">
        <h2>Automatic translation</h2>
        <p class="hint">
          Type a site (like example.com) and tap Add, or pick a language from its menu. If a site or language is on both
          an "always" and a "never" list, "never" wins.
        </p>
        <StringListEditor
          label="Always translate these sites"
          values={props.settings.alwaysTranslateSites ?? []}
          placeholder="example.com"
          onAdd={(host) => void applyPatch(addSiteToAlwaysTranslate(listsSnapshot(), host))}
          onRemove={(host) => void applyPatch(removeSiteFromAlwaysTranslate(listsSnapshot(), host))}
        />
        <StringListEditor
          label="Never translate these sites"
          values={props.settings.neverTranslateSites ?? []}
          placeholder="example.com"
          onAdd={(host) => void applyPatch(addSiteToNeverTranslate(listsSnapshot(), host))}
          onRemove={(host) => void applyPatch(removeSiteFromNeverTranslate(listsSnapshot(), host))}
        />
        <StringListEditor
          label="Always translate from these languages"
          values={props.settings.alwaysTranslateLangs ?? []}
          languageOptions
          onAdd={(lang) => void applyPatch(addLangToAlwaysTranslate(listsSnapshot(), lang))}
          onRemove={(lang) => void applyPatch(removeLangFromAlwaysTranslate(listsSnapshot(), lang))}
        />
        <StringListEditor
          label="Never translate from these languages"
          values={props.settings.neverTranslateLangs ?? []}
          languageOptions
          onAdd={(lang) => void applyPatch(addLangToNeverTranslate(listsSnapshot(), lang))}
          onRemove={(lang) => void applyPatch(removeLangFromNeverTranslate(listsSnapshot(), lang))}
        />
      </section>

      <section class="section">
        <h2>Source language picked in the bubble</h2>
        <p class="hint">
          Picking a language in the bubble's "From" menu retranslates the current page from that language right now — a
          one-off correction for when auto-detection got the whole page wrong, not a standing rule. A fresh page load
          goes back to automatic detection.
        </p>
        <Show when={sourceLanguageHostEntries().length > 0} fallback={<p class="listEditorEmpty">None</p>}>
          <ul class="siteTable">
            <For each={sourceLanguageHostEntries()}>
              {([host, lang]) => (
                <li>
                  <span>
                    {host}: <span class="siteValue">{languageLabel(lang)}</span>
                  </span>
                  <button
                    type="button"
                    class="removeBtn"
                    aria-label={`Remove override for ${host}`}
                    title={`Remove override for ${host}`}
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

      <section class="section">
        <h2>Content handling</h2>
        <label class="toggleRow">
          <input
            type="checkbox"
            checked={props.settings.translatePreTags}
            onChange={(e) => void props.setField('translatePreTags', e.currentTarget.checked)}
          />
          <span>
            Translate text inside &lt;pre&gt; blocks (off by default to protect code samples — turn this on if a site
            uses &lt;pre&gt; for plain text instead, and its content isn't being translated)
          </span>
        </label>
        <label class="toggleRow">
          <input
            type="checkbox"
            checked={props.settings.groupParagraphs}
            onChange={(e) => void props.setField('groupParagraphs', e.currentTarget.checked)}
          />
          <span>
            Translate each paragraph as a whole, for better sentence context. Leave this on for sites that wrap every
            word separately, like sangtacviet: turning it off translates those word by word. Turn it off only if a page
            comes out with words moved between links or styled text, or chips and tags run together.
          </span>
        </label>
      </section>
    </>
  );
}
