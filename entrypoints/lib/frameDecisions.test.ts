import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';
import {
  createFrameDecisionStore,
  forgetTabDecision,
  lookUpFrameDecision,
  recordFrameDecision,
  type SessionArea,
} from './frameDecisions';

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

describe('page keys: Safari may name no tab for a sub-frame’s message', () => {
  let area: SessionArea;
  beforeEach(() => {
    fakeBrowser.reset();
    area = browser.storage.session as unknown as SessionArea;
  });

  it('finds the main frame’s decision by the page key it handed its frames, with no tab id', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-1234567890' });
    expect(await lookUpFrameDecision(store, undefined, 'k-1234567890')).toEqual(decision);
  });

  it('still answers by tab id when the sub-frame has no key yet', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-1234567890' });
    expect(await lookUpFrameDecision(store, 7, undefined)).toEqual(decision);
  });

  it('finds nothing for a made-up key', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-1234567890' });
    expect(await lookUpFrameDecision(store, undefined, 'k-made-up-000')).toBeNull();
  });

  it('forgets the key with its tab when the tab navigates', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-1234567890' });
    await forgetTabDecision(store, 7);
    expect(await lookUpFrameDecision(store, undefined, 'k-1234567890')).toBeNull();
  });

  it('drops a tab’s old page key when its main frame reports a new one (a reload)', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-old-0000000' });
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'k-new-0000000' });
    expect(await lookUpFrameDecision(store, undefined, 'k-old-0000000')).toBeNull();
    expect(await lookUpFrameDecision(store, undefined, 'k-new-0000000')).toEqual(decision);
  });

  it('stores a report that names no tab under its key only', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, undefined, { ...decision, pageKey: 'k-1234567890' });
    expect(await lookUpFrameDecision(store, undefined, 'k-1234567890')).toEqual(decision);
    expect(await lookUpFrameDecision(store, undefined, undefined)).toBeNull();
  });

  it('ignores a key that is not a short token', async () => {
    const store = createFrameDecisionStore(area);
    await recordFrameDecision(store, 7, { ...decision, pageKey: 'x'.repeat(500) });
    expect(await lookUpFrameDecision(store, undefined, 'x'.repeat(500))).toBeNull();
  });
});
