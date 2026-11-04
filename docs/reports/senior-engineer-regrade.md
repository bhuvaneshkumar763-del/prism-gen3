# Prism re-graded: before and after Releases 2–7

_2026-11-04 · commit `aa0c96b` (branch `claude/serene-carson-h44djm`, 0.3.2-beta.5 not yet versioned or tagged) · compared with the B− audit at `34bcbdb` (0.3.1)_

This review was done by reading the code and running checks. It does not rely on what the reports say. Where a claim couldn't be checked in code, this report says so.

---

## 1. Overall grade: **B** (was B−)

The code itself has really improved, and I checked that myself. The biggest function went from about 1,360 lines to about 640, and its file from 1,481 lines to 722, with the timer, error, progress and write-back logic now in small separate files. Comments went from about 40% of the code to about 20%, and the "diary" comments are gone from the shipped code. Errors are now proper values instead of text that gets re-read, and 1,333 tests pass with 95% coverage. Judged on the code alone it would be a **B+**. Three things hold it at B:

- **How it was built.** About 21,000 lines changed in roughly 36 hours, and six releases were cut, none of them checked on your iPhone.
- **A new risk on your device.** One Release 7 change can break translation on a browser that lacks one storage feature. The code elsewhere already allows for that feature being missing.
- **An old silent failure.** There is still a way for paragraphs to stay untranslated without any message, and neither audit caught it.

Prism has gone from "good foundations, messy habits" to "good code, still built too fast and checked in the wrong place".

---

## 2. Report card

| Area | Before | Now | Why (one line) |
|---|---|---|---|
| Page-translation engine | B− (correctness B, maintainability C) | **B+** | Split into small parts with one owner each, and the reading-path bugs are fixed and tested; still one large function, and an old silent give-up path remains |
| Translation providers | B− | **B** | Structured errors, a real live check, and the auth key is kept in step; the pile of free-Google workarounds is still all there ("won't fix"), and a new auth-key hook can throw into the request path |
| Background, popup, Settings | B− | **B** | The background is thin now, its helpers are tested, Settings is split per tab, and the popup has 3 main controls; `background.ts` and `content.ts` still have no unit tests |
| On-page UI (bubble etc.) | B− | **B (provisional)** | 44px bubble, 16px pickers on touch, select-to-translate listens for touch, and a tap closes the panel; none of it has been seen on an iPhone |
| Platform, CI, release | B− | **B+** | Version numbering fixed, daily Google canary works (I ran it), guard checks are real parsers with test cases, Safari copy checked in CI; the "Checked on" gate is still self-reported |
| Tests | B | **B+** | 1,333 passing, per-folder coverage gates, a realistic Google fake; but most engine tests still use the "uppercase" fake, only 3 saved pages, no saved sangtacviet chapter, and nothing runs on WebKit or Firefox |
| Process | D | **C** | Everything now goes through pull requests and CLAUDE.md has guardrails; but 6 releases in about 2 days, every one checked only in desktop Chromium, and the plan's own "fix only what you hit" rule was set aside to close all 193 audit rows |
| **Overall** | **B−** | **B** | Better code; the process and the missing device check cap it |

---

## 3. What changed

### What actually improved (checked in the code)

- **The four reading bugs are fixed.** Doubled brackets, short Vietnamese echoes, the 300-word chapter cut and the false "N% untranslated" warning each have a fix and a test. The bubble tap now closes an open panel instead of switching the page back.
- **The engine is understandable now.** The timer (`scheduler.ts`), error state (`errorState.ts`), progress (`progress.ts`) and writing text into the page (`writeBack.ts`) are each one small file. The error backoff can no longer be cut short by a busy page. That was a real bug, and the fix is easy to see.
- **Error messages are honest.** Errors carry a type, such as offline, timeout, rate-limited, bad key or changed answer, so the bubble says the real cause instead of always "Couldn't reach the service".
- **Releases are safer.** Stable versions now sort above their betas. A daily job translates one real sentence through free Google. I ran it here and it passed with this release's changed request header. A re-run release fetches the signed Firefox file. The CI guards are real parsers with test cases.
- **Comments.** About 20% of shipped code lines are comments, down from 40%. I found no beta numbers or audit stories left in the shipped code.
- **Settings tell the truth.** "Source language" now says it is for selected text, and the paragraph switch explains its trade-off. Picking Google Cloud without a key opens Settings instead of breaking every page, in both the popup and the bubble.
- **Everything goes through pull requests.** Since the audit, every change reached `main` as one of 5 merged PRs.

