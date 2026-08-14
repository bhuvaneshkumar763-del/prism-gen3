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
export interface ProtocolMap {
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
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
