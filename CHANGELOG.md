# prism-gen3

## 0.3.0-beta.11

### Patch Changes

- Removed the "Built-in AI (on-device)" translation provider entirely. Real investigation traced the reported failure to a hard, unfixable platform limitation rather than a bug: Chrome's on-device Translator API is Google's own proprietary service, gated to actual Google Chrome — it never works in any other Chromium-based browser (Vivaldi, Brave, Opera, Edge, and others), even though they share the same underlying engine and even show the same internal language-package manager page. Since this provider could only ever work for a subset of Chrome users and produced a confusing dead end for everyone else, it's gone rather than half-supported. Anyone with it previously selected is migrated back to the default (Google) provider automatically.

## 0.3.0-beta.10

### Patch Changes

- Fixed a real bug where picking "Built-in AI (on-device)" produced a bare "[builtin] not configured or unavailable" error with no way to tell why. `createProvider('builtin', ...)` only ever runs in the background service worker, and `globalThis.Translator` presence is per-context — so the Options page now asks the background directly (a new `checkBuiltinAvailability` message) instead of guessing, and shows a real status next to the provider picker: not available in this browser/profile (with a pointer to `chrome://on-device-translation-internals`), model needs to download on first use, unsupported for this target language, or ready. The background error message itself is also more actionable now for this specific provider.

## 0.3.0-beta.9

### Patch Changes

- Fixed a real bug where a page's tag list (e.g. `<a><em>#</em>travel</a>` repeated many times in a row — the marker and word split across sibling nodes, common real-world tag markup) got scrambled on translation. Neither the marker nor the bare word alone was recognized as tag text, so the whole list was batched into one shared multi-item translation request and came back reordered/merged. Tag anchors are now isolated by their enclosing `<a>` element's full text, one request per tag, and bare `#`/`@` marker nodes are no longer sent for translation at all.

## 0.3.0-beta.8

### Patch Changes

- Reverted the bubble hover-panel change from the previous release — it was a misdiagnosis of a different, unrelated Android issue the user actually reported. `components/bubble/bubbleStyles.ts` is back to exactly what it was before. The real cause of the reported "table of translation options on top of the bubble" on Android is still open.

## 0.3.0-beta.7

### Patch Changes

- Fixed three real bugs reported by a user: (1) "Attempt to get a record from database without an in-progress transaction" — a regression in the recent cache speed-up, where the persistent IndexedDB connection could be closed by the browser (much more common on mobile) and every subsequent translate would fail; now transparently reopens, retries once, and cache failures no longer break an otherwise-successful translation. (2) On Android, the bubble's From/To/Service panel got stuck permanently open on top of the page after a tap, since touch devices have no way to "unhover" — the hover-reveal behavior is now scoped to real pointer devices only. (3) The default target language was Spanish; changed to English.

## 0.3.0-beta.6

### Patch Changes

- Replaced the extension icon — this had shipped as the literal WXT template default (a puzzle piece) at every size, a known gap since Session 1. New design: two rounded arcs curving into an exchange loop, on a cyan→blue gradient, reading as translation/conversion and staying legible down to 16px. Deliberately a fresh mark, not the older "Prism" triangle-and-dispersion logo the Gen 2 fork uses. A source SVG (public/icon/icon.svg) now ships alongside the sized PNGs, matching the fork's own convention.

## 0.3.0-beta.5

### Patch Changes

