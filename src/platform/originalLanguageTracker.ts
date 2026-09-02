/**
 * Detects the page's original (source) language via `browser.i18n
 * .detectLanguage()` against the page's own text, and decides whether to
 * auto-translate on load (the pure decision logic lives in
 * `src/engine/pageTranslator/autoTranslateDecision.ts` — this file is only
 * the browser-API-touching detector, which is why it lives in
 * `src/platform/` and not `src/engine/`).
 *
 * Scope note: main-frame only. The old repo's fork additionally relayed a
 * main-frame's detected language into same-origin iframes (so an iframe
 * doesn't independently auto-translate against its own, possibly
 * different, detected language) via a background round trip. Gen 3 has no
 * typed messaging protocol yet (that's Session 6) and `content.ts` doesn't
 * do anything per-frame today, so that relay isn't built here — an iframe
 * gets no auto-translate decision at all yet, which is a coverage gap, not
 * a behavior regression (nothing auto-translated iframes before this
 * either). Revisit once Session 6's messaging layer exists.
 *
 * Also no language-code normalization table yet (the old repo's
 * `fixTLanguageCode`, e.g. mapping a browser-detected `"prs"` to the
 * standard `"fa-AF"` tag) — that's part of the generated language-name
 * tables the plan defers to Session 7. `detectFromPageText` below returns
 * whatever code `browser.i18n.detectLanguage` reports, as-is.
 */

import { withTimeout } from '../shared/withTimeout';
import { sendMessage } from './messaging/protocol';

/**
 * Resolves when the tab becomes visible — but never waits forever. The cap
 * matters because `start()`'s result gates the auto-translate-on-load
 * decision in content.ts: a permanently-pending promise here means "always
 * translate this site" silently never fires, with nothing logged. A
 * browser that reports a non-'visible' state and then never emits
 * `visibilitychange` (background/prerendered tabs, and WebKit-based engines
 * where these semantics differ) would do exactly that. Falling through
 * after the timeout is safe: the worst case is detecting language on a page
 * that isn't on screen yet, which costs nothing.
 */
async function waitUntilVisible(timeoutMs = 5000): Promise<void> {
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
 * Always resolves — 'und' on any failure, never throws. `i18n.detectLanguage`
 * is feature-detected AND wrapped: it's absent or non-functional on some
 * non-Chromium engines, and an exception escaping here would otherwise kill
 * the auto-translate decision downstream. An unknown language must degrade
 * to "translate anyway if the user asked for this site" (via the
 * always-translate-sites list), never to silence.
 */
/**
 * Real bug, found testing against actual Firefox (not just Chrome, which
 * is all this was ever exercised against until Firefox releases became
 * installable): Firefox's `i18n.detectLanguage` has long-standing
 * upstream reliability problems (e.g. Mozilla bug 1712214) where it can
 * simply never resolve or reject, rather than failing cleanly the way the
 * try/catch below already handles. Without a bound, that hangs this
 * function — and everything downstream awaiting it, including the entire
 * auto-translate-on-load decision — forever, with no error, no timeout,
 * nothing. 3s is generous for what should be a near-instant local call.
 */
const DETECT_LANGUAGE_TIMEOUT_MS = 3000;

/**
 * Speed fix, found via audit: this used to read `document.body.innerText`
 * for the sample below. `innerText` (unlike `textContent`) reflects actual
 * rendering — visibility, `display:none`, generated line breaks — which
 * means the browser must force a full synchronous layout of the whole
 * document just to compute it, on the auto-translate-on-load critical
 * path, before any of it is even needed. A plain `textContent` read has no
 * such cost, but isn't a safe drop-in replacement on its own: it includes
 * `<script>`/`<style>` element content verbatim, so a page with a large
 * inline script near the top of `<body>` would feed raw JS/CSS text into
 * the sample instead of prose, corrupting the language guess. Walking text
 * nodes directly with a `TreeWalker` gets the cheap-read property of
 * `textContent` while still excluding script/style content — visibility
 * isn't accounted for (a `display:none` nav drawer's text can end up in
 * the sample), but this is already a coarse, best-effort heuristic
 * (falls back to `'und'` on any failure, gets overridden by the primary
 * `tabs.detectLanguage` relay whenever that succeeds) where a little
 * hidden boilerplate mixed into 4000 characters of real content isn't
 * going to change the detected language.
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
 * The primary detection path, matching TWP's real, current design
 * (confirmed against their live source, not assumed): relay to the
 * background so it can call `browser.tabs.detectLanguage()` — a
 * background-only API that inspects the browser's own view of the tab's
 * actual content, rather than a client-side `innerText` slice this file
 * builds itself (see `detectFromPageText` above, kept as the fallback for
 * whenever this returns `'und'`). `withTimeout`-guarded for the same
 * reason as `detectFromPageText`'s own call: a message round trip that
 * never resolves must not hang the entire auto-translate decision.
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
   * Never rejects. Callers gate real behavior (auto-translate on load) on
   * this settling, so a rejection here is indistinguishable from "the user
   * doesn't want this page translated."
   *
   * Speed fix, found via an audit: this used to start with an unconditional
   * 150ms sleep before anything else — unlike every other timing constant
   * in this file (the 3s detect timeout, the 5s visibility cap), it had no
   * comment justifying it, and nothing downstream actually needs it:
   * `waitUntilVisible()` already handles a not-yet-visible page correctly
   * on its own, and `detectViaTab()`/`detectFromPageText()` are
   * independently timeout-guarded — this was pure added latency on the
   * auto-translate-on-load critical path with no found purpose.
   *
   * Speed fix, found via audit: `detectViaTab()` (an MV3 message round trip
   * that can cost a cold-start service-worker wake) and `detectFromPageText()`
   * (the fallback) used to run strictly one after the other — awaiting the
   * first in full, THEN starting the second only if it reported `'und'`.
   * Each is independently bounded at `DETECT_LANGUAGE_TIMEOUT_MS`, so the
   * worst case (a slow/unanswered relay, which itself resolves to `'und'`
   * via its own timeout) paid for BOTH timeouts back to back — up to twice
   * the latency on the auto-translate-on-load critical path for no reason,
   * since neither detector's input depends on the other's result. They now
   * start together and are both awaited via `Promise.all`, capping the
   * worst case at one timeout window instead of two, while still
   * preferring the tab relay's result whenever it isn't `'und'` — same
   * preference order as before, just no longer paid for serially. The
   * trade: `detectFromPageText()`'s local `i18n.detectLanguage()` call now
   * always fires (previously skipped whenever the relay alone succeeded);
   * that's a cheap, non-network local call with no forced layout (see
   * `sampleBodyText`'s doc comment), a fair price for cutting the shared
   * worst case in half.
   */
  async function start(): Promise<void> {
    try {
      await waitUntilVisible();
      const [viaTab, viaText] = await Promise.all([detectViaTab(), detectFromPageText()]);
      language = viaTab !== 'und' ? viaTab : viaText;
    } catch (e) {
      console.warn('[prism] original-language tracking failed, continuing as "und"', e);
      language = 'und';
    }
  }

  return {
    start,
    get: () => language,
  };
}

export type OriginalLanguageTracker = ReturnType<typeof createOriginalLanguageTracker>;
