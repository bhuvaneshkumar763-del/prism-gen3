import { describe, expect, it } from 'vitest';
import { TOGGLE_TRANSLATE_COMMAND, translateShortcut } from './shortcut';

describe('translateShortcut', () => {
  it('returns the live binding for the translate command', () => {
    expect(
      translateShortcut([
        { name: '_execute_action', shortcut: 'Alt+Shift+P' },
        { name: TOGGLE_TRANSLATE_COMMAND, shortcut: 'Alt+Shift+T' },
      ]),
    ).toBe('Alt+Shift+T');
  });

  it('reflects a binding the user remapped, rather than the default', () => {
    expect(translateShortcut([{ name: TOGGLE_TRANSLATE_COMMAND, shortcut: 'Ctrl+Shift+Y' }])).toBe('Ctrl+Shift+Y');
  });

  it('returns null when the command has no key bound — the browser reports an empty string, and a hint saying "Shortcut: " would be worse than none', () => {
    expect(translateShortcut([{ name: TOGGLE_TRANSLATE_COMMAND, shortcut: '' }])).toBeNull();
    expect(translateShortcut([{ name: TOGGLE_TRANSLATE_COMMAND }])).toBeNull();
    expect(translateShortcut([])).toBeNull();
  });
});
