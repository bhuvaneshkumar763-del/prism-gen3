import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BadgeApi, createFailureBadge } from './failureBadge';

/** Tab-specific text wins over the global text, as in the browser. */
function fakeAction() {
  const global = { text: '' };
  const perTab = new Map<number, string>();
  const api: BadgeApi = {
    async setBadgeText({ text, tabId }) {
      if (tabId === undefined) global.text = text;
      else perTab.set(tabId, text);
    },
    async setBadgeBackgroundColor() {},
  };
  const shownOn = (tabId: number) => perTab.get(tabId) || global.text;
  return { api, shownOn };
}

describe('createFailureBadge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks only the tab that failed', () => {
    const action = fakeAction();
    createFailureBadge(action.api, 3000)(7);
    expect(action.shownOn(7)).toBe('!');
    expect(action.shownOn(8)).toBe('');
  });

  it('a second failure keeps the "!" for its full time instead of being cleared by the first one’s timer', () => {
    const action = fakeAction();
    const show = createFailureBadge(action.api, 3000);
    show(7);
    vi.advanceTimersByTime(2000);
    show(7);
    vi.advanceTimersByTime(1500);
    expect(action.shownOn(7)).toBe('!');
    vi.advanceTimersByTime(1500);
    expect(action.shownOn(7)).toBe('');
  });

  it('shows the global badge when the tab is unknown, and clears it after the time', () => {
    const action = fakeAction();
    createFailureBadge(action.api, 3000)();
    expect(action.shownOn(1)).toBe('!');
    vi.advanceTimersByTime(3000);
    expect(action.shownOn(1)).toBe('');
  });

  it('a badge call that fails (tab closed) is swallowed', async () => {
    vi.useRealTimers();
    const api: BadgeApi = {
      setBadgeText: () => Promise.reject(new Error('No tab with id: 7')),
      setBadgeBackgroundColor: () => Promise.reject(new Error('No tab with id: 7')),
    };
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    createFailureBadge(api, 1)(7);
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
