# Prism Gen 3: history analysis (107 commits, 2026-08-01 to 2026-09-30)

## 1. Timeline and release cadence

| Phase | Dates | Commits | What happened |
|---|---|---|---|
| Planned build | 08-01 | 39014d0..ab971f3 (15) | The whole 10-session plan landed in **one day**, ending in beta.0. |
| Launch incident and UI parity | 08-02 to 08-06 | cbbcc1e..6bafc6f | Default provider was broken and failed silently (beta.1). Bubble, popup and settings were rebuilt to match the old fork (beta.2-4). Two providers were removed (beta.11-12). |
| Site-report whack-a-mole | 08-09 to 08-29 | e5c2240..05dae3d | One live site per fix: bilibili, sangtacviet, pixiv, an old forum, novel543. Firefox was made installable for the first time (beta.18-21). |
| Audit rounds 1-5 | 08-31 to 09-15 | ad3e556..9339a9f | Numbered audits. Round 4 alone shipped 11 betas in two days (beta.41-51, 09-12/13). Round 5 found zod was 51% of the shipped bytes (583b46b). |
| Safari and the Orion hang saga | 09-15 to 09-20 | 553c4cb..f1e74f8 | Three fixes for the Orion "spins forever" hang were shipped without curing it (beta.58-61). |
| Rounds 6-7 and UI audit | 09-21 to 09-30 | 1181541..fed8806 | Engine audits, then the first UI-only pass (beta.69-70). |

