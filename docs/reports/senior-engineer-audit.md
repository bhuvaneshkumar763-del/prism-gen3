# Prism through an outside senior engineer's eyes

_2026-11-03 · Prism 0.3.1 (commit 34bcbdb) · written for the owner_

You asked for this: an audit by an outside senior software engineer of the code line by line, plus the techniques, the UI, the methods and the history, as a report first. Your own plan ([fix-plan.md](fix-plan.md), rule 5) says "no AI audit rounds", so read this as a reference. **Nothing here gets fixed until you decide.** Section 8 says what the council thinks you should decide.

---

## 1. The bottom line

**Prism is a B−.** All five reviewers, working on separate parts of the code, gave that same grade on their own. In plain words:

- **The foundations are good.** Most hobby projects don't have this architecture, this many tests, or this level of care. Nobody recommended a rewrite.
- **What drags it to a B− is how it was built, not what was built.** Each incident added one more patch and a long story-comment, never a simpler design. The code now reads like an incident diary.
- **There are real bugs on your reading path.** Four of them were checked by hand in this audit (section 4). None of them stops you reading. They make reading slightly worse in ways you may not have noticed yet.
- **Two release problems will bite later.** They can't be found by reading, so the "fix only what you hit" rule won't catch them (section 6).

---

## 2. How this was done

1. **Five reviewers each read every source line in one part of the code.** Each played an outside senior engineer with 15+ years' experience. Each part was compared with the earlier audit (at beta.70), so every finding is marked new, still present, or fixed.

   | Part | Lines |
   |---|---|
   | Page-translation engine | ~3,500 |
   | Translation providers and core | ~2,400 |
   | Background, page script, popup and Settings | ~3,200 |
   | On-page UI (bubble, tooltip, selection popup) | ~2,100 |
   | Platform, config, cache, CI, release and test harnesses | ~4,600 |

2. **History came from git:** 141 commits and 74 releases.
3. **Hand verification.** I checked the six most important new claims against the code myself. One of them I proved by running the real function. All six held up.
4. **Council.** Five advisors, all playing senior engineers but each with a different angle, judged the evidence. Five reviewers then rated their answers anonymously, and I wrote the verdict as chairman.

Everything ran as Claude in different roles, not as different AI models. Nobody tested on a real iPhone, so everything about iOS behaviour is reasoned, not observed.

Full reviewer notes: [senior-audit-2026-11-03/](senior-audit-2026-11-03/).

---

## 3. Report card

