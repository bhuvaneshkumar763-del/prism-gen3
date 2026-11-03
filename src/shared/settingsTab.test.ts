import { describe, expect, it } from 'vitest';
import { planOpenSettings } from './settingsTab';

const OPTIONS = 'chrome-extension://abc/options.html';

describe('planOpenSettings', () => {
  it('reuses an open Settings tab, switching it to the asked-for section', () => {
    const plan = planOpenSettings(
      [
        { tabId: 3, windowId: 1, url: 'chrome-extension://abc/popup.html' },
        { tabId: 7, windowId: 2, url: `${OPTIONS}#general` },
      ],
      OPTIONS,
      'page',
    );
    expect(plan).toEqual({ kind: 'focus', tabId: 7, windowId: 2, url: `${OPTIONS}#page` });
  });

  it('reuses an open Settings tab as it is when no section is asked for', () => {
    const plan = planOpenSettings([{ tabId: 7, windowId: 2, url: OPTIONS }], OPTIONS, undefined);
    expect(plan).toEqual({ kind: 'focus', tabId: 7, windowId: 2 });
  });

  it('opens a new tab at the section when Settings is not open', () => {
    expect(planOpenSettings([], OPTIONS, 'page')).toEqual({ kind: 'create', url: `${OPTIONS}#page` });
  });

  it('opens Settings as a normal tab when nothing is open, so the next link can find and reuse it', () => {
    expect(planOpenSettings([], OPTIONS, undefined)).toEqual({ kind: 'create', url: OPTIONS });
  });

  it("uses the browser's own Settings opener when it can't see open tabs and no section is asked for", () => {
    expect(planOpenSettings([], OPTIONS, undefined, { canSeeOpenTabs: false })).toEqual({ kind: 'openOptionsPage' });
    expect(planOpenSettings([], OPTIONS, 'page', { canSeeOpenTabs: false })).toEqual({
      kind: 'create',
      url: `${OPTIONS}#page`,
    });
  });

  it('ignores tabs it cannot see the address of, and pages that only look similar', () => {
    const plan = planOpenSettings(
      [
        { tabId: 1, url: undefined },
        { tabId: 2, url: 'chrome-extension://abc/options.html.evil' },
        { tabId: 3, url: 'chrome-extension://other/options.html' },
      ],
      OPTIONS,
      'page',
    );
    expect(plan).toEqual({ kind: 'create', url: `${OPTIONS}#page` });
  });

  it('only accepts a plain word as a section', () => {
    expect(planOpenSettings([], OPTIONS, 'page#x')).toEqual({ kind: 'create', url: OPTIONS });
    expect(planOpenSettings([], OPTIONS, '')).toEqual({ kind: 'create', url: OPTIONS });
  });
});
