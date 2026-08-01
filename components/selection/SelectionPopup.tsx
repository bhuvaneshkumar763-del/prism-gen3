import { Show } from 'solid-js';

/**
 * "Translate selected text": a small button appears near a text selection;
 * clicking it translates just that selection and shows the result in a
 * panel underneath. Pure presentation — `mountSelectionPopup.ts` owns
 * selection detection/positioning/the actual translate call.
 *
 * Scope decision (Session 6): a fresh, deliberately simpler design than
 * the old repo's ~1300-line `translateSelected.js`/583-line
 * `SelectionPopup.tsx` — no drag-to-move, no editable replace-in-place, no
 * listen/copy actions, no cross-frame focus arbitration, no per-selection
 * service/language pickers (uses the page's configured provider/target
 * language). Real and functional, not a placeholder: it detects a
 * selection, translates it, and shows the result — the rest is a
 * documented follow-up, matching the same "diverge and say why" call
 * already made for the floating bubble.
 */
export interface SelectionPopupProps {
  buttonVisible: boolean;
  buttonTop: number;
  buttonLeft: number;
  onTranslateClick: () => void;
  panelOpen: boolean;
  busy: boolean;
  translatedText: string;
  errorMessage: string | null;
  onCloseClick: () => void;
}

export function SelectionPopup(props: SelectionPopupProps) {
  return (
    <>
      <Show when={props.buttonVisible && !props.panelOpen}>
        <button
          type="button"
          class="trigger"
          style={{ top: `${props.buttonTop}px`, left: `${props.buttonLeft}px` }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onTranslateClick}
          aria-label="Translate selection"
        >
          T
        </button>
      </Show>

      <Show when={props.panelOpen}>
        <div class="panel" style={{ top: `${props.buttonTop}px`, left: `${props.buttonLeft}px` }}>
          <Show when={props.busy}>
            <span class="status">Translating…</span>
          </Show>
          <Show when={!props.busy && props.translatedText}>
            <p class="result">{props.translatedText}</p>
          </Show>
          <Show when={!props.busy && props.errorMessage}>
            <p class="errorText">{props.errorMessage}</p>
          </Show>
          <button type="button" class="close" aria-label="Close" onClick={props.onCloseClick}>
            ×
          </button>
        </div>
      </Show>
    </>
  );
}
