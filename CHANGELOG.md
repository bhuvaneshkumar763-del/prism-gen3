# prism-gen3

## 0.3.0-beta.28

### Patch Changes

- 68e6a5d: Fix a real bug reported by a user: novel543.com (and any similarly-structured page) translated only partially, with no error shown — some filter chips and short labels came through while every book title and description stayed in the original language. The cause was a known, previously narrow-scoped gap: Google's endpoint only reliably translates a piece wrapped in `<a i=N>` markers, and that wrapping only kicked in for pieces holding more than one string — a lone string sent bare is unreliable. `titleTranslator.ts` already worked around this for the tab title, but regular page translation didn't, and most real pages end up with plenty of single-node pieces (one `<li>` per nav/filter item, one `<p>` per paragraph). The Google provider now pads every single-string piece with a throwaway second string before sending, and trims it back off the result, so every request lands on the reliable path.

## 0.3.0-beta.27

### Minor Changes

- Isolates each link in a nav row / breadcrumb trail / chapter-title cluster (`« Prev | Chapter 12 | Next »`) into its own translation piece, instead of letting several short, unrelated link fragments land in one shared multi-item piece.

  This is the follow-up the earlier tag-cluster fix (`#go#be`) explicitly left as a documented gap — a real repro confirmed the same class of risk exists for link clusters: a chapter-nav row's three link texts landed in one multi-item piece today, which the AI/LLM provider (the only provider currently batching sibling nodes into shared pieces) sends as a single segment with parts joined by a separator character — real risk of a model dropping/merging/mistranslating the separator boundary. A single inline link inside an ordinary sentence is unaffected (needs at least 2 short-link siblings with no real prose between them to be recognized as a cluster at all).

## 0.3.0-beta.26

### Minor Changes

