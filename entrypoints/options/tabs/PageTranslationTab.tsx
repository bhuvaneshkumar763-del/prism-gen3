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
import { describeTranslationTest, pickTranslationTestSample } from '../../../src/shared/translationTest';
import { describeError, type SettingsTabProps } from './types';

/** Page translation tab: provider and its setup, the always/never lists, content handling. */
export function PageTranslationTab(props: SettingsTabProps) {
  const [testRunning, setTestRunning] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null);
  const providerGaps = () => missingProviderSetup(props.settings.pageTranslatorProvider, props.settings);

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

  return (
    <>
      <section class="section">
        <h2>Translation service</h2>
        <label class="field">
          <span>Provider</span>
          <select
            value={props.settings.pageTranslatorProvider}
            onChange={(e) => void props.setField('pageTranslatorProvider', e.currentTarget.value as never)}
          >
            <For each={providerDescriptors}>{(d) => <option value={d.id}>{d.displayName}</option>}</For>
          </select>
        </label>

        <Show when={props.settings.pageTranslatorProvider === 'googleCloudTranslate'}>
          <div class="providerFields">
            <label class="field">
              <span>Google Cloud Translation API key</span>
              <input
                type="password"
                value={props.settings.googleCloudTranslateApiKey}
                onChange={(e) => void props.setField('googleCloudTranslateApiKey', e.currentTarget.value)}
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
