# Prism self-audit: line by line, plus project history

_2026-11-01 · Prism 0.3.0-beta.70 (commit fed8806)_

**Status: analysis and plan only. No code was changed.** Companion to [prism-vs-immersive-translate.md](prism-vs-immersive-translate.md) and [prism-vs-twp.md](prism-vs-twp.md).

## How this was done

- **Line-by-line read**: five readers each read every non-test source line in one slice, about 12.9k lines in total:
  - `src/engine/pageTranslator/`
  - `src/engine/providers/` and the engine core
  - `entrypoints/`
  - `components/`
  - `src/platform/`, `src/shared/`, `scripts/` and the CI workflows
- **History read**: one reader went through all 107 commit messages, 70 tags, the incident docs and the ADRs.
- **Raw findings**: about 90 in total, each with a `file:line` citation, severity and confidence, in [self-audit-findings/](self-audit-findings/).
- **Council**: five advisors (Contrarian, First Principles Thinker, Expansionist, Outsider, Executor) debated the findings, five reviewers critiqued them anonymously, and a chairman summarized.
- **Hand verification**: 13 load-bearing claims were then checked against the code by hand. The "Verified" column below shows the results. Everything else in `self-audit-findings/` was traced by reading code only and has not been run.

## State of the extension

The engine works on the sites the maintainer reads, and it fails where nobody looks:
- Spanish, French, Japanese and Chinese opening punctuation gets corrupted.
- The floating bubble fights touch users.
- Both non-default providers break in common setups.
- Site-list toggles can get stuck.

Each defect is small. **The process creates them faster than it removes them**, because each fix covers one instance rather than the whole class, and nothing checks against real pages.

## History in brief (details: [self-audit-findings/history.md](self-audit-findings/history.md))

- **Timeline**: the 10-session plan landed on 2026-08-01. After that came **70 betas in 60 days**, with a peak of 7 tags in one day and 11 betas in two days during audit round 4. There has been no stable release, and no commits since 2026-09-30. All commits are AI co-authored, and only one PR was ever merged.
- **Recurring failure classes**:
  - "says translated but nothing changed" (silent failure): at least 8 times
  - Google reflow: patched 8 times, never cured
  - source language `'auto'` → detected (beta.29) → `'auto'` again (beta.68), with the same sangtacviet mistranslation fixed 3–4 times
  - races and generation guards, awaits with no timeout, release/signing breakage
- **Churn hot spots**:

  | File | Commits |
  |---|---|
  | `translateLoop.ts` | 29 (16 of them fixes) |
  | `background.ts` | 27 |
  | `content.ts` | 24 (no unit tests) |

  Then `batchedHttpProvider.ts`, `collectTextNodes.ts` and `google.ts`.
- **Regression chains**: at least 15. Speed changes and "safety nets" are the most common source of new bugs. For example, incremental write-back did nothing for 9 releases, and beta.35 caused an infinite retry loop.
- **How bugs were found**: about 9 release clusters came from AI audit rounds, but almost every bug that actually shipped was caught by the maintainer's own live browsing, not by tests or audits.
- **Docs vs code**: about 467 KB of docs against 12.9k source lines, including a 164 KB ledger. Several docs contradict the code:
  - The out-of-scope list still names Firefox, iframes, attribute translation and the backup UI as missing, but all have shipped.
  - known-gaps lists shadow-DOM selection as unfixed, but it is fixed.
  - current-status is pinned "as of beta.64".
  - The Settings page claims always-translate beats never-translate, but the code does the opposite.

## Top defects, ranked by who they hit and how often

