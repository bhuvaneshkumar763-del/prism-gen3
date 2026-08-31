import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ErrorKind, PageLanguageState } from '../../engine/pageTranslator/translateLoop';
import type { PieceOutcome, TranslateBatchRequest, TranslateError } from '../../engine/translator';
import type { Result } from '../../shared/result';

/**
 * The single typed messaging contract for the whole extension — every
 * message this extension sends is a named entry here, compile-time
 * checked at both ends (payload shape AND response shape). Built on
 * `@webext-core/messaging`'s `defineExtensionMessaging`, which also
 * unifies the two message-sending directions this codebase needs into one
 * API: `sendMessage(type, data)` for content-script/popup → background
 * (`runtime.sendMessage`), and `sendMessage(type, data, tabId)` for
 * popup/background → a specific tab's content script (`tabs.sendMessage`)
 * — see `tabTarget.ts` for where that `tabId` comes from.
 *
 * Lives in `src/platform/`, not `src/shared/`, even though `ProtocolMap`
 * itself is just types — `defineExtensionMessaging()` below is a real call
 * that binds to `browser.runtime` at module-evaluation time, which is
 * exactly the kind of browser-API touch that belongs behind the platform
 * boundary (see `src/engine/README.md`), not in a "pure types" file that
 * happens to also do that.
 */
interface ProtocolMap {
  /** Popup/content-script → background: translate one string through the configured provider. */
  translateText(data: { text: string; sourceLanguage: string; targetLanguage: string }): Result<string, TranslateError>;
  /** Content-script (via remoteTranslator.ts) → background: translate a batch of grouped pieces. */
  translatePieces(data: TranslateBatchRequest): PieceOutcome[];
  /** Popup/background → a tab's content script: translate the whole page. */
  pageTranslate(data: { targetLanguage: string }): PageLanguageState;
  /** Popup/background → a tab's content script: restore the original (pre-translation) text. */
  pageRestore(): PageLanguageState;
  /** Popup/background → a tab's content script: query the current translate/original state. */
  getPageState(): PageLanguageState;
  /** Content script (bubble's Settings chip) → background: a content script can't call `browser.runtime.openOptionsPage()` itself. */
  openOptionsPage(): void;
  /** Popup → a tab's content script: the detected source language ('und' if not yet resolved), for the "Always translate from {language}" toggle. */
  getOriginalLanguage(): string;
  /** Popup → a tab's content script: non-null once the page translator has confirmed translation is actually failing OR the browser is offline (see translateLoop.ts's `getLastError`/`getLastErrorKind`) — closes the gap where a translate click that fails after the popup already resolved shows nothing wrong. `kind` distinguishes "offline, will resume automatically" from "the provider is actually broken." */
  getPageError(): { message: string; kind: ErrorKind } | null;
  /** Popup → a tab's content script: is there real translate work still queued or in flight (see translateLoop.ts's `isWorking`)? `pageTranslate`'s own response resolves as soon as work is queued, not once it's done — the popup polls this afterward so its busy indicator reflects real activity instead of clearing itself in ~zero frames, same real bug this fixed for the bubble (`entrypoints/content.ts`). */
  getPageWorking(): boolean;
  /**
   * A tab's MAIN-FRAME content script → background: reports its own
   * auto-translate-on-load decision once resolved, so a same-origin
   * sub-frame in the same tab can inherit it instead of running an
   * independent (and possibly different) detection — closes a real gap
   * where an iframe got no auto-translate decision of its own at all.
   * Cross-origin frames never call this (or its query counterpart below) —
   * scoped to same-origin by the caller, not by anything server-side here.
   */
  reportFrameLanguageDecision(data: FrameLanguageDecision): void;
  /** A same-origin sub-frame → background: asks for the main frame's decision, if it's reported one yet. */
  getFrameLanguageDecision(): FrameLanguageDecision | null;
  /**
   * Content script → background: detect this tab's language via
   * `browser.tabs.detectLanguage()` — a background-only, privileged API a
   * content script can't call directly. TWP's real, current source
   * (confirmed live) uses this as its *primary* detection method, falling
   * back to a content-script text-sample heuristic only when it's
   * unavailable; this project previously only ever had the fallback.
   * Inspects the browser's own view of the tab's actual content rather
   * than a client-side `innerText` slice we build ourselves — real gap on
   * pages where nav/header chrome (often in the site's UI language)
   * dominates the first few thousand characters of body text before
   * reaching the real content. Returns `'und'` on any failure (no throw),
   * same convention as every other detection path in this codebase.
   */
  detectTabLanguage(): string;
}

export interface FrameLanguageDecision {
  shouldTranslate: boolean;
  targetLanguage: string;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
