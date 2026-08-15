---
name: post-launch-ui-depth-pass-phase-2-popup
description: Same pass as Phase 1 above (bubble), same three-phase plan agreed with the
---

# Post-launch UI-depth pass, Phase 2: popup

Same pass as Phase 1 above (bubble), same three-phase plan agreed with the
user. This phase brings the popup from 4 controls up toward the fork's 19:
quick-language pills, a service switch (both already existed), and now
per-site/per-language quick actions (always/never-translate this site,
always translate from {detected language}, show-bubble-on-this-site), plus
closing the popup error-surface gap Phase 1's own writeup flagged as still
open.

**New protocol messages** (`src/platform/messaging/protocol.ts`):
`getOriginalLanguage()` (a tab's detected source language, `'und'` if not
yet resolved) and `getPageError()` (`pageTranslator.getLastError()`).
Neither existed before — the popup had no way to read either value from a
tab's content script.

**Prerequisite refactor**: `createOriginalLanguageTracker()` used to live
entirely inside a fire-and-forget IIFE in `entrypoints/content.ts`, with no
handle escaping it — nothing else could ask it "what language did you
detect?" Hoisted to `main()`'s own scope so the new `getOriginalLanguage`
handler can read the same tracker the auto-translate decision already uses,
instead of re-detecting.

**Closing the popup error-surface gap**: the popup's `pageTranslate` click
handler resolves the instant `translatePage()` returns — long before
`translateLoop.ts`'s 3-consecutive-failures threshold could ever fire (see
Phase 1's incident writeup above). `onTranslateClick` now schedules two
`getPageError` polls (2s and 6s after the click) and surfaces whatever it
finds the same way a request-time error would. **Verified for real**
against the built extension: a direct `getPageError` round trip via
`chrome.tabs.sendMessage` against a real content-script tab returns `null`
before any translate attempt, and a real string message after forcing
repeated batch failures (llm provider pointed at an unreachable endpoint) —
same wire-format pattern `tests/e2e/run.mjs` already uses for `getPageState`.

**New config keys** (purely additive, no migration): `targetLanguages`
(recency-ordered list powering the popup's quick-pick pills — see
`addRecentTargetLanguage` in `src/shared/config/listMutations.ts`, most
recent first, capped at 5) and `hoverTooltipEnabled`/`selectionPopupEnabled`
(both previously hardcoded-on in `entrypoints/content.ts` with **no config
at all** — now real togglable settings, gated live via `configStore.onChanged`
so toggling either one in the popup mounts/unmounts the corresponding
content-script UI on the real tab without a reload).

**Every site/list mutation goes through the same pure functions Phase 1
introduced** (`src/shared/config/listMutations.ts` +
`src/platform/configMutations.ts`) — never a raw `configStore.set(...)` on
the four always/never-translate keys. This is what makes the cross-list
cleanup (adding a site to "always" removes it from "never") apply
consistently on the popup too, not just the bubble.

**A real harness limitation, hit again and handled the same way as
elsewhere in this repo's history**: verifying the popup's own per-site
toggles (Always-translate-this-site, show-bubble-on-this-site) against a
*specific* real hostname isn't possible with this repo's Playwright
harness — opening `popup.html` as a plain tab (the only way Playwright can
load it at all; a real toolbar-icon click can't be simulated headlessly,
already documented in `tests/e2e/run.mjs`'s header) makes that tab itself
"the active tab" as far as `chrome.tabs.query({active:true})` is concerned,
so the popup's own hostname resolution doesn't see the real content page.
Verified instead: (a) the write path fires at all (a real
`alwaysTranslateSites` entry appears in storage after the toggle click) and
(b) the underlying pure mutation is fully unit-tested
(`listMutations.test.ts`) — matching this repo's established precedent of
documenting this exact limitation rather than chasing a real toolbar-popup
gesture Playwright fundamentally can't produce headlessly.

**`tests/e2e/run.mjs`** gained structural popup assertions (`.primaryBtn`,
the "Always translate this site" toggle row, the "More settings" expander
all present) alongside the pre-existing `.quickField` check.

Full verification chain (`compile`, `lint` — 0 errors, this repo gates on
it — both CI guards, `test:coverage`, `build` ×2 browsers,
`guard:bundle-size`, `test:e2e`, `npm audit`) clean throughout, plus the
real-browser checks above.

**Recommended next step (at the time Phase 2 shipped)**: Phase 3
(settings) — see the next section.
