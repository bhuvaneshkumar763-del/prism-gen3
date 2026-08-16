# prism-gen3

## 0.3.0-beta.15

### Minor Changes

- Post-launch audit pass covering correctness, speed, accuracy, and reliability across the whole codebase, with particular focus on the free Google provider:

  - **Translation correctness**: fixed several Google-provider bugs — a "did the provider actually translate this?" safety check that was silently disabled specifically for Google, punctuation that could be dropped at the start of a translated sentence, and an auth-key refresh delay that was 4x longer than intended on failure.
  - **Code samples and opt-outs**: `<pre>`/`<code>` blocks are no longer sent to the translation provider (they were coming back reworded and broken), and the standard `translate="no"`/`.notranslate` opt-out attributes are now honored, matching every other translation tool.
  - **Reliability**: fixed a bug where a single momentary settings-load failure could permanently disable the extension until restart; fixed the translation cache's size tracking so it can't drift and evict valid entries; fixed context-menu re-registration errors that were silently spamming the extension's error log on every background wake-up; capped a slow (not down) translation provider's retry sequence to ~30 seconds instead of a possible ~62-second worst case.
  - **Speed**: batched the translation cache's per-tick reads/writes into single database transactions instead of one per piece; made the "translate what's visible first" reordering only re-measure the page when something actually changed (scrolling, new content) instead of every single tick on long pages.
  - **UI fixes**: site rules typed with mixed case or pasted as a full URL (e.g. "BBC.com") now correctly match; pasting a comma-separated list of sites now adds them all instead of one broken entry; the settings page now shows a real error if a setting fails to save instead of silently reverting; the popup no longer shows a stale "Translated" status when a translation actually failed in the background; the hover-to-see-original tooltip now actually follows the cursor as documented.

  Also hardened both CI guard scripts (the Solid-reactivity and engine-purity checks) to close real gaps that let the exact bug classes they exist to catch slip through undetected.

## 0.3.0-beta.14

### Minor Changes

- Improved reliability, speed, and accuracy together, with particular attention to flaky or low/no internet connectivity (graceful degradation, not full offline translation):

  - **Connectivity awareness** (new `connectivity.ts`): the extension now knows when the browser is offline, skips doomed network attempts instead of burning the retry budget on them, and resumes translation the instant the connection returns instead of waiting for the next scheduled retry.
  - **Distinct error states**: the bubble and popup now show a clear "Offline — will resume automatically" state, separate from "the translation service is actually broken" — previously both looked identical.
  - **Smarter retry**: added jitter to retry delays (desyncs retry waves during a real provider outage) and extended the backoff so a long-lasting outage backs off further over time instead of retrying at a fixed rate forever.
  - **Speed**: translated content now prioritizes what's visible in your viewport first on long pages, and concurrent request limits adapt automatically to a detected slow connection (Chrome only; degrades to the previous fixed behavior everywhere else).
  - **Accuracy**: added a bounded, one-shot retry for translation results that look like a silent failure (empty output, or output that's suspiciously unchanged from the input when the languages genuinely differ), catching a class of silent bad translations that previously went straight through unnoticed.

## 0.3.0-beta.13

### Patch Changes

- Fixed two real reported translation-quality bugs. (1) Some sites' comment sections (e.g. bilibili's main comment thread, as opposed to its danmaku overlay) render through several levels of open shadow DOM, which the page-translation engine's DOM walk couldn't see at all — `element.childNodes` never includes shadow-root content, so all that text was structurally invisible. The walk now crosses open shadow-root boundaries, recursively. (2) The free Google provider grouped multiple DOM text nodes into one request for extra sentence context, but Google's endpoint can genuinely reflow translated text across those internal node boundaries for some language pairs — confirmed with a real request producing duplicated/merged word fragments and truncated output, and matching the reported symptom of stray punctuation appearing at the start of sentences or paragraphs. Reverted Google to one-node-per-piece translation, the same safe default already used by every other provider without this grouping. Also fixed a transitive `nanoid` advisory (npm audit).

## 0.3.0-beta.12

### Patch Changes

- Removed the LibreTranslate translation provider entirely (per user request, right after removing the on-device Built-in AI provider). It had already been demoted from the default provider earlier due to the public libretranslate.com instance rate-limiting unauthenticated requests to the point of being unusable, and wasn't worth keeping as a selectable option. Anyone with it previously selected is migrated back to the default (Google) provider automatically.

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
