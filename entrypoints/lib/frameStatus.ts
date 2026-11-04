import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';

/**
 * A sub-frame's last follow step, for pages that opt in with
 * `<meta name="prism-diagnostics">` (the iPhone Simulator check's test pages):
 * there's no console to read on a simulated iPhone.
 */
export function describeFollow(decision: FrameLanguageDecision | null, topOrigin: string, action: string): string {
  if (!decision) return 'no-decision';
  if (decision.mainFrameOrigin !== topOrigin) return `origin-mismatch:${decision.mainFrameOrigin}|${topOrigin}`;
  return action;
}

export function describeTranslated(state: string, errorKind: string | null): string {
  return errorKind ? `translated:${state}:${errorKind}` : `translated:${state}`;
}

export function describeFollowError(e: unknown): string {
  return `error:${e instanceof Error ? e.message : String(e)}`;
}

/** Shown on the frame's own <html>, and only when the page asked for it. */
export function showFrameStatus(doc: Document, status: string): void {
  if (!doc.querySelector('meta[name="prism-diagnostics"]')) return;
  doc.documentElement.dataset.prismFrame = status;
}
