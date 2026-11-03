import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { getSelectionInfo, isValidSelectionText, rangesRect } from '../../src/engine/selection/selectionInfo';
import type { Translator } from '../../src/engine/translator';
import { translateOne } from '../../src/engine/translator';
import { baseLanguageTag } from '../../src/shared/languages';
import { canHover } from '../../src/shared/ui/pointer';
import {
  placeSelectionPanel,
  placeSelectionTrigger,
  type SelectionPanelPlacement,
} from '../../src/shared/ui/selectionPanelPlacement';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { viewportSize } from '../../src/shared/ui/viewport';
import { withTimeout } from '../../src/shared/withTimeout';
import { copyText } from './copyText';
import { SelectionPopup } from './SelectionPopup';
import { describeSelectionError, describeSelectionRejection } from './selectionErrorMessage';
import { SELECTION_POPUP_STYLES } from './selectionPopupStyles';

const HOST_ID = 'prism-selection-popup-host';

/**
 * Lets keyboard selection settle, so a run of Shift+Arrow presses runs one
 * language detection, not N. Mouse needs none: mouseup ends the gesture.
 */
const KEYUP_DEBOUNCE_MS = 150;

/**
 * A touch selection fires no mouseup or keyup, only a stream of
 * selectionchange while the handles move; this long without one means the
 * user has let go.
 */
