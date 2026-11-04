/**
 * The tab a context-menu click or shortcut was for. The browser passes it;
 * the active tab is only a fallback (no tab given, or TAB_ID_NONE), since by
 * the time the action runs another tab may be active.
 */
export async function tabIdOrActive(
  tab: { id?: number } | undefined,
  getActiveTabId: () => Promise<number>,
): Promise<number> {
  if (tab?.id !== undefined && tab.id >= 0) return tab.id;
  return getActiveTabId();
}
