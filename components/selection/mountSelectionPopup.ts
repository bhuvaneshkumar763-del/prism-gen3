import { render } from 'solid-js/web';
import { getSelectionInfo, isValidSelectionText } from '../../src/engine/selection/selectionInfo';
import type { Translator } from '../../src/engine/translator';
import { translateOne } from '../../src/engine/translator';
import { baseLanguageTag } from '../../src/shared/languages';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { withTimeout } from '../../src/shared/withTimeout';
import { SelectionPopup } from './SelectionPopup';
import { SELECTION_POPUP_STYLES } from './selectionPopupStyles';

const HOST_ID = 'prism-selection-popup-host';

// Same bound used everywhere else this project calls `i18n.detectLanguage`
// — real bug, fixed once already (beta.20): Firefox's implementation can
// simply never resolve or reject (Mozilla bug 1712214).
const DETECT_LANGUAGE_TIMEOUT_MS = 3000;

export interface SelectionPopupController {
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

  let dispose: (() => void) | null = null;
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
    const thisRequestId = ++requestId;
    state = { ...state, panelOpen: true, busy: true, translatedText: '', errorMessage: null };
    renderNow();
    const result = await translateOne(
      options.translator,
      selectedText,
      selectedTextLanguage !== 'und' ? selectedTextLanguage : options.getSourceLanguage(),
      options.getTargetLanguage(),
    );
    if (thisRequestId !== requestId) return; // superseded by a newer selection/click — discard

    if (result.ok) {
      state = { ...state, busy: false, translatedText: result.value };
    } else {
      state = { ...state, busy: false, errorMessage: result.error.message };
    }
    renderNow();
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
  function resolveActiveSelection(e: Event): Selection | null {
    for (const node of e.composedPath()) {
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
    state = { ...state, buttonVisible: false, panelOpen: false };
    renderNow();
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
  async function updateFromCurrentSelection(e: Event): Promise<void> {
    const info = getSelectionInfo(resolveActiveSelection(e));
    const thisRequestId = ++requestId;
    if (!info) {
      hideTrigger();
      return;
    }
    if ((options.getSkipInvalidText?.() ?? true) && !isValidSelectionText(info.text)) {
      hideTrigger();
      return;
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
    selectedTextLanguage = detected;
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

  function onMouseUp(e: MouseEvent): void {
    // Ignore mouseup inside our own shadow host (e.g. releasing a click
    // on the trigger button) so it doesn't immediately re-hide itself.
    if (e.composedPath().includes(host)) return;
    void updateFromCurrentSelection(e);
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
  function onKeyUp(e: KeyboardEvent): void {
    if (e.composedPath().includes(host)) return;
    void updateFromCurrentSelection(e);
  }

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);

  return {
    destroy() {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keyup', onKeyUp);
      dispose?.();
      host.remove();
    },
  };
}