- The "translate selected text" trigger now matches TWP's language-awareness settings for when it should show at all, checked directly against their real config rather than assumed:

  - **Default-on fix**: the trigger no longer appears for a lone character or a selection with nothing translatable in it (only punctuation, digits, or whitespace) — matches TWP's `dontShowIfIsNotValidText`, the only one of their selection-popup visibility settings that defaults on. Previously the trigger showed for any non-empty selection at all, with no equivalent filter.
  - **New opt-in setting** ("Don't show the button when the selected text is already in your target language", off by default, matching TWP's own `dontShowIfSelectedTextIsTargetLang` default): when enabled, detects the selected text's language and hides the trigger if it's already confidently the target language, instead of offering a no-op translation.

  Both are configurable from the Selection & hover settings tab.

## 0.3.0-beta.25

### Patch Changes

- Fixed a wrong default shipped in the previous release: the new "translate `<pre>` blocks" setting was defaulted to off, based on a mistaken read of what TWP's own default actually is. Re-checked directly against their real source — TWP's default is in fact to translate `<pre>` blocks unless a user explicitly turns it off. Flipped ours to match, so a page like the reported forum thread (prose wrapped in a bare `<pre>` for line breaks, not code) now translates correctly out of the box, with no setting to find and enable. `<code>` blocks remain protected regardless, same as before.

## 0.3.0-beta.24

### Minor Changes

- Fixed a real bug found via a live user report: an old-school forum (cool18.com) wraps its post bodies in a bare `<pre>` tag purely to preserve the author's line breaks, not to mark code — but `<pre>` was always hardcoded to be skipped entirely (added earlier to protect real code samples from being reworded), silently excluding 60% of that page's content with no way to turn it back on. Compared against TWP's real, current source to check how it handles this: `<pre>` skipping there is a per-user setting, off by default, with one automatic exception — a page that's nothing but one bare `<pre>` (viewing a raw text/JSON response) is always translated regardless. Matched exactly: a new "Translate text inside `<pre>` blocks" toggle on the Page translation settings tab (off by default, matching TWP), plus the same automatic whole-page exception. `<code>` blocks (the real code-sample signal, semantically) stay protected either way.

## 0.3.0-beta.23

### Minor Changes

- Fixed a real bug that could silently disable translation entirely on some sites: an earlier "respect an explicit lang attribute" fix compared every text node's nearest `[lang]` ancestor against the target language, but that walk almost always resolves to `<html lang>` — which most sites set to describe their own UI language, not the actual language of whatever content is being viewed. On pixiv.net specifically, `<html lang="en">` reflects the logged-in user's interface language while a given novel or post can be in any language, so the old check excluded 100% of the page whenever the target language happened to match. Removed the check entirely, matching how TWP (this extension's original inspiration) actually works — confirmed against their live source, which has no equivalent check at all.
- Also closed a real gap found while comparing against TWP's real detection flow end-to-end: this project never called `tabs.detectLanguage()`, a background-only browser API that inspects the browser's own view of a tab's actual rendered content — TWP uses it as its primary detection method, falling back to a client-side text-sample heuristic only when unavailable. This project only ever had the fallback. `tabs.detectLanguage` is now tried first (needs no new permissions — verified), with the existing text-sample method kept as the fallback exactly as before.

## 0.3.0-beta.22

### Minor Changes

- Fixed the deeper cause behind manually-pinned-language mistranslation, informed by comparing this project's real translation pipeline line-by-line against its original inspiration (TWP)'s live, current source: a manually selected site language used to be forced onto _every_ translate request for that site forever, fighting the provider's own per-request auto-detection and mistranslating content that was already correct — confirmed against the live Google endpoint (the same English text came back unchanged with `auto`, and mistranslated when a language was forced). Selecting a language now force-retranslates the page immediately (still fully supported, still remembered so you can see what you picked), but a fresh page load goes back to auto-detection rather than staying pinned forever. Removed the block-level "is this already in my language?" heuristic added as a stopgap for this in a previous release — it's no longer needed now that the actual cause is fixed, and it carried its own risk of confidently-but-wrongly skipping real content on some sites. Also lowered the free Google provider's per-request batching budget to reduce how many unrelated short pieces can share one request, shrinking the surface area for the kind of cross-piece scrambling this project has hit before.

## 0.3.0-beta.21

### Patch Changes

- Fixed translation not working at all in Firefox — auto/"always" translate, manual translate, and a manually-pinned site language were all affected. Root cause: Firefox's `i18n.detectLanguage` has a long-standing upstream reliability bug (Mozilla bug 1712214) where it can simply never resolve or reject, rather than failing cleanly. Two places in this codebase awaited it with no timeout — the page-load language detector (breaking auto/always-translate) and the new "is this already in the target language?" check added for the source-language-override fix (breaking every translate path, since it runs before every translate). Both now give up after 3 seconds and fall back to their existing safe defaults instead of hanging forever. Chrome was never affected — this is why it went unnoticed until Firefox releases became actually installable.
- Fixed AMO signing failing on every release after the first: WXT strips the `-beta.N` prerelease suffix when generating the manifest's `version` field, so every beta build produced the identical `"0.3.0"` — AMO correctly rejected each subsequent signing attempt as a duplicate version. The manifest version is now a proper 4-segment number that changes every beta (`0.3.0.20` for beta.20, etc.), with the full original version string preserved as `version_name`. Also hardened the release workflow so a signing failure no longer takes the entire release down with it.

## 0.3.0-beta.19

### Patch Changes

- No code changes — AMO signing credentials are now configured, so this release exercises the actual signing path added in beta.18 for the first time and should ship with a real signed `.xpi` instead of the unsigned-zip fallback.

## 0.3.0-beta.18

### Patch Changes

- Fixed Firefox releases being uninstallable: every past release's Firefox zip triggered Firefox's confusing "this add-on appears to be corrupt" error on install, which is actually just how Firefox reports "unsigned extension" — it was never a real corruption, and no Firefox release build had ever been permanently installable. Releases are now signed through Mozilla's addons.mozilla.org "unlisted" self-distribution channel once repo maintainers configure signing credentials (`docs/decisions/0008-firefox-amo-signing.md` has the setup steps); until then, releases fall back to the previous unsigned zip, installable temporarily via Firefox's `about:debugging` → "Load Temporary Add-on".

## 0.3.0-beta.17

### Minor Changes

- Fixed two related translation-quality bugs reported on the same site: identically-shaped short tokens (like a chapter-count filter's "> 50" / "> 100" / "> 200") could come back inconsistently reworded, and manually pinning a site's source language (the bubble's "From" picker, or a per-site override) forced that language onto every single translate request for the page, overriding Google's own per-request detection — an English word on an otherwise-foreign page could come back as an unrelated word. Both confirmed against the live endpoint; the second is fixed with a new safety net that recognizes content already in your target language (using surrounding page context, not just the one short word) and leaves it alone regardless of the pinned language.

  Also closes 15 other real gaps:

  - **Accessibility**: text inside a page's shadow-DOM sections (some comment widgets) can now be selected for translation; the floating bubble's settings panel is keyboard-reachable; the text-selection translate button responds to keyboard-driven selection, not just the mouse; frames (`<iframe>`s) now get both translation and an inherited auto-translate decision from the main page, instead of nothing at all.
  - **Reliability**: popup messages to a page now time out instead of hanging on "translating…" forever; settings loaded from storage are validated the same way imported settings already were; a bad/expired API key now fails immediately instead of retrying for ~30 seconds first.
  - **Robustness**: an extremely deeply nested page can no longer crash translation outright.
  - **Floating bubble**: settings changes now roll back visibly if the save fails instead of silently drifting; the bubble's position now actually stays in sync across open tabs; a page's own CSS can no longer hide the bubble/tooltip/selection popup; right-click-menu and keyboard-shortcut translate actions now show a brief toolbar indicator if they fail instead of doing nothing visible.
  - **Polish**: no more flash of the wrong color theme when opening the popup or settings page; the "clear cache" button now shows it's working.

## 0.3.0-beta.16

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
