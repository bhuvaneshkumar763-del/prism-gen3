import type { FrameLanguageDecision } from './messaging/protocol';

/**
 * Which frames a translate/restore command reaches. The top frame is the one
 * page controller: every control lands there, it applies the command and
 * publishes it as the tab's frame decision. Same-origin sub-frames follow that
 * decision; cross-origin sub-frames run nothing at all.
 */
export type FrameKind = 'top' | 'sameOriginSubFrame' | 'crossOriginSubFrame';

/**
 * Every way a translate/restore starts. `pageMessage` is the popup, the
 * context menu and the keyboard shortcut: all arrive as `pageTranslate` /
 * `pageRestore` sent to every frame of the tab.
 */
export type PageControl = 'bubble' | 'pageMessage' | 'autoTranslate';

/** `canReadTopLocation`: reading `window.top.location` didn't throw, i.e. this frame is same-origin with the top. */
export function classifyFrame(isTop: boolean, canReadTopLocation: boolean): FrameKind {
  if (isTop) return 'top';
  return canReadTopLocation ? 'sameOriginSubFrame' : 'crossOriginSubFrame';
}

export interface PageCommandRoute {
  /** This frame applies the command itself (and, for a message, answers it). */
  runHere: boolean;
  /** This frame passes the command on to every same-origin sub-frame. */
  forwardToSameOriginSubFrames: boolean;
}

/**
 * The same for every control on purpose: a sub-frame never acts on a command
 * directly, even one sent to every frame, so it can't be applied twice or
 * answered by the wrong frame.
 */
export function pageCommandRoute(frame: FrameKind, _control: PageControl): PageCommandRoute {
  const isTop = frame === 'top';
  return { runHere: isTop, forwardToSameOriginSubFrames: isTop };
}

/** What a following sub-frame last applied. */
export type FollowerState =
  | { translated: false }
  | { translated: true; targetLanguage: string; sourceLanguage: string | undefined };

export type FollowerStep =
  | { action: 'wait' }
  | { action: 'stay' }
  /** `sourceLanguage` only for the user's From pick; otherwise the frame detects, like the top frame. */
  | { action: 'translate'; targetLanguage: string; sourceLanguage: string | undefined }
  | { action: 'restore' };

/**
 * What a same-origin sub-frame does with the top frame's latest decision.
 * `wait` means none for this page load yet (an entry from a previous page
 * has another origin). `stay` means this frame already matches it.
 */
export function followTopFrame(
  decision: FrameLanguageDecision | null,
  topOrigin: string,
  current: FollowerState,
): FollowerStep {
  if (!decision || decision.mainFrameOrigin !== topOrigin) return { action: 'wait' };
  if (!decision.shouldTranslate) return current.translated ? { action: 'restore' } : { action: 'stay' };
  // Only a From pick is forced on the provider; a detected language (Safari names
  // it its own way, e.g. zh-Hans) sent as explicit makes Google echo the text.
  const sourceLanguage = decision.sourceLanguageIsExplicit ? decision.originalLanguage : undefined;
  if (
    current.translated &&
    current.targetLanguage === decision.targetLanguage &&
    current.sourceLanguage === sourceLanguage
  ) {
    return { action: 'stay' };
  }
  return { action: 'translate', targetLanguage: decision.targetLanguage, sourceLanguage };
}
