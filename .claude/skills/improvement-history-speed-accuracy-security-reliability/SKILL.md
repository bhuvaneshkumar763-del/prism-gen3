---
name: improvement-history-speed-accuracy-security-reliability
description: Running ledger of every speed/accuracy/security/reliability improvement pass made to already-shipped functionality. Read this FIRST whenever asked to "improve" the extension — it exists so an audit doesn't re-discover, re-verify, or contradict something already fixed.
---

# Improvement history: speed, accuracy, security, reliability

This is a ledger, not a changelog restatement — `CHANGELOG.md` has the full
per-release prose. This doc exists so that the next time you're asked to
**"improve"** this extension, you start from what's already been checked and
fixed instead of re-deriving it. Read this whole file before starting a new
audit. When you finish one, add a new dated entry at the top of the relevant
category (or a new "Audit round N" entry below) — don't let this file go
stale, it's only useful if kept current.

**How to use this**: an "improve" request is normally scoped to one or more
of accuracy / speed / security / reliability. Read the matching category
section below first — it tells you what's already fixed (don't re-fix it),
what's been explicitly checked and ruled out (don't re-verify it from
scratch unless you have a specific reason to distrust the earlier check),
and what's open/deferred (a good place to start). Then audit for anything
genuinely new. Every fix logged here was verified against real, live
behavior (the Google endpoint directly, or a real page end-to-end) — not
inferred — and shipped with a regression test proven to fail without the
fix. Match that bar for anything new.

---

## Accuracy

### Fixed

- **Trailing whitespace stripped by Google, jamming adjacent words together** (beta.33). Confirmed live: Google strips trailing whitespace from a piece's own translated content (`" start with either "` → `"comenzar con cualquiera"`, both ends gone) — independent of the padding-slot reflow issue below. Any page with inline markup (`<p>Read <b>more</b></p>`) could write back jammed ("ReadMORE"). Fixed generically in `translateLoop.ts`: each source Text node's own leading/trailing whitespace is captured before translating and re-applied at write-back, provider-independent. This was the plan's original Finding-1 recommendation — a narrower version (below) shipped first and this general fix was found missing during real-page verification of the batch-size change.
- **Google's padding-slot reflow could silently drop real content** (beta.32). The beta.28 single-item-piece padding fix (below) could have real translated content reflow into the throwaway padding slot, silently discarded by a `.slice(0, 1)` trim. Now reconstructs the full result by joining every slot back together.
- **Selection-translate silently failing on short text** (beta.33). Page translation was fixed in beta.29 (below) to use the page's detected language instead of literal `'auto'`; the selection popup never got the same fix. Now shares the same detected-language fallback.
- **Silent-failure detector missed the short strings it was built for** (beta.33). The identical-output check only flagged results 40+ chars, but Google's silent-echo failure mode overwhelmingly hits short strings (nav labels, buttons). Now also flags any identical result whose script (CJK/Cyrillic/Arabic/etc.) doesn't match what the target language implies, at any length.
- **MathJax formulas, SVG icon text, icon-font ligatures mistranslated** (beta.33). Matched against TWP's real skip list: `<svg>`, `<template>`, `<math>`, `<mjx-container>`, `<tex-math>`, plus `material-icons`/`material-symbols-outlined` classes are now skipped — none were before.
- **`'auto'` source language silently failing** (beta.29). Google's auto-detection silently echoes text back unchanged (real `200`, no error) for a lot of real content. Page translation now sends the page's own detected language (via `tabs.detectLanguage`, with a text-sample fallback) instead of the literal string `'auto'`.
- **Single-string pieces unreliable on Google's endpoint** (beta.28). Google's endpoint only reliably translates a piece wrapped in `<a i=N>` markers, which only kicked in for multi-string pieces. Now every single-string piece is padded with a throwaway second string before sending.
- **Manually-pinned source language forced onto every future request** (beta.22). Selecting a language used to persist and override the provider's own per-request auto-detection forever. Now force-retranslates once, then a fresh page load goes back to auto-detection.
- **`<html lang>` falsely excluding whole pages** (beta.23). A per-node lang check almost always resolved to `<html lang>`, which reflects UI language, not content language (pixiv.net: `lang="en"` UI, Chinese novel content) — excluded 100% of matching pages. Check removed entirely, matching TWP (no equivalent check).
- **Tag/link clusters scrambled by cross-piece batching** (beta.5, beta.9, beta.27). Hashtags, `#go#be`-style chains, and nav/breadcrumb link clusters (`« Prev | Chapter 12 | Next »`) were batched into shared multi-item pieces and came back reordered/merged/scrambled. Each is now isolated into its own piece.
- **Shadow-DOM content structurally invisible to translation** (beta.13, and again more thoroughly at v0.2.1/Session 10). `element.childNodes` never includes shadow-root content — the DOM walk now crosses open shadow-root boundaries recursively.
- **Google reflow across grouped-node boundaries** (beta.13). Grouping multiple DOM text nodes into one request for extra context let Google reflow translated text across those internal boundaries (duplicated/merged fragments, stray leading punctuation). Reverted to one-node-per-piece for Google, matching every other provider.
- **`<pre>`/`<code>` defaults wrong** (beta.24, beta.25). `<pre>` was hardcoded skipped (broke prose-in-`<pre>` forum pages), then the "translate `<pre>`" toggle shipped defaulted off (broke it the other way) — TWP's real default is translate-on. Matched exactly, with the bare-whole-page `<pre>` exception TWP also has. `<code>` stays protected always.
- **No-letters text mistranslated** (v0.3.0-beta.16-adjacent). Chapter-count filter chips like `"> 100"` came back reworded as `"compare 100"`. Text with no letters at all is now skipped from collection.