| # | Defect | Where | Who / how often | Size | Verified |
|---|---|---|---|---|---|
| 1 | **Punctuation restore strips or forces `¿ « 「`.** Any node with leading punctuation or trailing whitespace has its translation's leading non-letter run replaced by the source's. `"Are you sure? "` becomes `"Estás seguro? "`, and `"¿Qué pasa? "` becomes `"¿What's up? "`. | `src/engine/pageTranslator/translateLoop.ts:739-741, 785-787` | Every es/fr/ja/zh-style sentence that sits next to a link or inline tag | S* | yes |
| 2 | **Long-press also toggles translation**: the timer opens the panel, then release still calls `toggleTranslate()`. Right-click also toggles. | `components/bubble/FloatingBubble.tsx:254-292` | Every touch user who opens the panel | S | yes |
| 3 | **Google key fetched regardless of provider** | `entrypoints/background.ts:306` | Every LLM or Cloud user, on every service-worker start (privacy) | S | yes |
| 4 | **`www.` site-list mismatch**: membership strips `www.`, add/remove don't, so a toggle shows ON but can't be removed, and a site can end up on both lists. The Settings text also claims "always wins" when never wins. | `src/shared/config/listMutations.ts:28-30, 96-118`; `entrypoints/options/App.tsx:531` | Sites with `www.` and a list entry | S | yes |
| 5 | **LLM response length unchecked**: a short array shifts translations into the wrong nodes | `src/engine/providers/llm.ts:92-111` | LLM users, whenever the model returns fewer items | S | yes |
| 6 | **`temperature: 0` always sent** | `src/engine/providers/llm.ts:85` | Users of OpenAI reasoning models, on every request | S | code yes; the 400 is documented API behavior, not tested |
| 7 | **Cache key omits the LLM model and base URL** | `entrypoints/background.ts:358`, `src/platform/cache/translationCache.ts:379` | LLM users who switch model or endpoint | S | yes (earlier report) |
| 8 | **Raw language comparison in the echo check**: `zh-CN`/`iw` vs `zh`/`he` triggers a false "suspicious" result, which starts the silent-failure chain (streak → auth invalidated → retried as network error) | `src/engine/providers/outputSanityCheck.ts:242` | Pages already partly in the target language | S | yes |
| 9 | **Key-scrape regex `(\w{39})` can't match `-`** | `src/engine/providers/google.ts:189` | All default users, once Google rotates to a key containing `-` | S | yes |
| 10 | **ReDoS in `PURE_TAGS_RE`**: 80 chars took 1.3 s, and the time roughly quadruples for every two more tags | `src/engine/pageTranslator/tagText.ts:36-37` (called from `grouping.ts:241,244`) | Rare organically; can be planted on any page | S | yes, measured |
| 11 | **Manual translate skips same-origin iframes** (only restore reaches them) | `entrypoints/content.ts:419-425` | Pages with embedded comments or doc viewers | M | yes |
| 12 | **No Google Cloud segment cap** (Google documents a 128-segment limit); the key also goes in the URL query | `src/engine/providers/googleCloudTranslate.ts:41-52` | Cloud users on pages with many short text nodes | S | code yes; the limit is from docs, not tested |
| 13 | **Release workflow keeps a write token in `.git/config` while `npm ci` runs install scripts** | `.github/workflows/release.yml` | Supply chain | S | yes |

\* Fix carefully: the strip was added because Google sometimes echoes the source's leading punctuation, which would then appear twice. Restoring only whitespace avoids the corruption, but it needs a regression test for both cases: lost `¿`, and doubled punctuation.

Also worth fixing soon (from `self-audit-findings/`, read but not verified by hand):
- `attributeTranslator.ts`: four bugs, including stale restore, no staleness check, an unhandled rejection, and the wrong skip check.
- `titleTranslator.ts`: no generation guard, so late responses set a stale title.
- Every mutation cancels the error backoff (`translateLoop.ts:425, 1104, 1168`).
- `google.ts:511-516`: repair drops the explicit source language.
- Firefox context menus vanish after a browser restart (`background.ts:487-501`).
- Keystrokes leak from the bubble to the page (`FloatingBubble.tsx:326-360`).
- The selection trigger doesn't follow scroll (`mountSelectionPopup.ts:351-362`).
- The cache budget falls out of sync after Clear cache (`translationCache.ts:122, 370`).
- Both CI guard scripts pass broken fixtures.
- LLM security, deferred for three rounds: base URL not validated or redacted, and prompt injection.
- Bubble text contrast is below WCAG AA (3.30:1 on green).

## The underlying patterns, and the fix for each

