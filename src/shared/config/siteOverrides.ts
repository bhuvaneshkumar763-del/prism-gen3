/** Per-hostname override resolution: an explicit host override, else the global default. */

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

/** Setting the code to `'auto'` clears the override rather than storing the literal string. */
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

/** Removes a saved override outright (the options page's per-host remove button). */
export function clearSourceLanguageOverrideForHost(
  sourceLanguageByHost: Record<string, string>,
  hostname: string,
): Record<string, string> {
  const next = { ...sourceLanguageByHost };
  delete next[hostname];
  return next;
}
