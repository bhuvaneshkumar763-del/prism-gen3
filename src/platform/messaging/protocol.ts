import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ErrorKind, PageLanguageState } from '../../engine/pageTranslator/translateLoop';
import type { PieceOutcome, TranslateBatchRequest, TranslateError } from '../../engine/translator';
import type { Result } from '../../shared/result';

/**
 * The single typed messaging contract for the extension: every message is a
 * named entry here, with payload and response types checked at both ends.
 * `sendMessage(type, data)` goes to the background; `sendMessage(type, data,
 * tabId)` goes to that tab's content script (see `tabTarget.ts`). Lives in
 * `src/platform/` because `defineExtensionMessaging()` binds to `browser.runtime`.
 */
interface ProtocolMap {
  /** Popup/content-script → background: translate one string through the configured provider. */
  translateText(data: { text: string; sourceLanguage: string; targetLanguage: string }): Result<string, TranslateError>;
  /**
   * Content script (via remoteTranslator.ts) → background: translate a batch
   * of grouped pieces. `requestId` correlates this call's
   * `translatePiecesProgress` notifications, since several calls can be in
   * flight from one frame at once.
   */
  translatePieces(data: TranslateBatchRequest & { requestId: number }): PieceOutcome[];
  /**
   * Background → a tab's content script: sent as each piece of a
   * `translatePieces` call resolves, so text appears progressively.
   * `onPieceComplete` can't cross the message boundary, so this relays it.
   * Fire-and-forget; notifications for a finished request are ignored.
   */
  translatePiecesProgress(data: { requestId: number; index: number; outcome: PieceOutcome }): void;
  /** Popup/background → a tab's content script: translate the whole page. */
  pageTranslate(data: { targetLanguage: string }): PageLanguageState;
  /** Popup/background → a tab's content script: restore the original (pre-translation) text. */
  pageRestore(): PageLanguageState;
  /** Background (right-click "Translate selection") → top frame: translate this text in the selection popup. */
  translateSelection(data: { text: string }): void;
  /** Popup/background → a tab's content script: query the current translate/original state. */
  getPageState(): PageLanguageState;
  /**
   * Content script (bubble's Settings chip) or popup → background: a content
   * script can't call `browser.runtime.openOptionsPage()` itself. `section`
   * opens a specific Settings tab (e.g. 'page' for the provider fields, when a
   * provider still needs setup).
   */
  openOptionsPage(data: { section?: string } | undefined): void;
  /** Popup → a tab's content script: the detected source language ('und' if not yet resolved), for the "Always translate from {language}" toggle. */
  getOriginalLanguage(): string;
  /** Popup → a tab's content script: non-null once translation is confirmed failing or the browser is offline; `kind` tells "offline, will resume" from "provider broken". */
  getPageError(): { message: string; kind: ErrorKind } | null;
  /** Popup → a tab's content script: whether translate work is still queued or in flight. `pageTranslate` resolves once work is queued, so the popup polls this for its busy indicator. */
  getPageWorking(): boolean;
  /**
   * A tab's main-frame content script → background: reports the page's current
   * translate/restore command (from any control, or the auto-translate decision)
   * so same-origin sub-frames follow it. Same-origin scoping is the caller's job.
   */
  reportFrameLanguageDecision(data: FrameLanguageDecision): void;
  /** A same-origin sub-frame → background: asks for the main frame's decision, if it's reported one yet. */
  getFrameLanguageDecision(): FrameLanguageDecision | null;
  /**
   * Content script → background: detect the tab's language via the
   * background-only `browser.tabs.detectLanguage()`, which sees the real
   * content rather than a nav-heavy text sample. Returns `'und'` on failure.
   */
  detectTabLanguage(): string;
}

export interface FrameLanguageDecision {
  shouldTranslate: boolean;
  targetLanguage: string;
  /**
   * The main frame's detected source language, so a sub-frame passes it as an
   * explicit source instead of falling back to `'auto'`.
   */
  originalLanguage: string;
  /**
   * The reporting main frame's origin. The background's entry isn't cleared on
   * navigation, so a sub-frame rejects a decision whose origin doesn't match
   * its current top origin. A stale same-origin decision is a known, accepted gap.
   */
  mainFrameOrigin: string;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();

/**
 * Defence in depth, not a block on a known attack path: other extensions'
 * messages arrive on `runtime.onMessageExternal`, which nothing here listens
 * to, and `tabs.sendMessage` reaches only this extension's own content
 * scripts. Accepts only this extension's own `sender.id`.
 */
export function isTrustedSender(sender: Browser.runtime.MessageSender): boolean {
  return sender.id === browser.runtime.id;
}

const UNTRUSTED_SENDER_ERROR = '[prism] rejected a message from an untrusted sender';

/**
 * `onMessage`, but the handler runs only for an `isTrustedSender` sender, so
 * no handler can forget the check. An untrusted sender gets an error, or with
 * `onUntrusted: 'ignore'` an empty answer (for fire-and-forget notifications).
 */
export function onTrustedMessage<TType extends keyof ProtocolMap>(
  type: TType,
  handler: Parameters<typeof onMessage<TType>>[1],
  options: { onUntrusted?: 'throw' | 'ignore' } = {},
): () => void {
  return onMessage(type, (message) => {
    if (!isTrustedSender(message.sender)) {
      if (options.onUntrusted === 'ignore') return;
      throw new Error(UNTRUSTED_SENDER_ERROR);
    }
    return handler(message);
  });
}