### What didn't improve

- **No iPhone check.** All five 0.3.2 betas, and the beta.5 changeset, say "Checked on: … desktop Chromium …". You read in Orion on iPhone, using the Firefox (MV2) build. That build only gets built and size-checked in CI. Nothing ever runs it.
- **The "Checked on" gate is still self-reported.** It now needs a real date and a browser name, but the session that releases still writes the line. "Desktop Chromium" passes the gate.
- **The free-Google workarounds are still piled up.** Padding, grouping, three repair signals, the echo check, streak detection and retry-language switching all remain, marked "won't fix".
- **Most engine tests still use the simple fake.** The realistic Google fake exists, but only 4 tests use it. About 80 page-translator tests still use the "uppercase everything" fake that let the bracket bug through.
- **No saved sangtacviet chapter.** The one page you read most still has no saved-page test. Only a sangtacviet search page is saved.
- **`background.ts` and `content.ts` still have no unit tests.** They are left out of the coverage measurement. The new helper files beside them are covered.

### What got riskier with Release 7

- **Too much changed at once.** Release 7 alone is 98 files, about 4,500 lines added and 1,500 removed, landed in 13 commits. Three of them are named "work in progress … (not yet verified)", and in one the code fix and its test arrived in different commits. Nobody can check from history that each test failed before its fix, which rule 2 of CLAUDE.md requires.
- **The Google auth-key change** (bug 1 below) moved a storage write out of a protected block and into the translation path itself.
- **The wire format to free Google changed.** The `Content-Type` header was corrected from the odd `application/application/json+protobuf`. The live test passes from this machine, but saved-page tests can't catch a header problem, and it hasn't been seen working in Orion.
- **Grouping rules changed on the reading path.** Lists, tables, nav, header, footer and similar elements now split paragraphs. That changes which text is sent together, without a saved sangtacviet chapter to show it's safe.
- **Tool upgrades on the same day.** Major upgrades (Vitest 5, happy-dom 21, Vite 8.3, WXT 0.21.5) landed after the last code commit. "TypeScript 7 for type checking" isn't what actually runs: `npm run compile` still runs TypeScript 5.9, because the two packages both install a `tsc` command and 5.9's wins. TypeScript 7 also passes when run directly, so nothing is broken, but the commit message claims something that isn't true.
- **The Safari copy is stale right now.** No `safari/` re-sync since Release 6, while Release 7 changed code. The CI step "Safari copy is up to date" should fail on this branch until `npm run safari:sync` is run. Expected mid-release, but don't merge before it.

---

## 4. Real bugs found

Listed only where I'm confident of the mechanism. Line numbers are for `aa0c96b`.

### Bug 1 (Release 7, medium if the browser lacks session storage): a missing storage feature can break translation

- **Where:** `entrypoints/background.ts:117-124` (`persistGoogleAuthKey`), called from `src/engine/providers/google.ts:69` and `:179`.
- **Cause:** Release 7 made the background save the Google key to `browser.storage.session` from inside the Google provider, through a listener. The listener calls `browser.storage.session.set/remove` directly. If `storage.session` doesn't exist, that line throws at once, and nothing catches it. The same release's `entrypoints/lib/frameDecisions.ts` explicitly allows for the area being missing ("when the browser has it"). Before Release 7, the only session-storage write sat inside a `try/catch`.
- **What happens on such a browser:**
  - **(a)** The first translation after each key fetch fails, because `findAuth` throws at line 179 after its own try/catch. Retried, so it's a one-batch hiccup.
  - **(b)** When Google rejects the key, the user sees "Google changed how its translation service answers…" instead of the key message. The error is thrown inside `onNonRetryableStatus` (`batchedHttpProvider.ts:313`) and reported as `badResponse`.
  - **(c)** The worst one comes on a run of echoed pieces: `onSuspiciousStreak` → `invalidateAuth` → the listener throws inside `resolveFn` (`batchedHttpProvider.ts:534-538`). `settled` is already true, so that piece's promise **never resolves**. Its in-flight dedupe entry is never removed. The page waits 90 s and retries, and every later request for that same text joins the stuck promise. That text can't be translated again until the background restarts. On a persistent MV2 background, which is how the Firefox/Orion build runs, that means until the browser restarts.
- **Whether it bites you** depends on whether Orion on iOS provides `storage.session`. I can't tell from code. The fix is one `if (!browser.storage.session) return;` and a try/catch around the listener call.

