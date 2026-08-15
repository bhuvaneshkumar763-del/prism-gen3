---
name: post-launch-ui-depth-pass-phase-3-settings
description: Third and final phase of the pass documented above (Phases 1-2: bubble,
---

# Post-launch UI-depth pass, Phase 3: settings

Third and final phase of the pass documented above (Phases 1-2: bubble,
popup). The options page goes from 4 sections/13 fields to 5 tabs,
restored toward the pre-rewrite fork's 6-tab layout — **deliberately not
6**: no Voice or Dictionary tab, since neither engine subsystem (TTS,
custom dictionary) exists in Gen 3 at all, agreed with the user as an
explicit scope boundary rather than rebuilt just to fill out the tab count.

**New components** (`components/options/`), ported from the fork:
`TabSwitcher.tsx` (ARIA APG automatic-activation tablist — arrow/Home/End
navigate and activate in one step, roving `tabindex`; the actual wrap-around
math lives in `src/shared/ui/tabNavigation.ts`, coverage-gated and unit
tested rather than only exercised by clicking through a real tablist),
`TabPanel.tsx`, and `StringListEditor.tsx` (the shared add/remove list
widget, with a `languageOptions` variant swapping the free-text input for a
`<select>` fed from `src/shared/languages.ts`).

**Tabs**: General (theme, target/source language — now real `<select>`s
fed from `COMMON_LANGUAGES`, replacing the free-text inputs the 4-section
version had; preferred-target-languages list; Backup), Page translation
(provider + fields, moved here from the old single page; the four
always/never site/language lists, now wired through
`src/shared/config/listMutations.ts` so cross-list cleanup finally applies
on the options page too — see below), Bubble (`bubbleEnabled` toggle,
per-site override table over `bubbleByHost`, "Reset remembered position"),
Selection & hover (`hoverTooltipEnabled`/`selectionPopupEnabled` toggles,
per-host source-language override table over `sourceLanguageByHost`),
Advanced (`translationCacheEnabled` toggle, cache size/clear, the
pre-existing diagnostics panel — its `effectiveConfig` dump already covers
every new key automatically since it iterates `Object.keys(defaultConfig)`,
no changes needed there).

**Fixes the exact fork inconsistency `listMutations.ts` was built to
close** (see Phase 1's writeup above): the fork's popup applied cross-list
cleanup (adding a site to "always" removed it from "never"), its options
page's list editors didn't — a site could end up listed in both depending
which surface you used last. **Verified for real** against the built
extension: adding a host to "Always translate these sites" on the options
page live-removes it from "Never translate these sites," and vice versa.

**New config keys** (purely additive, no migration): `theme`
(`'auto'|'light'|'dark'`) and `translationCacheEnabled` — the second isn't
decorative: `entrypoints/background.ts`'s `translatePieces` handler
actually skips both the cache read and the cache write when it's off, not
just a checkbox with no wiring behind it. **Verified for real**: toggling
it off, then sending a real `translatePieces` message (from the options
page's own context — self-messaging a service worker from *itself* via
`chrome.runtime.sendMessage` doesn't reliably loop back in Chrome, a real
finding from writing this check; sending from a genuinely different
context, the same shape as the real content-script → background flow,
does), the reported cache size in Diagnostics is unchanged before/after.

**Theme**: `src/platform/applyTheme.ts` sets a `data-theme` attribute on
`<html>` from the `theme` config key, called from both `popup/main.tsx`
and `options/main.tsx` before `render()`. Both `App.css` files were
converted from `@media (prefers-color-scheme: dark)` blocks to
`:root[data-theme="dark"]`/`:root[data-theme="light"]` attribute selectors
— a media query alone can't express an explicit override (a user picking
"Always light" while their OS is set to dark still needs light styles to
win), and an attribute selector's higher specificity settles that
deterministically. The bubble/hover-tooltip/selection-popup shadow-DOM
surfaces are unaffected — Phase 1 already covered the bubble with
`prefers-color-scheme` variants, and threading an explicit theme into a
shadow root injected on third-party pages was already noted as a stretch
goal, not required here.

**`restoreToDefault()`** added to `configStore.ts` — implemented as
`import(JSON.stringify(defaultConfig))`, deliberately **without** the
`browser.runtime.reload()` the fork's equivalent used: this store's
`import()` already updates in-memory state and fires `onChanged` on its
own, and reloading the extension from inside the very options page that
called this would just kill the page mid-write.

**`src/shared/config/backup.ts`**: `serializeBackup`/`parseBackup`, the
pure validation layer between `configStore.export()`/`import()` (which
already existed, already tested, just never wired to any UI before this)
and the options page's Export/Import buttons. `parseBackup` accepts either
its own `{version, timestamp, config}` wrapper or a bare config object
(what `configStore.export()` itself produces) and returns a real error
message instead of throwing on malformed JSON or a config shape that
doesn't validate.

**`tests/e2e/run.mjs`** gained structural options assertions (5
`role="tab"` elements, 5 `role="tabpanel"` elements, "Export settings"
present) alongside the pre-existing diagnostics-button check.

Full verification chain (`compile`, `lint` — 0 errors — both CI guards,
`test:coverage`, `build` ×2 browsers, `guard:bundle-size`, `test:e2e`,
`npm audit`) clean throughout, plus 10 real-browser checks against the
built extension: keyboard tab navigation (ArrowRight, End wrap-around),
cross-list cleanup on the options page, the bubble per-site override table
(display + remove), and the cache-toggle round trip above.

**This completes the three-phase post-launch UI-depth pass** (bubble,
popup, settings). See the Phase 1/2 sections above for the full account of
what motivated it and what shipped in each phase.
