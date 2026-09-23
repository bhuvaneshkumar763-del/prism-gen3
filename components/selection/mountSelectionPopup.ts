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
 * How long keyboard-driven selection changes settle before the popup reacts.
 * A run of Shift+Arrow presses is one gesture, not N — without this, each
 * keystroke ran its own language detection. Mouse selection needs no
 * debounce: a mouseup already marks the end of the gesture.
 */
const KEYUP_DEBOUNCE_MS = 150;

// Same bound used everywhere else this project calls `i18n.detectLanguage`
// — real bug, fixed once already (beta.20): Firefox's implementation can
// simply never resolve or reject (Mozilla bug 1712214).
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
   * Hide the trigger for a selection with nothing translatable in it (a
   * lone character, or only punctuation/digits/whitespace). Matches TWP's
   * `dontShowIfIsNotValidText` — the only one of their selection-popup
   * visibility settings that defaults on. Omit (or return true) to keep
   * this filter active.
   */
  getSkipInvalidText?(): boolean;
  /**
   * Hide the trigger when the selection is already confidently detected as
   * the target language — matches TWP's `dontShowIfSelectedTextIsTargetLang`.
   * Default off in TWP too (confirmed against their real source), so
   * omitting this keeps today's behavior unchanged.
   */
  getSkipTargetLanguageText?(): boolean;
  /**
   * Show the floating button automatically when text is selected. False
   * attaches no selection listeners at all — used when the user has turned
   * the button off, so an explicit right-click can still translate without
   * quietly turning the button back on. Default true.
   */
  autoTrigger?: boolean;
}

/**
 * Wires up "translate selected text": detects a text selection on
 * `mouseup`, shows a small trigger button near it, and on click translates
 * just that selection via the same `Translator` port every other surface
 * uses. See `SelectionPopup.tsx`'s header comment for what's deliberately
 * NOT built here (drag, replace-in-place, per-selection pickers, ...).
 */
