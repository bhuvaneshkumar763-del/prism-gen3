/**
 * Detects the page's original language and lives in `src/platform/` because
 * it touches browser APIs; the auto-translate decision itself is in
 * `src/engine/pageTranslator/autoTranslateDecision.ts`. Detected codes are
 * returned as the browser reports them, without normalization.
 */

import { withTimeout } from '../shared/withTimeout';
import { sendMessage } from './messaging/protocol';

/** Exported so `content.ts` derives its sub-frame poll budget from the same bound. */
export const VISIBILITY_TIMEOUT_MS = 5000;

/**
 * Resolves when the tab becomes visible, capped so a tab that never fires
 * `visibilitychange` (background/prerendered tabs, some WebKit engines) can't
 * block the auto-translate decision forever. Detecting off-screen is harmless.
 */
async function waitUntilVisible(timeoutMs = VISIBILITY_TIMEOUT_MS): Promise<void> {
  if (document.visibilityState === 'visible') return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', handler);
      clearTimeout(timer);
      resolve();
    };
    const handler = () => {
      if (document.visibilityState === 'visible') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    document.addEventListener('visibilitychange', handler);
  });
}

/**
 * Bounds each detection call: Firefox's `i18n.detectLanguage` can hang
 * without resolving or rejecting (Mozilla bug 1712214), which would stall
 * the auto-translate decision. Generous for a near-instant local call.
 */
const DETECT_LANGUAGE_TIMEOUT_MS = 3000;

/**
 * `start()`'s worst case: the visibility wait runs before detection, so the
 * bounds stack. Exported so `content.ts`'s sub-frame poll budget covers it.
 */
export const MAIN_FRAME_DECISION_WORST_CASE_MS = VISIBILITY_TIMEOUT_MS + DETECT_LANGUAGE_TIMEOUT_MS;

/**
 * Samples body text via a `TreeWalker`: unlike `innerText` it forces no
 * layout, and unlike `textContent` it skips script/style content. Hidden text
 * can leak in, which is acceptable for a coarse fallback heuristic.
 */
function sampleBodyText(maxChars: number): string {
  if (!document.body) return '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName;
      return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let sample = '';
  let node: Node | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: TreeWalker's own idiomatic iteration form
  while (sample.length < maxChars && (node = walker.nextNode())) {
    sample += node.textContent ?? '';
  }
  return sample.slice(0, maxChars);
}

/**
 * Fallback detection; always resolves, `'und'` on any failure. `i18n.detectLanguage`
 * is feature-detected and wrapped because it's absent or broken on some engines.
 */
async function detectFromPageText(): Promise<string> {
  try {
    const sample = sampleBodyText(4000).trim();
    if (!sample || typeof browser.i18n?.detectLanguage !== 'function') return 'und';
    const result = await withTimeout(browser.i18n.detectLanguage(sample), DETECT_LANGUAGE_TIMEOUT_MS);
    const top = result?.languages?.[0]?.language;
    return top ?? 'und';
  } catch (e) {
    console.warn('[prism] language detection failed, continuing as "und"', e);
    return 'und';
  }
}

/**
 * Primary detection: asks the background to run `browser.tabs.detectLanguage()`,
 * which sees the tab's real content. Timeout-guarded like the text fallback.
 */
async function detectViaTab(): Promise<string> {
  try {
    const result = await withTimeout(sendMessage('detectTabLanguage', undefined), DETECT_LANGUAGE_TIMEOUT_MS);
    return result || 'und';
  } catch (e) {
    console.warn('[prism] tabs.detectLanguage relay failed, falling back to text-sample detection', e);
    return 'und';
  }
}

export function createOriginalLanguageTracker() {
  let language = 'und';

  /**
   * Never rejects: callers gate auto-translate on this settling. Both
   * detectors run in parallel so the worst case is one timeout, not two;
   * the tab relay's answer wins unless it's `'und'`.
   */
  async function detect(): Promise<void> {
    try {
      await waitUntilVisible();
      const [viaTab, viaText] = await Promise.all([detectViaTab(), detectFromPageText()]);
      language = viaTab !== 'und' ? viaTab : viaText;
    } catch (e) {
      console.warn('[prism] original-language tracking failed, continuing as "und"', e);
      language = 'und';
    }
  }

  // One detection, shared by every caller: the auto-translate decision and
  // the floating bubble (which shows "Vietnamese → English") both await it,
  // and each detection costs a browser round trip plus a page-text sample.
  let started: Promise<void> | null = null;
  function start(): Promise<void> {
    started ??= detect();
    return started;
  }

  return {
    start,
    get: () => language,
  };
}

export type OriginalLanguageTracker = ReturnType<typeof createOriginalLanguageTracker>;