1. **Each fix covers one instance, not the class.** The Contrarian's six sibling pairs show this:

   | Invariant | Fixed in | Missing in |
   |---|---|---|
   | `sentText` staleness check | translateLoop | attributeTranslator |
   | Generation guard | attributeTranslator | titleTranslator |
   | apex hostname matching | membership checks | add/remove |
   | base language-tag equality | autoTranslateDecision | popup and outputSanityCheck |
   | response-count check | Google | LLM |
   | `.catch` on fire-and-forget | `openSettings` | `applyListPatch` |

   **Fix**: one shared helper per invariant, then delete the copies. Where the helper is tiny (language-tag equality, apex hostname, response-count validation), the fix for the instance *is* the helper.
2. **Verification runs against an imagined Google.** 841 tests and a 90% coverage gate missed every shipped Google quirk, and coverage excludes `entrypoints/` and `components/`, the files with the most churn (`vitest.config.ts:27`). **Fix**: turn the ~22 live site reports into a replay corpus (saved HTML plus recorded provider responses, run in CI), extend coverage to the UI and entrypoints, and require one real-browser smoke test before any tag.
3. **An ungated AI loop.** Every commit goes straight to main. Telling the same loop to "stop audit rounds" won't hold. **Fix**: branch protection, merge through PRs only, the required smoke test, and release weekly at most.
4. **Grouping's cost was never measured.** Grouping drives both the reflow chain and the ReDoS path, and it was already disabled once (beta.13). **Fix**: add a kill switch now, then compare grouped and ungrouped on 10 real pages before deciding whether to keep it.

## Where the council disagreed

- **Fix the instance or the class?** The Executor wanted one evening of one-line fixes. The Contrarian wanted shared helpers. **Do both**: ship the instances now, and build the larger guard consolidation after stable.
- **Is the ReDoS the headline?** It is real and trivial to fix, but rare outside deliberate planting. It ranks below the punctuation bug, which every Spanish reader sees.
- **Growth or freeze?** The Expansionist proposed glossary, chapter memory and pinyin features aimed at web-novel readers. All five reviewers rejected it: it adds scope on an unstable beta and builds on the least-hardened provider. Rejected for now.
- **Do real users exist?** All ~22 live reports came from the maintainer's own browsing. The Chrome Web Store and Mozilla add-ons dashboards already show installs and uninstalls, so check them first.
- **Ship stable?** Yes, as a way to end the churn, not as a growth push. A public stable listing built on a scraped Google key carries takedown risk.

## Plan

**Week 1: one beta (beta.71)**
- Fix rows 1–10, 12 and 13, each with a regression test.
- Check the store dashboards.

**Week 2: gates, then stable**
- Branch protection and PR-only merges.
- A required real-browser smoke test.
- Extend coverage to `entrypoints/` and `components/`.
- Fix the iframe gap (row 11).
- Tag **0.3.0 stable**.

**Weeks 3–6: fix by class**
- The shared helpers.
- The replay corpus.
- The grouping measurement.
- LLM hardening (validate and redact the base URL, handle `<think>` output, prompt injection).
- The silent-failure chain (language-tag mismatch, `throw undefined` at `batchedHttpProvider.ts:526`, backoff cancelled by mutations).

**Afterwards**
- Archive the narrative docs: git already holds the history, and the stale claims steer future sessions wrong. Fix or delete the out-of-scope and known-gaps lists.
- Add a visible "this page translated badly" link.
- Let user reports set priorities.

## Stop list

- Numbered AI audit rounds (this council included) until the high-severity items are closed.
- One fix per beta, and same-day beta bursts.
- Growing the 164 KB ledger, and changelog-style narrative comments in code.
- New features (glossary, pinyin, learner mode) before stable.
- Hand-tuning Google reflow heuristics.
- Pushing to main without a real-page check.
- Reading silence as safety.

## The one thing to do first

Fix the punctuation restore in `translateLoop.ts:739-741, 785-787`. Put the source's *whitespace* back, but don't replace the translation's punctuation with the source's. Add regression tests for `"Are you sure? "` → `"¿Estás seguro? "` keeping its `¿`, and for Google's doubled-punctuation case. It's the most frequently hit verified bug, and it's invisible to an English-reading maintainer.