### Checked and ruled out (don't re-verify from scratch)

- **HTML entity round-tripping** — `escapeHTML`/`unescapeHTML` handle `&amp; &lt; &gt; &quot; &#39;` correctly, decode-last ordering for `&amp;` verified live.
- **Language code coverage** — `zh/zh-CN/zh-TW/he/iw/no/nb/id/in/pt/pt-BR` all verified against the live endpoint; `zh-TW` correctly returns Traditional.
- **URLs, version strings, code snippets** pass through unmangled. One minor known gap, not scoped: `a.b@c.io` → `ab@c.io` (a dot dropped from an email local-part), low frequency.
- **Positional array alignment at scale** — verified directly at 40/120/300 pieces sharing one request: 0 misaligned. The batching-budget-based misalignment theory doesn't hold; the real reflow risk is within a single piece's `<a i=N>` markers, already handled separately.

### Open / deferred

- None currently tracked as accuracy-specific open items beyond ordinary future audits.

---

## Speed

### Fixed

- **Per-request batching budget leaving throughput on the table** (beta.33). Measured directly: 300 pieces at ~800 chars/request took 674ms vs 107ms at ~6000 chars/request — per-request overhead dominates. Raised `DEFAULT_MAX_BATCH_CHARS` 800 → 2000 (moderate, not the full measured ceiling), verified end-to-end against real live Wikipedia through the built extension.
- **Google auth key re-scraped on nearly every translate** (beta.33). MV3 service workers suspend after ~30s idle and re-execute module scope on wake, so the 20-minute in-memory auth-key cache rarely survived. Now persisted to `browser.storage.session` and speculatively prefetched at background startup (fire-and-forget, overlaps other startup work).
- **Self-inflicted 150ms pause between every batch** (beta.31). Pure added latency unrelated to real network time. Removed; per-tick batch size raised.
- **Dead, unexplained 150ms startup delay** (beta.33). `originalLanguageTracker.start()`'s unconditional sleep had no comment justifying it and nothing downstream needed it. Removed.
- **Viewport-priority reordering re-measuring every tick** (graceful-degradation pass, beta.14-adjacent). Now only re-measures (`getBoundingClientRect()`, a real reflow cost) when something actually changed (scroll, new content), not on every tick of a long, static page.
- **Translation cache per-piece DB transactions** (beta.16-adjacent). Batched into single transactions per tick instead of one per piece; a persistent IndexedDB connection replacing open/close-per-write plus O(1) incremental size tracking instead of a full eviction scan per write (beta.5).
- **Fixed batching budget lowered as a blast-radius mitigation** (beta.22) — since superseded by the beta.33 measurement above, which found the misalignment theory behind keeping it low didn't hold at the tested scale.

