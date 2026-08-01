import { render } from 'solid-js/web';
import { getSelectionInfo } from '../../src/engine/selection/selectionInfo';
import type { Translator } from '../../src/engine/translator';
import { translateOne } from '../../src/engine/translator';
import { SelectionPopup } from './SelectionPopup';
import { SELECTION_POPUP_STYLES } from './selectionPopupStyles';

const HOST_ID = 'prism-selection-popup-host';

export interface SelectionPopupController {
  destroy(): void;
}

export interface MountSelectionPopupOptions {
  translator: Translator;
  getSourceLanguage(): string;
  getTargetLanguage(): string;
}

/**
 * Wires up "translate selected text": detects a text selection on
 * `mouseup`, shows a small trigger button near it, and on click translates
 * just that selection via the same `Translator` port every other surface
 * uses. See `SelectionPopup.tsx`'s header comment for what's deliberately
 * NOT built here (drag, replace-in-place, per-selection pickers, ...).
 */
export function mountSelectionPopup(options: MountSelectionPopupOptions): SelectionPopupController {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = SELECTION_POPUP_STYLES;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.documentElement.appendChild(host);

  let dispose: (() => void) | null = null;
  let selectedText = '';
  let state: {
    buttonVisible: boolean;
    buttonTop: number;
    buttonLeft: number;
    panelOpen: boolean;
    busy: boolean;
    translatedText: string;
    errorMessage: string | null;
  } = {
    buttonVisible: false,
    buttonTop: 0,
    buttonLeft: 0,
    panelOpen: false,
    busy: false,
    translatedText: '',
    errorMessage: null,
  };

  function renderNow(): void {
    dispose?.();
    dispose = render(
      () =>
        SelectionPopup({
          ...state,
          onTranslateClick: () => void handleTranslateClick(),
          onCloseClick: () => {
            state = { ...state, buttonVisible: false, panelOpen: false };
            renderNow();
          },
        }),
      mountPoint,
    );
  }
  renderNow();

  async function handleTranslateClick(): Promise<void> {
    state = { ...state, panelOpen: true, busy: true, translatedText: '', errorMessage: null };
    renderNow();
    const result = await translateOne(
      options.translator,
      selectedText,
      options.getSourceLanguage(),
      options.getTargetLanguage(),
    );
    if (result.ok) {
      state = { ...state, busy: false, translatedText: result.value };
    } else {
      state = { ...state, busy: false, errorMessage: result.error.message };
    }
    renderNow();
  }

  function onMouseUp(e: MouseEvent): void {
    // Ignore mouseup inside our own shadow host (e.g. releasing a click
    // on the trigger button) so it doesn't immediately re-hide itself.
    if (e.composedPath().includes(host)) return;

    const info = getSelectionInfo(window.getSelection());
    if (!info) {
      state = { ...state, buttonVisible: false, panelOpen: false };
      renderNow();
      return;
    }
    selectedText = info.text;
    state = {
      buttonVisible: true,
      buttonTop: info.rect.bottom + 6,
      buttonLeft: info.rect.left,
      panelOpen: false,
      busy: false,
      translatedText: '',
      errorMessage: null,
    };
    renderNow();
  }

  document.addEventListener('mouseup', onMouseUp);

  return {
    destroy() {
      document.removeEventListener('mouseup', onMouseUp);
      dispose?.();
      host.remove();
    },
  };
}
