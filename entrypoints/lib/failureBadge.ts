export interface BadgeApi {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
}

/**
 * A "!" on the toolbar button for `durationMs`, on the failing tab when it's
 * known. One timer per tab, restarted by each failure, so an earlier timer
 * can't clear a newer "!". Badge calls fail quietly once a tab has closed.
 */
export function createFailureBadge(action: BadgeApi, durationMs: number): (tabId?: number) => void {
  const timers = new Map<number | undefined, ReturnType<typeof setTimeout>>();
  return (tabId) => {
    const target = tabId === undefined ? {} : { tabId };
    action.setBadgeBackgroundColor({ color: '#d93025', ...target }).catch(() => {});
    action.setBadgeText({ text: '!', ...target }).catch(() => {});
    clearTimeout(timers.get(tabId));
    timers.set(
      tabId,
      setTimeout(() => {
        timers.delete(tabId);
        action.setBadgeText({ text: '', ...target }).catch(() => {});
      }, durationMs),
    );
  };
}