### Bug 2 (old, missed by both audits, medium): a brief throttle leaves paragraphs untranslated with no message

- **Where:** `src/engine/pageTranslator/translateLoop.ts:537` → `noteMissingResult` → `:289-293` (`progress.gaveUp`).
- **Cause:** In a batch where some sub-requests worked and some failed, every failed piece goes down the "missing piece" path. That includes real outages such as HTTP 429, 5xx and network errors, not only echoes. The path allows 3 tries and then gives up for good. A given-up node's text hasn't changed, so the background re-sweep never queues it again.
- **Failure scenario:** A long chapter is sent as several requests at once, and Google rate-limits one of them for a few seconds. That request's paragraphs are retried 3 times about a second apart, then abandoned. If Google answers the next batch normally, the error clears. The "N% untranslated" warning shows only when the abandoned text is at least 25% of the page and at least 200 characters. So a few missing paragraphs in a long chapter produce no message at all. This is the "looks untranslated but the bubble doesn't say so" problem your plan tells you to watch for. While it is happening, the bubble even says "Prism will retry automatically", which isn't true for those paragraphs.

### Bug 3 (old, low-medium): the bubble's "From" picker shows a choice that isn't in effect, and can't be re-picked

- **Where:** `components/bubble/FloatingBubble.tsx:100` (picker seeded from the saved per-site value), `:635` (the header uses that value), `:718` (`on:change`). Page loads translate with the detected language (`entrypoints/content.ts:79-83`) and never use the saved value.
- **Failure scenario:** You once picked From: Vietnamese on sangtacviet. On the next chapter the page is auto-detected, but the picker shows "Vietnamese" and the header reads "Vietnamese → English". If detection got it wrong, choosing "Vietnamese" does nothing, because it's already selected and a select doesn't fire `change` for the same value. You have to pick another language first, which runs one wrong translation, then pick Vietnamese again. The picker's own tooltip says "A fresh page load goes back to Auto", which the picker itself contradicts.

### Not a product bug, but untrue: "TypeScript 7 for type checking"

- **Where:** `package.json` lists `typescript@^7.0.2` and `typescript-api: npm:typescript@5.9.3`.
- **What happens:** `node_modules/.bin/tsc` points at `typescript-api` (5.9.3), so `npm run compile` in CI runs 5.9. Checked: `npx tsc --version` prints 5.9.3, while `node node_modules/typescript/bin/tsc --version` prints 7.0.2.

---

## 5. The top 3 things that would move the grade up, in order

1. **Check it on the iPhone before anything else ships, and make the gate say so.** Install the beta.5 build in Orion and read a sangtacviet chapter in Vietnamese mode and in English mode. Also read a chapter ending in `（…）`, tap the bubble with its panel open, and select some text. Then make the "Checked on" line for a stable release name the iPhone, not desktop Chromium. This is the one thing code can't prove, and the one thing every release so far has skipped. While you're on the device, save that chapter's HTML so it can become the missing sangtacviet replay case (PL-44).
2. **Fix bugs 1 and 2 in one small batch, each with a failing test first.**
   - For bug 1, guard the storage call and stop a throwing listener from ever skipping `resolve`.
   - For bug 2, retry real outage failures in a mixed batch like a fully failed batch, rather than spending the 3-try echo allowance on them.
   Both are a few lines. No refactor.
3. **Slow down.** One release, then the two quiet reading weeks the plan already describes. The code is now in good enough shape that more churn costs more than it buys. Each of the last 6 releases was checked in the wrong place. Closing every audit row in two days is how bug 1 got in.

---

## 6. What can't be judged from code alone

Everything about how Prism behaves on your iPhone is reasoned here, not seen:

- whether Orion has `storage.session` (bug 1);
- whether the 16px pickers really stop iOS zooming;
- whether a long press on the bubble opens iOS's own callout;
- whether select-to-translate's 400 ms "settled" wait feels right with iOS selection handles;
- whether the bubble fades and comes back properly while you scroll;
- whether free Google accepts the corrected request header from Orion's network stack.

