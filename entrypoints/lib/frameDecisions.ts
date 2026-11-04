import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';

export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** A tab id, or a page key: the token a main frame hands its sub-frames. */
type DecisionKey = number | string;

export interface FrameDecisionStore {
  get(key: DecisionKey): Promise<FrameLanguageDecision | null>;
  set(key: DecisionKey, decision: FrameLanguageDecision): Promise<void>;
  delete(key: DecisionKey): Promise<void>;
}

const keyFor = (key: DecisionKey) => (typeof key === 'number' ? `frameDecision:${key}` : `frameDecisionPage:${key}`);

function isDecision(value: unknown): value is FrameLanguageDecision {
  const d = value as Partial<FrameLanguageDecision> | null;
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof d.shouldTranslate === 'boolean' &&
    typeof d.targetLanguage === 'string' &&
    typeof d.originalLanguage === 'string' &&
    typeof d.mainFrameOrigin === 'string'
  );
}

/**
 * Each tab's frame decision, kept in `storage.session` (when the browser has
 * it) so it survives an MV3 worker restart; memory answers first and is the
 * only copy where session storage is missing or failing.
 */
export function createFrameDecisionStore(area: SessionArea | undefined): FrameDecisionStore {
  const memory = new Map<DecisionKey, FrameLanguageDecision>();
  return {
    async get(key) {
      const remembered = memory.get(key);
      if (remembered || !area) return remembered ?? null;
      try {
        const stored = (await area.get(keyFor(key)))[keyFor(key)];
        // Re-checked: a set() may have landed while storage was read.
        return memory.get(key) ?? (isDecision(stored) ? stored : null);
      } catch {
        return null;
      }
    },
    async set(key, decision) {
      memory.set(key, decision);
      await area?.set({ [keyFor(key)]: decision }).catch(() => {});
    },
    async delete(key) {
      memory.delete(key);
      await area?.remove(keyFor(key)).catch(() => {});
    },
  };
}

/** A main frame's report: its decision, and the page key it hands its sub-frames. */
export type FrameDecisionReport = FrameLanguageDecision & { pageKey?: string };

/** Page keys are short random tokens; anything else is ignored rather than stored. */
const PAGE_KEY = /^[\w-]{8,64}$/;
const validKey = (key: string | undefined) => (key && PAGE_KEY.test(key) ? key : undefined);

/** Which page key each tab's main frame last reported, so a navigation forgets it too. */
const pageKeyByTab = new Map<number, string>();

/**
 * Stores a main frame's decision under its tab and its page key. Safari can
 * name no tab for a sub-frame's message, so sub-frames look it up by the key.
 */
export async function recordFrameDecision(
  store: FrameDecisionStore,
  tabId: number | undefined,
  report: FrameDecisionReport,
): Promise<void> {
  const { pageKey, ...decision } = report;
  const key = validKey(pageKey);
  if (key) await store.set(key, decision);
  if (tabId === undefined) return;
  await store.set(tabId, decision);
  const previous = pageKeyByTab.get(tabId);
  if (previous && previous !== key) await store.delete(previous);
  if (key) pageKeyByTab.set(tabId, key);
}

/** A sub-frame's lookup: by the page key when it has one, else by its tab. */
export async function lookUpFrameDecision(
  store: FrameDecisionStore,
  tabId: number | undefined,
  pageKey: string | undefined,
): Promise<FrameLanguageDecision | null> {
  const key = validKey(pageKey);
  if (key) {
    const byKey = await store.get(key);
    if (byKey) return byKey;
  }
  return tabId === undefined ? null : store.get(tabId);
}

/** Drops a tab's decision and its page key, when the tab starts a new page. */
export async function forgetTabDecision(store: FrameDecisionStore, tabId: number): Promise<void> {
  await store.delete(tabId);
  const key = pageKeyByTab.get(tabId);
  if (key) {
    pageKeyByTab.delete(tabId);
    await store.delete(key);
  }
}
