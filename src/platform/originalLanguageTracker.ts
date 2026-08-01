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
async function detectFromPageText(): Promise<string> {
  try {
    const sample = (document.body?.innerText ?? '').slice(0, 4000).trim();
    if (!sample || typeof browser.i18n?.detectLanguage !== 'function') return 'und';
    const result = await browser.i18n.detectLanguage(sample);
    const top = result?.languages?.[0]?.language;
    return top ?? 'und';
  } catch (e) {
    console.warn('[prism] language detection failed, continuing as "und"', e);
    return 'und';
  }
}

export function createOriginalLanguageTracker() {
  let language = 'und';

  /**
   * Never rejects. Callers gate real behavior (auto-translate on load) on
   * this settling, so a rejection here is indistinguishable from "the user
   * doesn't want this page translated."
   */
  async function start(): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitUntilVisible();
      language = await detectFromPageText();
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