The automated tests run only in desktop Chromium (Playwright can't load extensions in WebKit). The Firefox build that Orion uses is built but never run by any test. Until someone reads a real chapter on the phone, the On-page UI grade stays provisional, and so does the claim that the reading bugs are fixed where it matters.

---

## Technical details (for an engineer)

**Commands run (all read-only):**

| Command | Result |
|---|---|
| `npx vitest run` | 91 files, 1,333 tests, all pass |
| `npx vitest run --coverage` (output in scratchpad) | 95.35% statements, 90.39% branches, 95.73% functions, 97.2% lines |
| `npx tsc --noEmit` | Passes, on TypeScript 5.9.3 |
| `node node_modules/typescript/bin/tsc --noEmit` | Passes, on TypeScript 7.0.2 |
| `npx biome check .` | 2 warnings, 0 errors |
| Engine-purity and Solid-reactivity guards | Both pass |
| `vitest run --config vitest.live.config.ts` | Passes: real free-Google call with the new `Content-Type` |

I did not run the e2e or replay suites, as instructed.

**Size:**
- `translateLoop.ts`: 1,481 → 722 lines.
- `createPageTranslator`: about 640 lines with 14 top-level `let`s.
- Shipped code in `src/`, `entrypoints/` and `components/`: 12,378 lines, of which about 2,490 (20%) are comment lines.
- Since the audit: 37 non-merge commits, 5 merges, and about 13.3k lines added and 7.8k removed across code, tests, scripts and CI.

**Verified fixes, by area:**

*Page-translation engine*
- `takeBatch` takes a whole word-per-element block, up to 5,000 nodes, into one tick (PT-4).
- `writeBack.createSlotWriter` counts every word of a run (PT-5). It keeps the run's whole text for hover (`recordRun`, PT-9) and requeues on in-flight change through `sentText`.
- The catch path requeues only nodes not yet written (the `written` set, PT-8).
- `scheduler.ts`: the backoff is a floor that `schedule()` can't undercut (PT-6).
- `progress.track` grows the total as nodes arrive (PT-7).
- `restoreMap.ts` parks disconnected nodes behind a `WeakRef`, so Show original restores recycled nodes.

*Providers*
- `batchedHttpProvider` treats a count mismatch as all missing (R1-5).
- It classifies errors into `TranslateError` kinds through `RequestFailure`.
- `parseResponse` validates the response shape and returns `badResponse` when it doesn't match.

*Release*
- `manifestVersionFor`: `X.Y.Z` becomes `X.Y.Z.9999`, `X.Y.Z-beta.N` becomes `X.Y.Z.N`, and versions up to 0.3.1 keep their plain form.
- `release.yml` uses `persist-credentials: false` and has the signed-XPI fallback.

**Remaining design concerns (not bugs):**
- `google.ts` imports `describeTranslateError` from `pageTranslator/errorState`, so the provider layer depends on the page layer.
- The engine-purity guard misses `globalThis.chrome` and `globalThis['browser']`, because a property access isn't treated as a reference.
- Once the page is translated, the engine keeps a 2 s idle tick and a full-body re-sweep every 1.5–10 s, forever (PT-31, won't fix). This matters for battery on a phone.
- PL-8: a missed echo, once cached, stays for up to 30 days.
- The realistic fake (`src/engine/testing/googleFake.ts`) re-implements the provider's sanity-check and repair logic instead of driving the real `google.ts` over a mocked `fetch`, so the two can drift apart.
- `tests/e2e/run.mjs` still carries diary comments ("round-4 audit, item 9", "Session 9").

**State of the tracking claims:** `docs/reports/audit-tracking.md` says 0 rows open. That is a statement about the listed rows, not about the code. Bugs 1–3 above are not in it.

---

## Afterword: what happened to the bugs above (added before the beta.5 release)

All three bugs and the untrue claim were fixed before 0.3.2-beta.5, each with a test seen failing first:

| Finding | Fix | Commit |
|---|---|---|
| Bug 1: a missing `storage.session` breaks translation | The Google provider calls its key listener inside a try/catch, and the background skips the save when the browser has no `storage.session` | `2f38fc0` |
| Bug 2: a brief throttle silently abandons paragraphs | A piece that failed for a real reason (rate limit, server, network) in a mixed batch goes back in the queue under the backoff instead of using its 3 echo tries | `af8e6a6` |
| Bug 3: the From picker shows a pick that isn't in effect | The picker starts at Auto on each page load, which is what the page uses; an earlier pick can be chosen again. The pick is still listed in Settings | `207f847` |
| "TypeScript 7 for type checking" wasn't true | `npm run compile` now runs TypeScript 7 by path, since `.bin/tsc` pointed at the 5.9 parser alias. A deliberate type error was caught | `2f38fc0` |

The grade above was given before these fixes and is left as written.
