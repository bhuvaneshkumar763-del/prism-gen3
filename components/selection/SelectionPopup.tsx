import { Show } from 'solid-js';
import { TRANSLATE_ICON_PATH } from '../../src/shared/ui/icons';
import type { SelectionPanelPlacement } from '../../src/shared/ui/selectionPanelPlacement';

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
  onTranslateClick: (e: MouseEvent) => void;
  panelOpen: boolean;
  /** Viewport-clamped placement — see `selectionPanelPlacement.ts`. */
  panel: SelectionPanelPlacement;
  busy: boolean;
  translatedText: string;
  errorMessage: string | null;
  onCloseClick: (e: MouseEvent) => void;
  onCopyClick: (e: MouseEvent) => void;
  copyStatus: 'idle' | 'copied' | 'failed';
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
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={TRANSLATE_ICON_PATH} />
          </svg>
        </button>
      </Show>

      <Show when={props.panelOpen}>
        <div
          class="panel"
          style={{
            left: `${props.panel.left}px`,
            top: props.panel.top === null ? undefined : `${props.panel.top}px`,
            bottom: props.panel.bottom === null ? undefined : `${props.panel.bottom}px`,
            'max-width': `${props.panel.maxWidth}px`,
            'max-height': `${props.panel.maxHeight}px`,
          }}
          // Announces the translation when it lands, rather than leaving a
          // screen-reader user with a silent "Translating…" that never ends.
          role="status"
          aria-live="polite"
        >
          <Show when={props.busy}>
            <span class="status">
              <span class="spinner" />
              Translating…
            </span>
          </Show>
          <Show when={!props.busy && props.translatedText}>
            <p class="result">{props.translatedText}</p>
            <button
              type="button"
              class="copy"
              // Keeps the page's own text selection intact when clicked.
              onMouseDown={(e) => e.preventDefault()}
              onClick={props.onCopyClick}
            >
              {props.copyStatus === 'copied' ? 'Copied' : props.copyStatus === 'failed' ? 'Copy failed' : 'Copy'}
            </button>
          </Show>
          <Show when={!props.busy && props.errorMessage}>
            <p class="errorText" role="alert">
              {props.errorMessage}
            </p>
          </Show>
          <button type="button" class="close" aria-label="Close" onClick={props.onCloseClick}>
            ×
          </button>
        </div>
      </Show>
    </>
  );
}
