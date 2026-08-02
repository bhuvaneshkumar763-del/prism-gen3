/**
 * Per-hostname override resolution — the pre-rewrite fork duplicated the
 * "does this host have an explicit override, else fall back to the global
 * default" check in three separate places (popup, options, content script).
 * One tested home for it here instead.
 */

export interface BubbleVisibilityInput {
  hostname: string;
  bubbleEnabled: boolean;
  bubbleByHost: Record<string, boolean>;
}

/** `bubbleByHost[hostname]` wins if present; otherwise falls back to the global `bubbleEnabled` default. */
export function resolveBubbleVisibility({ hostname, bubbleEnabled, bubbleByHost }: BubbleVisibilityInput): boolean {
  return Object.hasOwn(bubbleByHost, hostname) ? bubbleByHost[hostname] === true : bubbleEnabled;
}

export function setBubbleVisibilityForHost(
  bubbleByHost: Record<string, boolean>,
  hostname: string,
  visible: boolean,
): Record<string, boolean> {
  return { ...bubbleByHost, [hostname]: visible };
}

export function clearBubbleOverrideForHost(
  bubbleByHost: Record<string, boolean>,
  hostname: string,
): Record<string, boolean> {
  const next = { ...bubbleByHost };
  delete next[hostname];
  return next;
}

/** Falls back to `fallback` (typically `'auto'`) when the host has no saved override. */
export function resolveSourceLanguageForHost(
  sourceLanguageByHost: Record<string, string>,
  hostname: string,
  fallback: string,
): string {
  return sourceLanguageByHost[hostname] ?? fallback;
}

/** Setting the code to `'auto'` clears the override rather than storing the literal string, matching the fork's `onSourceLanguageChange`. */
export function setSourceLanguageForHost(
  sourceLanguageByHost: Record<string, string>,
  hostname: string,
  code: string,
): Record<string, string> {
  if (code === 'auto') {
    const next = { ...sourceLanguageByHost };
    delete next[hostname];
    return next;
  }
  return { ...sourceLanguageByHost, [hostname]: code };
}
