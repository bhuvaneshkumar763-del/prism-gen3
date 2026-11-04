import { describe, expect, it, vi } from 'vitest';
import { tabIdOrActive } from './targetTab';

describe('tabIdOrActive', () => {
  it('uses the tab the menu or shortcut was given, not whichever tab is active now', async () => {
    const getActive = vi.fn(async () => 2);
    expect(await tabIdOrActive({ id: 9 }, getActive)).toBe(9);
    expect(getActive).not.toHaveBeenCalled();
  });

  it('falls back to the active tab when no tab was given', async () => {
    expect(await tabIdOrActive(undefined, async () => 2)).toBe(2);
  });

  it('falls back when the given tab has no real id (TAB_ID_NONE)', async () => {
    expect(await tabIdOrActive({ id: -1 }, async () => 2)).toBe(2);
    expect(await tabIdOrActive({}, async () => 2)).toBe(2);
  });
});