export function mountSelectionPopup(options: MountSelectionPopupOptions): SelectionPopupController {
  const { host, mountPoint } = createShadowHost(HOST_ID, SELECTION_POPUP_STYLES);

  let selectedText = '';
  // Real bug, found via an audit: this popup used to always send
  // `options.getSourceLanguage()` (the global `sourceLanguage` config
  // value, which defaults to the literal string 'auto') as the translate
  // request's source language, regardless of what was actually selected.
  // `translateLoop.ts` fixed the equivalent problem for whole-page
  // translation (beta.29) by using a freshly-detected language instead of
  // 'auto', since Google's own auto-detection can silently fail (echo the
  // input back unchanged, HTTP 200, no error) for short non-Latin
  // selections. `detectSelectionLanguage` below already exists and runs on
  // every selection change for the skip-target-language-text feature —
  // this reuses that same detection for the actual translate request too,
  // instead of discarding it.
  let selectedTextLanguage = 'und';
  // Bumped whenever the visible selection changes (new mouseup) or a new
  // translate click starts — a resolving handleTranslateClick() checks its
  // own snapshot against the current value before applying its result, so
  // a slower/earlier request can't clobber what the user is looking at now
  // (e.g. select A, click translate, select B before A resolves — A's
  // stale result must not overwrite B's state).
  let requestId = 0;
  /**
   * The selection the user dismissed with Escape. Kept dismissed until the
   * selection actually changes or the user makes a fresh mouse selection.
   * Needed because a physical keypress is keydown AND keyup: Escape's
   * keydown hides the trigger, then its own keyup (and any later incidental
   * key, like Shift) re-read the still-present selection and brought it
   * straight back.
   */
  let dismissedText: string | null = null;
  /**
   * The page selection (as `getSelectionInfo` reads it) that the current
   * view — the trigger, or an open panel — belongs to. Compared against a
   * fresh read of the page selection, never against `selectedText`: for a
   * right-click request `selectedText` is the browser's own `selectionText`,
   * which normalises whitespace differently from `Selection.toString()`, so
   * the two can differ for the very same selection.
   */
  let shownForSelection: string | null = null;
  // Speed fix, found via a UI audit: this used to be a plain object that
  // `renderNow()` fed into a brand-new `render()` after `dispose()`-ing the
  // old one — on EVERY state change. The popup listens for `keyup` on the
  // whole document, so typing into any form field on any site tore down and
  // rebuilt this tree once per keystroke, even though the popup was already
  // hidden. Rendered once now, from a store: setting a field to the value it
  // already has notifies nothing, so an already-hidden popup costs nothing.
  // Same pattern `mountBubble.ts` and `mountHoverTooltip.ts` moved to.
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
        // Security: reject a synthetic click driving the actual translate
        // request through the user's configured provider — see onMouseUp's
        // isTrusted comment below for why this matters here too.
        onTranslateClick: (e) => {
          if (!e.isTrusted) return;
          void handleTranslateClick();
        },
        // Consistency with onTranslateClick above, NOT a defense: this
        // path spends nothing, and a page that wants the popup gone has
        // far better options (it owns the document). The translate guard
        // exists because a synthetic click there would spend the user's
        // own provider quota; nothing comparable is at stake here.
        onCloseClick: (e) => {
          if (!e.isTrusted) return;
          setState({ buttonVisible: false, panelOpen: false });
        },
      }),
    mountPoint,
  );

  /**
   * Improvement, found via a UI audit: copying the result was the most
   * useful action a translated snippet was missing. Previously listed as a
   * v1 scope cut in explicitly-out-of-scope — that doc is updated to match.
   */
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
   * `window.getSelection()` cannot see into a shadow root — real gap, given
   * page translation itself (`collectTextNodes.ts`) deliberately crosses
   * shadow boundaries. A user can highlight text inside a site's sealed
   * comment widget and the "translate this" trigger never appears at all.
   * Chromium supports the non-standard `ShadowRoot.getSelection()`;
   * Firefox/Safari don't (`typeof shadowRoot.getSelection !== 'function'`
   * there), so this is purely additive — falls straight back to
   * `window.getSelection()` everywhere it isn't available, same as before
   * this existed. Walks the event's `composedPath()` (innermost first) so
   * a selection inside a NESTED shadow tree resolves to its own closest
   * root, not an ancestor's.
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
    // A no-op for the DOM when already hidden — the store only notifies on
    // an actual change. That's what makes a keystroke in a text field free.
    setState({ buttonVisible: false, panelOpen: false });
  }

  /**
   * Best-effort — `withTimeout`-guarded against the same real Firefox hang
   * risk as every other `i18n.detectLanguage` call in this codebase, and
   * never throws: a detection failure just means the target-language skip
   * check below can't fire, falling through to "show the trigger anyway,"
   * the same safe default `originalLanguageTracker.ts` uses.
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

  /** Shared by the mouse and keyboard paths below — the trigger's own show/hide logic doesn't care how the selection changed. */
  async function updateFromCurrentSelection(path: readonly EventTarget[]): Promise<void> {
    const info = getSelectionInfo(resolveActiveSelection(path));
    // Nothing changed: this exact text is already being offered or shown. An
    // incidental key (Shift, an arrow that doesn't extend it, the key-up of
    // the key that opened the context menu) must not reset the view. It used
    // to — closing an open translation on any keystroke, and bumping the
    // request counter below, which could make an in-flight right-click
    // translation silently give up. Checked BEFORE that bump for this reason.
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
    // Always detected now (not just when getSkipTargetLanguageText is on)
    // — the result also becomes the source language for the actual
    // translate request below, see this file's `selectedTextLanguage`
    // declaration comment for why.
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
    // Security: a page can dispatch a synthetic 'mouseup' at the document
    // to fake "the user just finished selecting text," feeding
    // attacker-controlled content into `selectedText` and, via the
    // trigger, into a real translate request through the user's
    // configured (possibly paid) provider. Real user interaction always
    // has isTrusted:true; only script-dispatched events don't.
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
   * Real gap: the trigger only ever listened for `mouseup`, so selecting
   * text via keyboard (Shift+Arrow, Ctrl/Cmd+A, Shift+Home/End) never
   * showed it at all — the feature was silently mouse-only. Any keyup
   * can plausibly have changed the selection; `updateFromCurrentSelection`
   * itself already no-ops (hides the trigger) for a collapsed/empty
   * selection, so there's no need to enumerate every selection-extending
   * key combination here.
   */
  let keyupTimer: ReturnType<typeof setTimeout> | null = null;
  function onKeyUp(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    // Captured NOW, not inside the timer: `composedPath()` returns an empty
    // array once the event has finished dispatching, which would silently
    // lose the shadow-root selection lookup below.
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (keyupTimer) clearTimeout(keyupTimer);
    keyupTimer = setTimeout(() => {
      keyupTimer = null;
      void updateFromCurrentSelection(path);
    }, KEYUP_DEBOUNCE_MS);
  }

  /**
   * Escape dismisses the trigger or the result panel — the standard way to
   * close a transient popup, and previously the only way to close this one
   * was a mouse click on its × button.
   */
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
