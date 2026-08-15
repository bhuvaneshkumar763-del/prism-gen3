---
name: post-launch-ui-depth-pass-bubble-popup-settings-restored-toward-the-pre-rewrite-fork-s-feature-set-phase-1-bubble
description: A real user compared this rewrite's popup/bubble/options against the
---

# Post-launch UI-depth pass: bubble/popup/settings restored toward the pre-rewrite fork's feature set (Phase 1: bubble)

A real user compared this rewrite's popup/bubble/options against the
pre-rewrite fork (`bhuvaneshkumar763-del/prism-translate`, the Gen 2
WXT+Solid rewrite of the original vanilla-JS extension) and reported all
three as noticeably thinner — specifically the bubble, which "only shows up
when translated... and disappears when I remove translation," making it
useless as a primary translate control. A deep-cut comparison confirmed the
gap for real (config keys 13 vs. ~45, popup controls 4 vs. 19, bubble
controls 2 vs. 9+drag/dock, settings 4 sections/13 fields vs. 6 tabs/~39).
Scoped with the user into three phases — bubble, then popup, then
settings — keeping the 5 supported providers as-is (ADRs 0004/0005 dropped
Bing/Yandex/DeepL deliberately; not reversed) and explicitly not rebuilding
TTS or the custom dictionary (those engine subsystems don't exist in Gen 3).
This section covers **Phase 1 (bubble)**; Phase 2 (popup) and Phase 3
(settings) are separate follow-ups.

**What changed**: the bubble is now always visible on every page (not
gated on `pageState === 'translated'`), draggable with edge-docking and a
remembered `{side, yFrac}` position (ported faithfully from the fork's
`applyState`/`previewAt`/`positionPanel` math, including its two
deliberately-different `maxY` formulas), and its hover/long-press panel
carries real From/To/Service pickers plus Always/Settings/Hide chips — full
parity with the fork's bubble, plus the "Translation failed" state this
repo's own post-launch incident (above) added, which the fork never had.

**New config keys** (`src/shared/config/schema.ts`, purely additive, no
migration): `bubbleEnabled` (bool, default `true`), `bubbleByHost`
(`Record<host, bool>`), `bubblePosition` (`{side, yFrac} | null`),
`sourceLanguageByHost` (`Record<host, string>`). Booleans, not the fork's
`'yes'|'no'` string enum — that only existed to match the fork's legacy
storage data, which this codebase never had.

**Where the logic lives**: `src/shared/bubble/bubblePosition.ts` (pure drag/
dock/panel-placement geometry, DOM-free so it's actually unit-testable —
happy-dom has no `visualViewport` and stubs `getBoundingClientRect`/
`setPointerCapture`, so a DOM-level drag test would be theatre),
`src/shared/config/siteOverrides.ts` (per-host visibility/source-language
resolution — the fork duplicated this "override if present else global
default" check in three places, one tested home here instead),
`src/shared/config/listMutations.ts` (cross-list always/never-translate
cleanup as pure snapshot→patch — **fixes a real fork inconsistency**: its
popup removed a site from "never" when adding it to "always," but its
options page's list editors didn't, so a site could end up in both lists
depending which surface you used last), and `src/platform/configMutations.ts`
(the one place that applies a list-mutation patch to the real store — every
UI surface goes through this, never a raw `configStore.set()` on those four
keys directly).

**The `mountBubble.ts` architecture had to change.** It used to `dispose()`
and fully `render()` again on every `update()` — fine for a static
translated/not-translated label, fatal for a draggable bubble (the element
drag math writes `style.left/top` onto would be destroyed and recreated
mid-drag, every pointer/config listener torn down and re-added, pointer
capture lost). Fixed: it now renders **once**, backed by a Solid store
(`components/bubble/bubbleState.ts`); `update(patch)` just calls the
store's setter, and `FloatingBubble.tsx` reads the store directly in JSX so
Solid's own fine-grained reactivity handles the redraw.

**A real bug found only by testing the built extension**, not caught by
unit tests or `tsc`: on a fresh content-script load, `FloatingBubble.tsx`
seeds its target/source-language, service, and remembered-position signals
from a single synchronous `configStore.get()` call at construction —
correct once storage has loaded, but `content.ts`'s bubble-mounting code
used to run before `configStore.onReady()` resolved (fire-and-forgotten,
not awaited), so a dragged-to-the-left bubble would render briefly docked
right again on every reload before snapping back once a later config-change
listener caught up. Confirmed with a real Playwright run against the built
extension (drag left → reload → assert the rendered class), not assumed.
Fixed by awaiting `configStore.onReady()` before the first
`syncBubbleVisibility()` call in `entrypoints/content.ts`.

**A real bug found while writing the mountBubble tests**: `mountBubble.ts`
originally passed the shared module-level `DEFAULT_BUBBLE_VIEW_STATE`
constant as `createStore()`'s initial value on every call. Solid's
`createStore` mutates its target object in place, so reusing the same
object reference across multiple `mountBubble()` calls let one instance's
`update()` bleed into the next instance's initial state — concretely, a
test that set `busy: true` left the *next* test's fresh bubble permanently
disabled. Fixed by passing a fresh object literal (`{ ...DEFAULT_BUBBLE_VIEW_STATE }`)
per call. Real production impact too, not just a test artifact: without
this fix, a second `mountBubble()` call on the same page (e.g. after a
`document.documentElement`-wiping SPA navigation) would have inherited
whatever `busy`/`errorMessage` the previous instance last had.

**The busy spinner** (both this repo's and the fork's) shows for
approximately zero frames, because `translatePage()` in
`translateLoop.ts` sets `pageState: 'translated'` **synchronously**, and
the old code cleared `busy` from that same `onStateChange` callback —
clearing it before the caller's own `await` had even resolved. Fixed by
decoupling: only the caller (`handleTranslateClick` in `content.ts`) clears
`busy`, in a `finally`, after `pageTranslator.translatePage()`'s own await
resolves; `onStateChange` no longer touches `busy` at all. `translatePage()`
itself still returns before the network round trip finishes (it kicks off
the queue and returns), so `busy` is still short-lived — that's the
engine's own fire-and-forget design, not a bug this phase tries to fix.

**`lint` is a real CI gate in this repo** (unlike the older TWP/Gen-2 repo,
where a documented a11y backlog is deliberately left unfixed) — every
`a11y/useButtonType`/`useFocusableInteractive`/`noSvgWithoutTitle` finding
introduced by the new panel/chips was fixed for real, not deferred: the
primary button and the three panel chips are real `<button type="button">`
elements (not `<div role="button">`), and every decorative chip/ball SVG
icon got `aria-hidden="true"`.

**Verified against the real built extension** (Playwright, mock content
served from a local static page, same pattern this repo's `tests/e2e/`
harness already uses): bubble visible on a fresh untranslated page (the
headline complaint — also now a permanent assertion in `tests/e2e/run.mjs`),
hovering reveals the panel with all three selects populated, the Always
chip writes `alwaysTranslateSites` for the real hostname, translating then
restoring leaves the bubble visible, dragging to the left edge persists
`bubblePosition` and survives a reload with the correct docked side, and
the Hide chip removes the bubble and stays hidden for that host across a
reload. Full verification chain (`compile`, `lint`, both CI guards,
`test:coverage`, `build` ×2 browsers, `guard:bundle-size`, `test:e2e`,
`npm audit`) clean throughout.

**Recommended next step (at the time Phase 1 shipped)**: Phase 2 (popup) —
see the next section, which covers exactly this.