const SELECTIONCHANGE_SETTLE_MS = 400;

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
 * Wires up "translate selected text": on a mouse, keyboard or touch selection,
 * shows a trigger near it that translates just that text via the shared
 * `Translator`. Trigger and panel follow the selection as the page scrolls.
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
  /**
   * Copies of the ranges the view is anchored to, read again on scroll. Copies
   * because a range from `getRangeAt` moves with the selection, and a tap on
   * the trigger can clear the selection while the panel should stay put.
   */
  let anchorRanges: Range[] | null = null;
  // Rendered once from a store: setting a field to its current value notifies
  // nothing, so document-wide keyups cost nothing while the popup is hidden.
  const [state, setState] = createStore({
    buttonVisible: false,
    /** False while the selection is scrolled off screen: the trigger hides until it returns. */
    buttonInView: true,
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
          return state.buttonVisible && state.buttonInView;
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

  async function translateText(text: string): Promise<void> {
    // Anchored to the page's own selection when this frame can see it;
    // otherwise (a selection inside an iframe) to the top-left, on screen.
    const selection = window.getSelection();
    const info = getSelectionInfo(selection);
    const anchor = info?.rect ?? { top: 16, bottom: 16, left: 16 };
    anchorRanges = info && selection ? copyRanges(selection) : null;
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
      panel: placeSelectionPanel(anchor, viewportSize()),
    });
    selectedTextLanguage = await detectSelectionLanguage(text);
    if (thisRequestId !== requestId) return; // superseded by a newer selection or request
    await handleTranslateClick();
  }

  async function handleTranslateClick(): Promise<void> {
    const thisRequestId = ++requestId;
    setState({ panelOpen: true, busy: true, translatedText: '', errorMessage: null, copyStatus: 'idle' });
    let result: Awaited<ReturnType<typeof translateOne>>;
    try {
      result = await translateOne(
        options.translator,
        selectedText,
        selectedTextLanguage !== 'und' ? selectedTextLanguage : options.getSourceLanguage(),
        options.getTargetLanguage(),
      );
    } catch (cause) {
      // The round trip itself failed: a timeout, or no extension to answer.
      if (thisRequestId === requestId) setState({ busy: false, errorMessage: describeSelectionRejection(cause) });
      return;
    }
    if (thisRequestId !== requestId) return; // superseded by a newer selection/click — discard

    if (result.ok) {
      setState({ busy: false, translatedText: result.value });
    } else {
      setState({ busy: false, errorMessage: describeSelectionError(result.error) });
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

  function copyRanges(selection: Selection): Range[] {
    const ranges: Range[] = [];
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      ranges.push(typeof range.cloneRange === 'function' ? range.cloneRange() : range);
    }
    return ranges;
  }

  function hideTrigger(): void {
    // Free when already hidden: the store only notifies on an actual change.
    setState({ buttonVisible: false, panelOpen: false });
    anchorRanges = null;
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

  /**
   * Shared by the mouse, keyboard and touch paths below. `keepOpenPanel`: a
   * touch on the panel can clear the page selection, which must not close it.
   */
  async function updateFromCurrentSelection(path: readonly EventTarget[], keepOpenPanel = false): Promise<void> {
    const selection = resolveActiveSelection(path);
    const info = getSelectionInfo(selection);
    if (keepOpenPanel && state.panelOpen && !info) return;
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
    // Copied before the await, while the selection still matches `info`.
    const ranges = selection ? copyRanges(selection) : null;
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
    anchorRanges = ranges;
    const viewport = viewportSize();
    const trigger = placeSelectionTrigger(info.rect, viewport, { preferBelow: lastPointerType !== 'mouse' });
    setState({
      buttonVisible: true,
      buttonInView: true,
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

  /**
   * Which kind of pointer last touched the page. Mouse selections end in
   * mouseup, so selectionchange is only acted on after a touch or pen; that
   * also keeps a desktop page's own scripted selections from popping it up.
   */
  let lastPointerType = canHover() ? 'mouse' : 'touch';
  /** Where the last touch landed, so a selection inside a shadow root is found (see `resolveActiveSelection`). */
  let lastTouchPath: readonly EventTarget[] = [];
  function onPointerDown(e: PointerEvent): void {
    if (!e.isTrusted) return;
    lastPointerType = e.pointerType || 'mouse';
    if (lastPointerType !== 'mouse') lastTouchPath = e.composedPath();
  }

  let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;
  function onSelectionChange(e: Event): void {
    if (!e.isTrusted || lastPointerType === 'mouse') return;
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
    selectionChangeTimer = setTimeout(() => {
      selectionChangeTimer = null;
      void updateFromCurrentSelection(lastTouchPath, true);
    }, SELECTIONCHANGE_SETTLE_MS);
  }

  /**
   * Re-anchors trigger and panel to the selection after any scroll (the page,
   * a scrolling box, or the visual viewport), at most once a frame. Following
   * rather than hiding: pages that scroll themselves would otherwise make the
   * trigger vanish, and an open panel shouldn't drift away from its text.
   */
  let repositionFrame = 0;
  function onViewportMoved(): void {
    if (repositionFrame || !anchorRanges || (!state.buttonVisible && !state.panelOpen)) return;
    repositionFrame = requestAnimationFrame(() => {
      repositionFrame = 0;
      const rect = anchorRanges && rangesRect(anchorRanges);
      if (!rect) return; // its text was removed or replaced; stay where it was
      const viewport = viewportSize();
      const trigger = placeSelectionTrigger(rect, viewport, { preferBelow: lastPointerType !== 'mouse' });
      setState({
        buttonInView: rect.bottom > 0 && rect.top < viewport.height,
        buttonTop: trigger.top,
        buttonLeft: trigger.left,
        panel: placeSelectionPanel(rect, viewport),
      });
    });
  }

  function dismiss(): void {
    if (!state.buttonVisible && !state.panelOpen) return;
    dismissedText = selectedText;
    hideTrigger();
  }

  /** Escape dismisses the trigger or the result panel. */
  function onKeyDown(e: KeyboardEvent): void {
    if (!e.isTrusted || e.key !== 'Escape') return;
    dismiss();
  }

  /**
   * Keys pressed inside the popup stay inside it, so they can't fire the
   * site's own shortcuts. Escape is handled here, as it no longer reaches
   * the document listener.
   */
  function onHostKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.type === 'keydown' && e.isTrusted && e.key === 'Escape') dismiss();
  }

  const autoTrigger = options.autoTrigger ?? true;
  if (autoTrigger) {
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    document.addEventListener('selectionchange', onSelectionChange);
  }
  document.addEventListener('keydown', onKeyDown);
  for (const type of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(type, onHostKey);
  document.addEventListener('scroll', onViewportMoved, { capture: true, passive: true });
  window.addEventListener('resize', onViewportMoved, { passive: true });
  window.visualViewport?.addEventListener('scroll', onViewportMoved, { passive: true });
  window.visualViewport?.addEventListener('resize', onViewportMoved, { passive: true });

  return {
    translateText(text) {
      void translateText(text);
    },
    destroy() {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onViewportMoved, { capture: true });
      window.removeEventListener('resize', onViewportMoved);
      window.visualViewport?.removeEventListener('scroll', onViewportMoved);
      window.visualViewport?.removeEventListener('resize', onViewportMoved);
      if (keyupTimer) clearTimeout(keyupTimer);
      if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
      if (repositionFrame) cancelAnimationFrame(repositionFrame);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      dispose();
      host.remove();
    },
  };
}