- Fixed three real regressions reported by a user comparing this rewrite against the pre-rewrite fork: (1) the translation cache opened and closed a fresh IndexedDB connection and ran a full eviction scan on every write — now a single persistent connection with O(1) incremental size tracking; the content script also now attaches at document_end instead of the default document_idle, starting translation meaningfully earlier on slow-loading pages. (2) Dynamic/streaming content could be silently missed — a 25-node cap on simultaneous text changes per batch is removed, and detached-then-reattached DOM nodes (common in virtualized/recycled list widgets) that changed content while off-DOM are now correctly re-translated instead of permanently skipped. (3) Tag-like tokens (hashtags, chained tags like #go#be, @mentions) are now isolated into their own translation request instead of being batched with surrounding prose, fixing a real marker-scrambling bug in Google's endpoint — ported from proven fix logic in the original pre-rewrite codebase.

## 0.3.0-beta.4

### Minor Changes

- The options page is now a 5-tab layout (General, Page translation, Bubble, Selection & hover, Advanced) restored toward the pre-rewrite fork's depth — no Voice or Dictionary tab, since those engine subsystems don't exist in Gen 3. Adds theme selection, backup export/import, restore-defaults, per-site bubble and source-language override tables, and a translation-cache toggle that actually skips both the cache read and write when off. Also fixes a real fork inconsistency: adding a site to "always translate" now correctly removes it from "never translate" on the options page too, not just the popup. Final phase of the three-phase pass (bubble, popup, settings) restoring UI depth the ground-up rewrite had scoped down.

## 0.3.0-beta.3

### Minor Changes

- The toolbar popup gained the pre-rewrite fork's per-site/per-language quick actions — always/never translate this site, always translate from the detected language, and a per-site floating-bubble toggle — plus a "More settings" section for the hover-tooltip and selection-popup toggles (both previously hardcoded on with no config at all). Also closes a real gap: a translate that later fails is now surfaced in the popup itself, not just the bubble. Second of the three-phase pass (bubble, popup, settings) restoring UI depth the ground-up rewrite had scoped down.

## 0.3.0-beta.2

### Minor Changes

- The floating translate bubble is now always visible on every page (not just after translating), draggable with edge-docking and a remembered position, and its hover panel gained From/To/Service pickers plus Always/Settings/Hide actions — full parity with the pre-rewrite fork's bubble, reported as a real regression by a user comparing the two. Kept the "Translation failed" state this repo added post-launch. First of a three-phase pass (bubble, then popup, then settings) restoring UI depth the ground-up rewrite had scoped down.

## 0.2.2-beta.1

### Patch Changes

- Fix two real bugs reported by a user testing the beta: translation never worked out of the box because the shipped default provider (libretranslate.com, unauthenticated) is rate-limited to the point of being unusable — the default is now 'google' (free, no signup, confirmed working live). Separately, a totally failing provider used to report a false "Translated" success with zero visible error in the popup/bubble; the page translator now tracks consecutive batch failures and surfaces a real "Translation failed" state in the floating bubble instead of silently retrying forever.

## 0.2.2-beta.0

### Patch Changes

- Enter changesets prerelease ("beta") mode. Gen 3's 10-session plan is complete and the codebase is ready for real-world testing before a stable v1 — releases now ship as `X.Y.Z-beta.N` prereleases (auto-detected by the release workflow, which marks the GitHub Release as a prerelease) until this project exits beta with `npx changeset pre exit`.

## 0.2.1

### Patch Changes

- Session 10 (parity audit and launch readiness): compile the ADR index, a full old-repo-vs-Gen-3 feature/provider parity checklist, and an explicit out-of-scope-for-v1 list. Found and documented a real gap via manual verification: content inside an open shadow root on a third-party page is never translated (`collectTextNodes.ts` doesn't descend into shadow roots). No source behavior changed.

## 0.2.0

### Minor Changes

- Add release infrastructure: a committed Playwright E2E harness (real Chrome via `--headless=new`, not the extension-less `chrome-headless-shell`), a bundle-size CI guardrail, a finalized CI pipeline order (typecheck → lint → engine-purity → foot-gun guards → tests+coverage → build → bundle-size → E2E → zip), per-browser zip artifact uploads, a Firefox build-validation CI job, and a release workflow triggered by CI's own completion (idempotent, auto-detects prerelease versions) using Changesets for versioning/changelog.
