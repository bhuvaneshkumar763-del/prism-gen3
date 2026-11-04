import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';
import { createFrameDecisionStore, type SessionArea } from './frameDecisions';

const decision: FrameLanguageDecision = {
  shouldTranslate: true,
  targetLanguage: 'en',
  originalLanguage: 'ja',
  mainFrameOrigin: 'https://example.com',
};

describe('createFrameDecisionStore', () => {
  let area: SessionArea;
  beforeEach(() => {
    fakeBrowser.reset();
    area = browser.storage.session as unknown as SessionArea;
  });

  it('still has a tab’s decision after the worker restarts (a new store over the same session storage)', async () => {
    await createFrameDecisionStore(area).set(7, decision);
    const afterRestart = createFrameDecisionStore(area);
    expect(await afterRestart.get(7)).toEqual(decision);
  });

  it('forgets a deleted decision, also across a restart', async () => {
    const store = createFrameDecisionStore(area);
    await store.set(7, decision);
    await store.delete(7);
    expect(await store.get(7)).toBeNull();
    expect(await createFrameDecisionStore(area).get(7)).toBeNull();
  });

  it('keeps tabs apart', async () => {
    await createFrameDecisionStore(area).set(7, decision);
    expect(await createFrameDecisionStore(area).get(8)).toBeNull();
  });

  it('ignores a stored value of the wrong shape (written by another version)', async () => {
    await area.set({ 'frameDecision:7': { shouldTranslate: 'yes' } });
    expect(await createFrameDecisionStore(area).get(7)).toBeNull();
  });

  it('works from memory where the browser has no session storage', async () => {
    const store = createFrameDecisionStore(undefined);
    await store.set(7, decision);
    expect(await store.get(7)).toEqual(decision);
    await store.delete(7);
    expect(await store.get(7)).toBeNull();
  });

  it('falls back to memory when session storage fails', async () => {
    const broken: SessionArea = {
      get: () => Promise.reject(new Error('no access')),
      set: () => Promise.reject(new Error('no access')),
      remove: () => Promise.reject(new Error('no access')),
    };
    const store = createFrameDecisionStore(broken);
    await store.set(7, decision);
    expect(await store.get(7)).toEqual(decision);
    expect(await createFrameDecisionStore(broken).get(7)).toBeNull();
  });
});