### Checked and ruled out

- **Cross-piece misalignment as a reason to keep batches small** — directly disproven by measurement (see Accuracy's "Checked and ruled out" above). The real constraint is intra-piece reflow, not request bundling.

### Open / deferred

- None currently tracked as speed-specific open items beyond ordinary future audits. A future round could re-measure whether 2000 chars/request has more headroom now that real-page verification exists as a template — but treat any further raise with the same live-page-verification bar, given this constant's incident history (beta.22).

---

## Reliability

### Fixed

- **A node that transiently detaches/reattaches (virtualized/recycled lists) could permanently lose its restore entry** (beta.33). The resweep backstop pruned a node's "restore to original" entry the instant it saw it disconnected — but a node reappearing with unchanged, already-translated content is never re-queued, so it stayed stuck translated forever. Pruning now requires two consecutive disconnected resweep ticks (extracted as `pruneDisconnectedRestoreEntries` in `translateLoop.ts` for deterministic unit testing, since the real resweep-scheduler/MutationObserver timing stack is interval-driven and not something a test can pin to an exact tick count).
- **Offline handling and retry backoff** (graceful-degradation pass, beta.14). Connectivity awareness (skip doomed requests while offline, resume instantly on reconnect), distinct "offline" vs. "provider broken" error states, jittered/extended retry backoff.
- **False-positive "Translation failed" from rapid retries** (beta.31). 3 failures within a fraction of a second (retries of the same stuck batch) used to count as confirmed-broken. Pre-surfacing retries are now genuinely spaced out.
- **`nodesToRestore` unbounded growth** (post-launch audit pass). Every node discovered while translated was added and never removed even after leaving the DOM — a long-lived SPA (infinite scroll, chat) leaked a strong reference to every detached node ever translated. Bounded via disconnected-node pruning (later hardened by the two-tick fix above).
- **`missingResultAttempts` was a lifetime cap, not per-episode** (post-launch audit pass). Never reset after a successful translation, so 3 non-consecutive transient failures over a session silently stopped retries forever. Now reset on success.
- **A totally-broken provider batch fell through silently** (post-launch audit pass, hardened further in beta.33's outputSanityCheck work). `createBatchedHttpProvider` always resolves (converts failed HTTP into `ok:false` per piece) — detecting "every outcome in this batch failed" now catches what used to fall through to a silent per-node give-up with no batch-level signal.
- **IndexedDB connection resilience** (beta.7). The persistent connection could be closed by the browser (common on mobile); now transparently reopens and retries once instead of failing every subsequent translate.
- **Firefox `i18n.detectLanguage` unbounded hang** (beta.20, beta.21). Mozilla bug 1712214 — can simply never resolve or reject. Two unguarded call sites (page-load detector, target-language-already check) now time out after 3s and fall back safely. Chrome was never affected, which is why it went unnoticed until Firefox releases became installable.
- **AMO signing silently broken across multiple releases** (beta.18–beta.21, beta.30). Manifest version collision (WXT strips the `-beta.N` suffix, every build produced identical `"0.3.0"`), then invalid/rotated JWT credentials (beta.28/29 both silently shipped unsigned zips). **Standing verification discipline this established**: always check the Release workflow's actual log text for `Signed xpi downloaded: ...`, never trust the green checkmark alone — the sign step uses `continue-on-error: true`, which can mask a real failure behind a misleadingly-green run.
- **Message sender spoofing** (beta.32, category: security/reliability overlap — see Security below).

### Checked and ruled out

- Nothing specific logged yet in this category — reliability findings so far have all led to real fixes.

### Open / deferred

- None currently tracked.

---

## Security

### Fixed

- **No message-sender validation** (beta.32). `@webext-core/messaging`'s `onMessage` does no sender validation of its own (checked its actual implementation directly). Any other installed extension could send this extension's own message shapes straight to its background/content script and have them processed as if from this extension's own UI — triggering translate/restore, or relaying arbitrary text through `translatePieces` to spend the user's configured provider quota (including a paid key). Every handler in `entrypoints/background.ts` and `entrypoints/content.ts` now rejects unless `sender.id` matches `browser.runtime.id`.

### Checked and ruled out

- Nothing specific logged yet — the beta.32 round found exactly one real issue and it's fixed above. A later round explicitly deprioritized further security work ("security is fine for now") in favor of speed/accuracy — that's a scoping choice for that round, not a finding that nothing else exists. Re-open security as a category on request.

### Open / deferred

- **LLM-provider-specific findings explicitly dropped from the beta.32 round on user request** ("ignore llm"): an untested CORS path and prompt-injection hardening for the LLM provider were surfaced but never investigated further. Worth a dedicated pass if the LLM provider becomes more prominent.

---

## Audit round log

Chronological record of each dedicated audit pass, for context on methodology (not just findings — see each entry's category sections above for the actual fixes).

- **Post-launch audit pass** (beta.15/16) — first dedicated whole-codebase correctness + speed/accuracy/reliability sweep, focused on the free Google provider. 8-angle parallel-subagent review, cross-verified. See `.claude/skills/post-launch-audit-correctness-speed-accuracy-reliability/`.
- **Graceful degradation pass** (beta.14) — connectivity/retry/speed/accuracy under flaky or low connectivity, not full offline support.
- **Speed/dynamic-content/tag-cluster pass** (beta.5) — see `.claude/skills/post-launch-pass-speed-dynamic-content-correctness-tag-cluster-accuracy/`.
- **Security/accuracy audit round 1** (beta.32) — scoped explicitly to existing-functionality improvements only (no new features), external-research-backed. 2 findings: sender validation, Google padding-reflow content loss. A third area (LLM-provider CORS/prompt-injection) was surfaced but dropped from scope on request.
- **Speed/accuracy audit round 2** (beta.33) — deeper pass, explicitly wide-net-then-narrow methodology (parallel probes before deep verification, per direct user correction mid-round), external-research-backed (TWP live source comparison via `gh api`, general web research on DOM-translation techniques), security explicitly out of scope ("fine for now"). 7 items shipped: whitespace restoration (found live during this round's own verification, not in the original plan), batch-size raise, selection-language fix, auth-key persistence, silent-failure detection widening, MathJax/SVG/icon-font skip gap, resweep restore-loss fix, dead-delay removal. See `.changeset/speed-accuracy-audit-round-2.md` and `CHANGELOG.md`'s `0.3.0-beta.33` entry for full detail.

### Methodology notes carried forward

- **Cast a wide net before narrowing.** Run parallel probes/greps covering multiple hypotheses at once, then go deep on what's real — not one hypothesis investigated to conclusion before starting the next. (Direct user correction, round 2: "it looks like you look one at a time and then get stuck at one.")
- **Verify empirically, not by inference.** Live-endpoint `fetch` probes for provider behavior claims, `gh api` against TWP's real source for "what does the reference implementation do" claims — not assumption or memory.
- **Revert-and-confirm-fails on every fix.** Temporarily break the new logic, confirm the new test fails with the expected message, restore, confirm it passes again.
- **Full real-page verification for anything with prior incident history**, not just unit tests — the batch-size constant specifically (beta.22 history) got a real Playwright run against live Wikipedia through the actual built extension, not just synthetic benchmarks. This is what surfaced the whitespace bug that the unit-test-only rounds had missed.
- **Be precise about progress counts.** Don't bundle a bonus fix found along the way into the count of a numbered finding list — report them separately (direct user correction, round 2).
- **Verify AMO signing via actual log text**, not the green checkmark, every release — see Reliability's AMO entry above.
