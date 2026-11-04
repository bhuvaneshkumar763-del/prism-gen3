/** Posted by the top frame to its sub-frames after publishing a new frame decision. */
export const FRAME_SYNC_KEY = 'prismFrameSync';

/**
 * The page key a sub-frame takes from a sync message. Checked by origin, not by
 * comparing the sender with `window.top`: Safari gives content scripts their own
 * window proxies, so that comparison never holds there. A forged key finds no
 * decision in the background, so the origin check is all it needs.
 */
export function pageKeyFromSync(data: unknown, origin: string, ownOrigin: string): string | undefined {
  if (origin !== ownOrigin || typeof data !== 'object' || data === null) return undefined;
  const message = data as Record<string, unknown>;
  if (message[FRAME_SYNC_KEY] !== true) return undefined;
  return typeof message.pageKey === 'string' ? message.pageKey : undefined;
}
