import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { getSelectionInfo, isValidSelectionText } from '../../src/engine/selection/selectionInfo';
import type { Translator } from '../../src/engine/translator';
import { translateOne } from '../../src/engine/translator';
import { baseLanguageTag } from '../../src/shared/languages';
import {
  placeSelectionPanel,
  placeSelectionTrigger,
  type SelectionPanelPlacement,
} from '../../src/shared/ui/selectionPanelPlacement';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { withTimeout } from '../../src/shared/withTimeout';
import { copyText } from './copyText';
import { SelectionPopup } from './SelectionPopup';
import { SELECTION_POPUP_STYLES } from './selectionPopupStyles';

const HOST_ID = 'prism-selection-popup-host';

/**
 * Lets keyboard selection settle, so a run of Shift+Arrow presses runs one
 * language detection, not N. Mouse needs none: mouseup ends the gesture.
 */
const KEYUP_DEBOUNCE_MS = 150;

// Same bound as every other `i18n.detectLanguage` call: Firefox's can never
// settle (Mozilla bug 1712214).
const DETECT_LANGUAGE_TIMEOUT_MS = 3000;

export interface SelectionPopupController {
  /**
   * Translates `text` and shows the result — the right-click "Translate
   * selection" path. The text comes from the browser's own menu, so this
   * works even when the selection is somewhere this frame can't see.
   */
  translateText(text: string): void;
  destroy(): void;
}

export interface MountSelectionPopupOptions {
  translator: Translator;
  getSourceLanguage(): string;
  getTargetLanguage(): string;
  /**
   * Hide the trigger for a selection with nothing translatable in it (a lone
   * character, or only punctuation/digits/whitespace). Defaults on when omitted.
   */
  getSkipInvalidText?(): boolean;
  /** Hide the trigger when the selection is detected as the target language. Default off. */
  getSkipTargetLanguageText?(): boolean;
  /**
   * Show the button automatically on selection (default true). False attaches
   * no selection listeners, so right-click translate still works with the
   * button turned off.
   */
  autoTrigger?: boolean;
}

/**
 * Wires up "translate selected text": on a mouse or keyboard selection, shows
 * a trigger near it that translates just that text via the shared `Translator`.
 */
