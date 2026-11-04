import type { SettingsTabProps } from './types';

/** Selection & hover tab: the hover tooltip and the selection button. */
export function SelectionTab(props: SettingsTabProps) {
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
    </section>
  );
}
