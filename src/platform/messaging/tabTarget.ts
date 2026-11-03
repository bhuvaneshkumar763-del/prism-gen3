/**
 * The one place that resolves "the tab a page-scoped message should go to",
 * shared by the popup and background so the logic isn't duplicated.
 */
export async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

export async function getActiveTabId(): Promise<number> {
  const tab = await getActiveTab();
  // getActiveTab already guarantees tab.id is set.
  return tab.id as number;
}
