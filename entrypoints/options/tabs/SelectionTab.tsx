import { For, Show } from 'solid-js';
import { clearSourceLanguageOverrideForHost } from '../../../src/shared/config/siteOverrides';
import { languageLabel } from '../../../src/shared/languageLabel';
import type { SettingsTabProps } from './types';

/** Selection & hover tab: hover tooltip, the selection button, and per-site source-language overrides. */
export function SelectionTab(props: SettingsTabProps) {
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
    <section class="section">
      <h2>Selection & hover</h2>
      <label class="toggleRow">
        <input
          type="checkbox"
          checked={props.settings.hoverTooltipEnabled}
          onChange={(e) => void props.setField('hoverTooltipEnabled', e.currentTarget.checked)}
        />
        <span>Show original text when hovering over translated text</span>
      </label>
      <label class="toggleRow">
        <input
          type="checkbox"
          checked={props.settings.selectionPopupEnabled}
          onChange={(e) => void props.setField('selectionPopupEnabled', e.currentTarget.checked)}
        />
        <span>Show a button to translate selected text</span>
      </label>
      <label class="toggleRow">
        <input
          type="checkbox"
          checked={props.settings.selectionPopupSkipInvalidText}
          onChange={(e) => void props.setField('selectionPopupSkipInvalidText', e.currentTarget.checked)}
        />
        <span>Don't show the button for a single character or a selection with nothing to translate</span>
      </label>
      <label class="toggleRow">
        <input
          type="checkbox"
          checked={props.settings.selectionPopupSkipTargetLanguageText}
          onChange={(e) => void props.setField('selectionPopupSkipTargetLanguageText', e.currentTarget.checked)}
        />
        <span>Don't show the button when the selected text is already in your target language</span>
      </label>

      <p class="hint">
        Per-site source-language overrides (set from the bubble's "From" select) force-retranslate the current page from
        that language right now — a one-off correction for when auto-detection got the whole page wrong, not a standing
        rule. A fresh page load goes back to automatic detection.
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
  );
}
