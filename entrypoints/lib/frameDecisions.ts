import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';

export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface FrameDecisionStore {
  get(tabId: number): Promise<FrameLanguageDecision | null>;
  set(tabId: number, decision: FrameLanguageDecision): Promise<void>;
  delete(tabId: number): Promise<void>;
}

const keyFor = (tabId: number) => `frameDecision:${tabId}`;

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
  const memory = new Map<number, FrameLanguageDecision>();
  return {
    async get(tabId) {
      const remembered = memory.get(tabId);
      if (remembered || !area) return remembered ?? null;
      try {
        const stored = (await area.get(keyFor(tabId)))[keyFor(tabId)];
        // Re-checked: a set() may have landed while storage was read.
        return memory.get(tabId) ?? (isDecision(stored) ? stored : null);
      } catch {
        return null;
      }
    },
    async set(tabId, decision) {
      memory.set(tabId, decision);
      await area?.set({ [keyFor(tabId)]: decision }).catch(() => {});
    },
    async delete(tabId) {
      memory.delete(tabId);
      await area?.remove(keyFor(tabId)).catch(() => {});
    },
  };
}