| Area | Grade | One line |
|---|---|---|
| Page-translation engine | B− (correctness B, maintainability C) | Sound race handling, but one 1,360-line function, and 57% of its biggest file is comments |
| Translation providers | B− | Hard problems solved well; the free-Google path is now a stack of patches |
| Background, popup, Settings | B− | Careful and defensive; the UI grew toward the old fork's feature list, not toward what you use |
| On-page UI (bubble etc.) | B− | Built for a mouse, with touch support bolted on later; your iPhone is where the rough edges are |
| Platform, CI, release | B− | Core is solid; release engineering is the weakest part |
| **Tests** (chairman's grade) | B | 890 tests that pass, each named after a real bug. The replay harness is "the best engineering in the repo". The test fakes don't behave like the real Google, which is how a recent fix caused a new bug |
| **Process** (chairman's grade) | D | 74 releases in 3 months, 104 of 126 commits straight to `main`, 40% of the code is comments |

---

## 4. Bugs on your reading path

"Verified" means I checked it in the code myself or ran it. The others were read in the code by a reviewer, but nobody has seen them happen on a real page yet.

| # | What you'd see | Where | Verified |
|---|---|---|---|
| 1 | **Doubled brackets at the end of Chinese chapters.** `（本章完）` becomes `（(End of this chapter)`; `【第一章】` becomes `【[Chapter 1]`. Caused by beta.71's punctuation fix. | `src/engine/pageTranslator/boundaryText.ts:6` | **Ran the real function** |
| 2 | **Short Vietnamese lines left unchanged but counted as "translated".** A rule that treats any unchanged line of 40 characters or less as fine runs before the check that would catch it. This is the "says translated but nothing changed" problem that keeps coming back. | `src/engine/providers/outputSanityCheck.ts:237` | **Checked the order** |
| 3 | **sangtacviet chapters get cut into chunks of 300 words.** About 4 sentences per chapter are translated in two halves, and a chapter takes about 5 round trips in a row. | `translateLoop.ts:54, 701–722` | Read in code |
| 4 | **False "About N% of this page came back untranslated" warnings on sangtacviet.** Translated words are undercounted about 10×. | `translateLoop.ts:834, 877` | Read in code |
| 5 | **Tapping the bubble while its panel is open switches the page back to the original**, and the panel stays open. Closing it takes a tap on the page, which on reader sites turns the page. | `components/bubble/FloatingBubble.tsx:278–301` | **Checked the code** |
| 6 | **iOS probably zooms the page when you tap a picker in the bubble.** The text is 12.5px, and iOS zooms in on anything under 16px. After that, the zoom pushes the bubble off screen. | `components/bubble/bubbleStyles.ts:157` | Reasoned |
| 7 | **Select-text-to-translate does nothing on the iPhone.** It only listens for mouse and keyboard. | `components/selection/mountSelectionPopup.ts:419` | Reasoned |
| 8 | **Errors often say "Couldn't reach the translation service" even when the real cause was different.** For example, Google changed its response or rate-limited you. | `batchedHttpProvider.ts:678`, `translateLoop.ts:1178` | Read in code |

### Settings that mislead you

- **Settings → General → "Source language" doesn't affect page translation at all.** Only the select-text popup reads it (`entrypoints/content.ts:261`). Checked in the code.
- **The "Translate each paragraph as a whole" switch is risky to follow.** Its label tells you to turn it off when words come out jumbled. But turning it off also disables beta.73's sangtacviet fix (`entrypoints/options/App.tsx:535`).
- **Picking "Google Cloud" in the popup before you have a key breaks every page.** It saves the choice before Settings even opens. This matters for step 3 of your plan, testing the backup, so have the key ready first (`entrypoints/popup/App.tsx:232`).

---

## 5. The UI, as a reviewer sees it

- **The popup has about 16 controls; you use about 3.** The language pills reorder themselves under your finger, and the main button never says which language it will translate into.
- **Matching controls look different.** "Always translate this site" is a checkbox, but "Never translate this site" is a menu button. "More settings" and "More options…" sit next to each other.
- **Error messages are internal text.** For example: "timed out after 5000ms", "[googleCloudTranslate] not configured…".
- **Small on a phone.**
  - The bubble is 40px, under Apple's 44pt minimum, and covers the last word of lines on a 375px screen.
  - The × buttons are about 23px.
  - Popup text is 11–12.5px.
  - White text on the green bubble is 3.3:1 contrast; the minimum for easy reading is 4.5:1.
- **"Hide" on the bubble is permanent for that site, with no undo.** It sits right next to "Always".
- **The basics are right:** labels, screen-reader roles, keyboard access, and settings that undo themselves if a save fails.

---

## 6. Release and tooling risks

These won't show while you read, which is why "fix only what you hit" can't catch them:

1. **The version numbering will break the next stable release, the same way 0.3.0 broke.** Betas are numbered `X.Y.Z.N`, and a stable release is plain `X.Y.Z`, which browsers treat as *older*. 0.3.1 only dodged this by luck (`wxt.config.ts:15–16`, checked in the code).
2. **Nothing warns you early if Google changes its free endpoint**, and that's the single biggest risk to the whole project. The end-to-end test calls live Google but never checks that anything was translated.
3. **Re-running a failed release ships an unsigned Firefox build.** That happened on 0.3.1 and was fixed by hand.
4. **The Safari/Xcode copy in the repo is stale** (still beta.70, still contains the removed AI provider). Nothing builds or checks it. Orion on your iPhone uses the Chrome/Firefox build, so this doesn't affect you today.
5. **Both "guard" checks in CI pass broken code.** A reviewer proved it with test files.
6. **The "Checked on" release gate is a speed bump, not a check.** The same session that releases also writes the line.
7. **The files that change most have no tests at all.** `background.ts` and `content.ts` (the background worker and the page script) are left out of the coverage measurement entirely.

---

## 7. Techniques, methods and history: what a senior engineer notices

**What they'd praise:**
- The translation engine has no browser code in it, CI enforces that, and it talks to providers through one small interface.
- Race conditions are handled with "generation" checks; nothing hangs forever because everything has a timeout.
- The cache is best-effort: it never breaks translation when it fails.
- Pages are re-checked in a gentle loop that backs off; one piece of the reflow repair (`reflowIntegrity.ts`) was singled out as the best file in its slice.
- The replay test harness: saved real pages, played back with Google's recorded answers.

**What they'd change. Each is a habit that came from directing AI sessions, not a lack of talent:**

| Habit | Evidence | Why it hurts |
|---|---|---|
| **Comments as a diary** | 40% of source lines are comments; 175 tell stories about betas and audit rounds; several are now wrong | The real logic gets buried, and wrong comments mislead the next AI session |
| **Huge units of code** | One function is about 1,360 lines with about 25 changing variables; the Settings page is one 720-line component | Nobody, human or AI, can hold it in their head, so fixes land in the wrong place |
| **Copied rules** | A fix lands in one copy and misses the others. For example, the title and attribute translators lack the guards the main loop has, and the cache missed a fix made in the config store | The same bug comes back in a new place |
| **Errors passed around as text** | Error messages are re-read with text-matching in three places | Wrong error messages (bug 8) |
| **Patch on patch** | Free Google has padding, grouping, three repair signals, a sanity check, streak detection and retry language switching | Each makes sense alone; together nobody can predict them |
| **Test fakes too simple** | The fake translator just uppercases text, so it never behaves like Google | Bug 1 slipped through 13 passing tests |

**History in numbers:**
- 141 commits from 1 Aug to 2 Nov 2026, with nothing in October.
- 74 releases, at most 7 in one day.
- 104 of the 126 non-merge commits went straight to `main`. Pull requests only became normal on 1 Nov.
- 49 commits are fixes, and 3 are reverts.
- The median commit changes 214 lines; the largest changed 12,463.
- The files that changed most are also the ones with the most bugs: `translateLoop.ts` (32 commits), `background.ts` (29) and `content.ts` (25, no tests).

A team working this way would be in a crisis. For one person directing AI, it's the predictable result of never pausing between fixes.

---

## 8. The council's verdict

### Where the council agrees
- **Don't rewrite or tidy up.** All five advisors agreed: no splitting the big function, no comment clean-up, and no working through the old audit's ~77 remaining items. A rewrite done by AI without a plan is how you got 74 releases.
- **Fix the version numbering before you ever tag a stable release again.** All five said so. It's small, and it's verified.
- **Make the end-to-end test actually check a translation.** One sentence in, check the text changed. That's your early warning for Google changing its endpoint. All five said so.
- **A short list of bugs is worth fixing in one batch:** the doubled brackets, the short-echo order, the 300-word cut, and the bubble tap. Every advisor named at least three of these four.
- **No more AI audits after this one.** One of the last audit's fixes caused the bracket bug. Fixing isn't free.

### Where the council clashes
- **Is your rule "fix only what you hit" enough?** The Executor, the First Principles Thinker and the Outsider said yes. The Contrarian said no: the version numbering and the Google early warning can't be "hit" until they've already hurt you. **All five reviewers sided with the Contrarian**, and so do I. Keep the rule for bugs, and add an exception for problems that are known but haven't happened yet.
- **Should Prism grow?** The Expansionist saw a rare iPhone-friendly translator and wanted replay tests of real sangtacviet chapters. The reviewers called that answer the most flattering one and the weakest on iPhone problems. But they kept its one good idea: **every fixed chapter becomes a saved-page test**, so the fix can't silently break again.
- **Do the misleading settings matter?** The Executor and the Outsider would fix or hide "Source language", and the Executor would also raise the picker font to 16px. The others left them out. These are text and style changes of a few minutes each, so they can ride along in the same batch.
- **iPhone select-to-translate:** the Executor said don't build it because you don't use it. Only you know whether you would.

### Blind spots the review caught
- **You can't read the code, so how do you check an AI's fix?** Nobody answered this. The answer is a short checklist of real chapters you read after each release, plus a saved-page test for each fix that the session must show failing before the fix and passing after.
- **Rolling back.** Every release, with its files, stays on the GitHub Releases page. If an update breaks tomorrow's chapter, reinstall the last good one from there. Know where that is before you need it.
- **The day Google breaks.** Your backup is the Google Cloud key, and the "pick Cloud without a key" trap is exactly what would bite that day. Keep the key handy, and test the switch once.
- **Guardrails for future AI sessions:** no new story-comments, a saved-page test with every fix, everything through a pull request, and one release per batch. Put these in `CLAUDE.md`, the file every session reads first, so they don't depend on memory.
- **Stopping is part of the plan.** The empty October suggests the pace was tiring. A batch with a clear end, followed by a month of just reading, is a deliverable in itself.

### The recommendation

**One calm batch, then stop.**

1. **First, look for yourself** (rule 1 of your plan). On your iPhone, read a chapter whose last line has `（…）` or `【…】`, and a long Vietnamese-mode chapter. Note what you actually see.
2. **Then one release** with:
   - **Bugs:** the bugs you saw, from the four on the list (brackets, short echoes, the 300-word cut with its false warning, the bubble tap), each with a saved-page or regression test.
   - **Known risks that haven't hit yet:** the version-numbering fix and the real end-to-end check, which the reviewers moved into this batch.
   - **Small text and style changes:** the 16px picker font, the "Source language" and paragraph-switch wording, and the Google Cloud no-key trap.
3. **Add the session guardrails to `CLAUDE.md`.**
4. **Check the release on your iPhone, release once, then read for a month.**

Leave out: rewrites, comment clean-ups, the popup redesign, Safari CI, the other audit findings, and new features.

### The one thing to do first

**Open a Chinese chapter on your iPhone and look at its last line.** If you see `（(` or `【[`, you've confirmed the bug yourself. That's the go-ahead your plan needs to start the batch.

---

## Appendix

- Reviewer notes, by part: [page-translation engine](senior-audit-2026-11-03/slice-pageTranslator.md) · [providers](senior-audit-2026-11-03/slice-providers.md) · [background, page script, popup, Settings and on-page UI](senior-audit-2026-11-03/slice-entrypoints-components.md) · [platform, CI and release](senior-audit-2026-11-03/slice-platform-ci.md)
- The earlier audit (beta.70): [prism-self-audit.md](prism-self-audit.md)
- The plan: [fix-plan.md](fix-plan.md)
