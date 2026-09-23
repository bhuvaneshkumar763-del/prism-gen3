/** The translate/restore keyboard command, as declared in wxt.config.ts's manifest `commands`. */
export const TOGGLE_TRANSLATE_COMMAND = 'toggle-translate-page';

/**
 * The key currently bound to translate/restore, or null if none is.
 *
 * Read from the browser rather than hard-coded: the user can remap it, and
 * the default can differ by browser. Found via a UI audit: the shortcut
 * existed but wasn't mentioned anywhere in the UI.
 */
export function translateShortcut(commands: ReadonlyArray<{ name?: string; shortcut?: string }>): string | null {
  const bound = commands.find((command) => command.name === TOGGLE_TRANSLATE_COMMAND)?.shortcut?.trim();
  return bound ? bound : null;
}
