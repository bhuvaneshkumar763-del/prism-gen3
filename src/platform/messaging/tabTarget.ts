/**
 * The one place that knows how to find "the tab a page-scoped message
 * should go to." The old repo had this exact logic hand-duplicated between
 * its messaging layer and `background.ts` — this file exists specifically
 * so that never happens here: `popup/App.tsx`'s translate/restore buttons
 * and `background.ts`'s context-menu/keyboard-command handlers both call
 * this same function (see `getActiveTabId.test.ts` for a test exercising
 * it from more than one conceptual call site).
 */
export async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}