export function mountSelectionPopup(options: MountSelectionPopupOptions): SelectionPopupController {
  const { host, mountPoint } = createShadowHost(HOST_ID, SELECTION_POPUP_STYLES);

  let selectedText = '';
  // Sent as the source language instead of 'auto': Google's auto-detection
  // can silently echo short non-Latin text back unchanged (HTTP 200).
  let selectedTextLanguage = 'und';
  // Bumped on each selection change or translate start; async work applies
  // its result only if its snapshot still matches, so stale results are dropped.
  let requestId = 0;
  /**
   * The selection dismissed with Escape, kept dismissed until it changes or a
   * fresh mouse selection: otherwise Escape's own keyup re-reads the
   * still-present selection and brings the trigger straight back.
   */
  let dismissedText: string | null = null;
  /**
   * The page selection (per `getSelectionInfo`) the current view belongs to.
   * Not `selectedText`: on right-click that is the browser's `selectionText`,
   * whose whitespace differs from `Selection.toString()`.
   */
  let shownForSelection: string | null = null;
  // Rendered once from a store: setting a field to its current value notifies
  // nothing, so document-wide keyups cost nothing while the popup is hidden.
  const [state, setState] = createStore({
    buttonVisible: false,
    buttonTop: 0,
    buttonLeft: 0,
    panelOpen: false,
    panel: { left: 0, top: 0, bottom: null, maxWidth: 0, maxHeight: 0 } as SelectionPanelPlacement,
    busy: false,
    translatedText: '',
    errorMessage: null as string | null,
    copyStatus: 'idle' as 'idle' | 'copied' | 'failed',
  });

  const dispose = render(
    () =>
      SelectionPopup({
        get buttonVisible() {
          return state.buttonVisible;
        },
        get buttonTop() {
          return state.buttonTop;
        },
        get buttonLeft() {
          return state.buttonLeft;
        },
        get panelOpen() {
          return state.panelOpen;
        },
        get panel() {
          return state.panel;
        },
        get busy() {
          return state.busy;
        },
        get translatedText() {
          return state.translatedText;
        },
        get errorMessage() {
          return state.errorMessage;
        },
        get copyStatus() {
          return state.copyStatus;
        },
        onCopyClick: (e) => {
          if (!e.isTrusted) return;
          void handleCopy();
        },
        // Security: a synthetic click must not spend the user's provider
        // quota (see onMouseUp).
        onTranslateClick: (e) => {
          if (!e.isTrusted) return;
          void handleTranslateClick();
        },
        // For consistency, not defense: closing spends nothing, and the page
        // owns the document anyway.
        onCloseClick: (e) => {
          if (!e.isTrusted) return;
          setState({ buttonVisible: false, panelOpen: false });
        },
      }),
    mountPoint,
  );

  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  async function handleCopy(): Promise<void> {
    const copied = await copyText(state.translatedText);
    setState({ copyStatus: copied ? 'copied' : 'failed' });
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => setState({ copyStatus: 'idle' }), 1500);
  }

  function currentViewport() {
    return {
      width: window.visualViewport?.width || window.innerWidth,
      height: window.visualViewport?.height || window.innerHeight,
    };
  }

  async function translateText(text: string): Promise<void> {
    // Anchored to the page's own selection when this frame can see it;
    // otherwise (a selection inside an iframe) to the top-left, on screen.
    const info = getSelectionInfo(window.getSelection());
    const anchor = info?.rect ?? { top: 16, bottom: 16, left: 16 };
    const thisRequestId = ++requestId;
    dismissedText = null;
    selectedText = text;
    shownForSelection = info?.text ?? null;
    // Open (and busy) straight away, rather than only after language
    // detection: the user asked for this, and an open panel is what tells a
    // concurrent selection re-check that this text is already being handled.
    setState({
      buttonVisible: false,
      panelOpen: true,
      busy: true,
      translatedText: '',
      errorMessage: null,
      copyStatus: 'idle',
      panel: placeSelectionPanel(anchor, currentViewport()),
    });
    selectedTextLanguage = await detectSelectionLanguage(text);
    if (thisRequestId !== requestId) return; // superseded by a newer selection or request
    await handleTranslateClick();
  }

  async function handleTranslateClick(): Promise<void> {
    const thisRequestId = ++requestId;
    setState({ panelOpen: true, busy: true, translatedText: '', errorMessage: null, copyStatus: 'idle' });
    const result = await translateOne(
      options.translator,
      selectedText,
      selectedTextLanguage !== 'und' ? selectedTextLanguage : options.getSourceLanguage(),
      options.getTargetLanguage(),
    );
    if (thisRequestId !== requestId) return; // superseded by a newer selection/click — discard

    if (result.ok) {
      setState({ busy: false, translatedText: result.value });
    } else {
      setState({ busy: false, errorMessage: result.error.message });
    }
  }

  /**
   * `window.getSelection()` can't see into shadow roots, which page translation
   * crosses. Uses Chromium's non-standard `ShadowRoot.getSelection()` where it
   * exists (falling back elsewhere), innermost root first along `composedPath()`.
   */
  function resolveActiveSelection(path: readonly EventTarget[]): Selection | null {
    for (const node of path) {
      const shadowRoot = (node as Partial<Element>).shadowRoot as
        | (ShadowRoot & { getSelection?(): Selection | null })
        | null
        | undefined;
      if (shadowRoot && typeof shadowRoot.getSelection === 'function') {
        const selection = shadowRoot.getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) return selection;
      }
    }
    return window.getSelection();
  }

  function hideTrigger(): void {
    // Free when already hidden: the store only notifies on an actual change.
    setState({ buttonVisible: false, panelOpen: false });
  }

  /**
   * Best-effort and never throws: on failure or timeout it returns 'und', so
   * the target-language skip can't fire and the trigger shows anyway.
   */
  async function detectSelectionLanguage(text: string): Promise<string> {
    try {
      if (typeof browser.i18n?.detectLanguage !== 'function') return 'und';
      const result = await withTimeout(browser.i18n.detectLanguage(text), DETECT_LANGUAGE_TIMEOUT_MS);
      return result?.languages?.[0]?.language ?? 'und';
    } catch {
      return 'und';
    }
  }

  /** Shared by the mouse and keyboard paths below. */
  async function updateFromCurrentSelection(path: readonly EventTarget[]): Promise<void> {
    const info = getSelectionInfo(resolveActiveSelection(path));
    // This text is already offered or shown: an incidental key must not reset
    // the view. Checked before the requestId bump, which would abandon an
    // in-flight right-click translation.
    if (info && info.text === shownForSelection && (state.buttonVisible || state.panelOpen)) return;
    const thisRequestId = ++requestId;
    if (!info) {
      hideTrigger();
      return;
    }
    if ((options.getSkipInvalidText?.() ?? true) && !isValidSelectionText(info.text)) {
      hideTrigger();
      return;
    }
    if (dismissedText !== null) {
      if (info.text === dismissedText) {
        hideTrigger();
        return;
      }
      dismissedText = null; // the selection changed — that dismissal was for the old one
    }
    // Always detected: it is also the translate request's source language
    // (see `selectedTextLanguage`).
    const detected = await detectSelectionLanguage(info.text);
    if (thisRequestId !== requestId) return; // superseded by a newer selection — discard
    if (
      options.getSkipTargetLanguageText?.() &&
      detected !== 'und' &&
      baseLanguageTag(detected) === baseLanguageTag(options.getTargetLanguage())
    ) {
      hideTrigger();
      return;
    }
    selectedText = info.text;
    shownForSelection = info.text;
    selectedTextLanguage = detected;
    const viewport = currentViewport();
    const trigger = placeSelectionTrigger(info.rect, viewport);
    setState({
      buttonVisible: true,
      buttonTop: trigger.top,
      buttonLeft: trigger.left,
      panel: placeSelectionPanel(info.rect, viewport),
      panelOpen: false,
      busy: false,
      translatedText: '',
      errorMessage: null,
    });
  }

  function onMouseUp(e: MouseEvent): void {
    // Security: a page's synthetic mouseup could feed its own text into a
    // translate request on the user's (possibly paid) provider.
    if (!e.isTrusted) return;
    // Ignore mouseup inside our own shadow host (e.g. releasing a click
    // on the trigger button) so it doesn't immediately re-hide itself.
    const path = e.composedPath();
    if (path.includes(host)) return;
    // A mouse selection is a deliberate new gesture — re-selecting even the
    // same text should offer the trigger again, unlike an incidental keyup.
    dismissedText = null;
    void updateFromCurrentSelection(path);
  }

  /**
   * Keyboard selection (Shift+Arrow, Ctrl/Cmd+A, …). Any keyup may have changed
   * the selection; `updateFromCurrentSelection` handles empty ones, so keys
   * aren't filtered here.
   */
  let keyupTimer: ReturnType<typeof setTimeout> | null = null;
  function onKeyUp(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    // Captured now: `composedPath()` is empty once dispatch has finished.
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (keyupTimer) clearTimeout(keyupTimer);
    keyupTimer = setTimeout(() => {
      keyupTimer = null;
      void updateFromCurrentSelection(path);
    }, KEYUP_DEBOUNCE_MS);
  }

  /** Escape dismisses the trigger or the result panel. */
  function onKeyDown(e: KeyboardEvent): void {
    if (!e.isTrusted || e.key !== 'Escape') return;
    if (!state.buttonVisible && !state.panelOpen) return;
    dismissedText = selectedText;
    hideTrigger();
  }

  const autoTrigger = options.autoTrigger ?? true;
  if (autoTrigger) {
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
  }
  document.addEventListener('keydown', onKeyDown);

  return {
    translateText(text) {
      void translateText(text);
    },
    destroy() {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('keydown', onKeyDown);
      if (keyupTimer) clearTimeout(keyupTimer);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      dispose();
      host.remove();
    },
  };
}