- **Pace:** 70 beta versions in 60 days, about 1.2 per day. The busiest days were 7 tags (09-13) and 6 tags (08-16 and 09-15).
- **Missing tags:** beta.20, .59 and .63 were never tagged. beta.20 died in AMO signing (c8c49ef). beta.59 and .63 have CHANGELOG entries but no tag, and no doc explains why.
- **No stable release yet.** The changeset pre-release mode has never been exited.
- **Quiet since 09-30**, which is 32 days before this audit.
- **Authors:** every commit is AI co-authored (88 Sonnet 5, 13 Opus 5, 5 Opus 5.5). Only one PR was ever merged (#1, cae5d05). Everything else was pushed straight to main.

## 2. Recurring failure classes

1. **Silent failure: the UI says "translated" but nothing changed.** This is the project's signature bug, and it came back at least 8 times:
   - cbbcc1e (beta.1): provider errors resolved ok:false and the UI showed false success.
   - ab84ade: the LLM provider returned empty strings.
   - 5cdf62c: the echo check could never match for Google.
   - 68e6a5d: unpadded single strings came back untranslated.
   - 05dae3d: requests sent as `'auto'` were echoed back.
   - 452ff17: the echo detector had no coverage for Tamil and other scripts.
   - 2f4bde1 (beta.42): a partial batch failure reset the error counters.
   - 391d4a4 (beta.45): a stale auth key looked "suspicious", not failed.
   - eb72631 (beta.70): rejection reasons were discarded.
2. **Google reflow inside `<a i=N>` grouped pieces.** The free endpoint moves text between markers in a grouped request. Every fix has been a heuristic around that, not a cure:
   - Tag clusters: 4aa225f, cdbdc52.
   - Grouping disabled: e5c2240 (beta.13).
   - Content loss from the padding slot: 38c006a.
   - Leading punctuation dropped: 422498b.
   - Grouping re-enabled with marker-leak detection: 42d150c.
   - Sparse-array check missed a dropped middle index: 1181541.
   - `<button>` chips: 007b82b.
   - Same-count reflow detection: c38f094.
3. **Source-language handling.** The same sangtacviet "History" → "Association" mistranslation was reported at beta.16 (a2f7050), "fixed" at beta.17 (8c81560), re-fixed at beta.22 (d93af77) and fixed again at beta.68 (947b6f2). sangtacviet is named in 7 commits.
4. **Races and generation guards.** The same `cycleGeneration`-style fix was applied again and again:
   - 5cdf62c, 8c81560, bbaa433.
   - 20245e2: restore raced the cooldown timer.
   - ddbaa4c and 1181541: attributeTranslator was fixed twice.
   - e34227e: overlapping cycles wedged the tick loop.
5. **Unbounded awaits and hangs.** Promises or fetches with no timeout:
   - 6d88ad8: Firefox `detectLanguage`.
   - 52effef: the translatePieces message.
   - cbc1a39: fetch abort on WebKit.
   - 94f253f: the `findAuth` scrape.
   - 4aaabff: unhandled `void sendMessage` rejections.
6. **Release pipeline.** The release could report success while shipping the wrong thing:
   - beta.15: CI scope was wider than the local check (69d000a).
   - Firefox shipped unsigned or broken at beta.18-21, again at beta.28-29 (credentials expired, 9615789), and again at beta.69-70 (approval timeout behind `continue-on-error`, fed8806).
   - beta.70: a local gate piped through `grep` hid vitest's exit code (4aaabff).

**Churn hot spots** (commits per file, ignoring version-bump files):

| File | All commits | Fix commits | Lines |
|---|---|---|---|
| `translateLoop.ts` | 29 | 16 | 1379 |
| `background.ts` | 27 | 9 | — |
| `content.ts` | 24 | 7 | — |
| `batchedHttpProvider.ts` | 16 | — | 816 |
| `collectTextNodes.ts` | 16 | 9 | — |
| `popup/App.tsx` | 16 | — | — |
| `protocol.ts` | 15 | — | — |
| `FloatingBubble.tsx` | 15 | — | — |
| `google.ts` | 12 | — | — |

- **`content.ts` has no unit harness.** It is the third-most-churned file, and 3e83750 states this outright.
- **The ledger is the most-edited non-code file**, at 44 commits.

## 3. Regression chains: fixes that caused new bugs

| Cause | Consequence |
|---|---|
| beta.5: persistent IndexedDB connection (4aa225f) | beta.7: "no in-progress transaction" error on mobile (5a97329) |
| beta.14: connectivity poll timer | beta.15: timer could keep ticking forever (5cdf62c, "regression from last session") |
| beta.17: `languageDetector` / blockLanguageFilter | beta.20: Firefox hang (6d88ad8), then the feature was **deleted** at beta.22 |
| beta.17: respect `lang` attribute | beta.23: pixiv `<html lang=en>` disabled all translation (1136154), feature **deleted** |
| beta.24: `<pre>` toggle shipped with the wrong default | beta.25 (046a745) |
| beta.28: single-item padding | beta.32: words dropped into the padding slot (38c006a) |
| beta.34: incremental write-back | **Inert in production for 9 releases.** The callback could not cross messaging; found at beta.43 (30d5608) |
| beta.35: script-mismatch threshold | beta.36: infinite retry loop against Google (6849669) |
| beta.38: grouping re-enabled | beta.63: sparse-array `needsRepair` miss; beta.66/67: same-count reflow |
| beta.38: attributeTranslator | beta.47 and beta.63: missing guards that translateLoop already had |
| beta.46: shared concurrency gate | Deadlock found before shipping |
| beta.55: always-on viewport reorder | beta.58: churning large queue (cbc1a39) |
| beta.58: `persistent:false` everywhere | beta.59: reverted (6297ff9) |
| beta.66: chip isolation | Exposed the per-page source-language bug, fixed at beta.68 |
| beta.69/70 | CI failures (ac1def2, 4aaabff) |

**Pattern:** speed and "safety net" features keep regressing correctness, and new subsystems get built without the lifecycle discipline the older code already learned.

## 4. Reversed decisions

| Decision | History | Does the reason still hold? |
|---|---|---|
| **Source language sent to the provider** | Persisted override → block filter (beta.17) → always `'auto'` (beta.22) → detected page language (beta.29, because `'auto'` echoed back on a "large, inconsistent fraction", 130→291/293 nodes) → `'auto'` per piece again (beta.68) | **Fragile.** beta.68 re-probed only Chinese text. beta.29's novel543 failure mode was not re-measured end to end, so the regression could come back. |
| **Google grouping** | On (Session 5) → off (beta.13, reflow corruption) → on with repair (beta.38) | The reason still holds. Reflow is mitigated by heuristic detectors (bracket balance, digit runs, empty output, entry count), not eliminated. |
| **Batch budget** | 1100 → 800 (beta.22) → 2000 (beta.33) → charged on content, with a 6000 wire cap (beta.64) | beta.64 says live-page verification is "still owed"; no later commit records it being done. |
| **`<pre>`** | Always skipped (beta.15) → toggle, off (beta.24) → on by default (beta.25) | Settled. |
| **Providers** | Builtin and LibreTranslate added, then removed (beta.11/12) | Still valid: Chrome-only API, rate-limited public instance. |
| **Bubble hover CSS** | Changed (beta.7) → reverted (beta.8, misdiagnosed) | The original Android complaint was **never resolved**. |
| **`background.persistent`** | False everywhere (beta.58) → Safari only (beta.59) | Settled. |
| **Viewport-reorder gate** | >300 → >1 (beta.55) → throttled above 300 (beta.58) | Settled. |
| **zod** | Adopted → removed (beta.52) | Valid: 393KB → 194KB. |

## 5. Process signals

**How bugs were found** (rough classification of commit bodies):
- About 22 fixes came from **real user or live reports**, all from the maintainer's own browsing: sangtacviet, novel543, pixiv, Orion/iOS, Firefox installs.
- About 9 release clusters came from **AI-agent audit rounds**: rounds 1-7, the bloat audit, the UI audit.
- A few were **self-found during live testing**: 391d4a4, 6c2682c, 2f46169 ("demonstrated live, by accident").
- Unit tests rarely caught the shipped bugs:
  - The inert write-back passed unit tests for 9 releases.
  - Safari's regex parsed fine in jsc but failed in the real Safari runtime.
  - The UI audit found two regressions that only showed in a real browser (7535bf9).

**Verification practice:**
- Strengths: "revert-and-confirm-fails" on every fix, a 90% coverage gate, 841 tests, CI guard scripts.
- Weaknesses:
  - The e2e suite is 5-ish checks.
  - There is no automated coverage of the Google endpoint or of real sites.
  - The Firefox, Safari and Orion paths are verified only by hand.
  - The Orion saga shows the cost: three speculative fixes shipped against a symptom that was finally attributed to the environment, since beta.29 and .30 have byte-identical code (e34227e).

**Documentation volume:**
- About 467KB of docs vs about 12.9K source lines:
  - Ledger skill: 164KB.
  - CHANGELOG: 116KB.
  - current-status: 62KB.
- Plus 155KB of commit messages.
- Source and test lines are about 1:1 (10.4K vs 10.4K at 583b46b).
- CLAUDE.md was split into skills because 120KB was too expensive to load (2a124c2). The ledger alone has since grown past that size, yet it tells readers "Read this whole file before starting a new audit."

**Sustainability concerns for one maintainer:**
- Release churn without a stable channel.
- Recurring CI and signing breakage.
- The default provider is an unofficial, scraped Google endpoint whose quirks drive most of the bugs (padding, reflow, `'auto'` echoes, auth-key scraping, a doubled `Content-Type` header the code tolerates but has not probed).
- The LLM provider's security gaps (unvalidated `llmBaseUrl` leaking the key, prompt injection, `pieceCount` ignored) were deferred through rounds 1, 6 and 7.
- The mutation double-traversal was deferred too.
- The history is dense with AI-generated narrative, so judgement is hard to audit independently.

## 6. Stale or contradictory documentation

**`explicitly-out-of-scope-for-v1`** still lists items that have since shipped:
- **"Firefox as a shipped target … Chrome-only"**: Firefox is AMO-signed and shipped since beta.18-19.
- **"Iframe support … main-frame only"**: same-origin frames are supported (8c81560, beta.37); `allFrames: true` is set in `content.ts:64`.
- **"Element-attribute translation … neither built"**: shipped at beta.38 and beta.65.
- **"backup export/import UI"**: shipped at beta.4.
- It also points to "the Known gaps entry above", a dangling reference left from the CLAUDE.md split.

**`known-gaps`** contradicts the code and itself:
- **Shadow-DOM selection "not fixed"**: implemented in 8c81560 (`resolveActiveSelection` in `mountSelectionPopup.ts`).
- **"backup export/import UI … never scoped"**: the same file marks it resolved two bullets earlier.
- It still says "see section above / below", referring to sections that now live in other files.

**`current-status`**: the "authoritative" top block is pinned "As of 0.3.0-beta.64", six releases behind.

**`docs/decisions/README.md`**:
- Omits ADR 0008 (Firefox AMO signing).
- Still describes 0004 as "Builtin ported".

**ADR 0006** lists the permissions as `['storage','contextMenus','activeTab']`, but `wxt.config.ts:55` also has `alarms` (added Session 8).

**Ledger Reliability section:** says "Nothing open … as of beta.45" right next to the long Orion entry.

**Ledger methodology note:** recommends a bare `git stash`, which is unsafe in this repo's shared-stash worktree setup.

**Bubble hover CSS:** the original Android complaint behind the beta.7 change was "still open" after the beta.8 revert (fa803b2). Nothing since records it as closed.
