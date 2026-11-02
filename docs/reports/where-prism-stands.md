# Where Prism stands, in plain words

_2026-11-02 · Prism 0.3.0-beta.73 (commit f810b83) · written for the owner, not for AI sessions_

You asked for a deep dive and an improvement audit because you feel you never had a plan. This report does three things:

- explains what you've built and how healthy it is, without jargon;
- shows you that you already have a plan, and what it says;
- gives a council verdict on what to do next and what to stop.

**It is not another bug hunt.** A full line-by-line audit was done yesterday ([prism-self-audit.md](prism-self-audit.md)). Rule 5 of your own [fix-plan.md](fix-plan.md) says "no AI audit rounds". A new bug list would break that rule and start the loop again. Section 5 has the few new things this check found. None of them are bugs in the extension.

---

## 1. The short version

- **Prism works and is in good technical shape.** Every automated check passes today (section 4).
- **You do have a plan.** It's [fix-plan.md](fix-plan.md), and it boils down to: "read your novels, fix only what breaks, check fixes on a real page, release rarely."
- **The weak spot is the process, not the code.** Since August there have been 73 test releases ("betas") and never a final one, sometimes several in one day. Nearly every bug that mattered was one you found by reading, not one tests or audits found.
- **The next step is yours, not the code's:** test beta.73 on your iPhone in Orion on sangtacviet. If it works, call it stable and stop releasing until something breaks.

---

## 2. You already have a plan

[fix-plan.md](fix-plan.md) was written yesterday from the big audit and then cut down for personal use. In plain words:

| The plan's rule | What it means for you |
|---|---|
| 1. The pages you read decide what gets fixed | Don't fix things nobody hit. Fix what annoyed you while reading. |
| 2. Every fix ships with a test | When the AI fixes something, it also writes a check that would catch it coming back. |
| 3. Check the fix on the page where it broke | Before releasing, open the real page in a real browser and look. |
| 4. Batch fixes into one release | Collect several fixes, then release once. Not one release per fix. |
| 5. No new providers and no AI audit rounds | Google (free) and Google Cloud (your own key) are enough. Stop asking an AI to "find problems". |
| 6. Fix the class, not just the instance | If the same mistake is copied in several files, fix all the copies at once. |

What's already done: everything in Release 1 (13 confirmed bugs), N-1 to N-3 (saved-page tests, a clear error when Google's key fails, honest docs), plus beta.73's sangtacviet fixes.

What's left:

- **The iPhone check** (section 7).
- **"Bugs to confirm, then fix when they bite."** This is a waiting list, not a to-do list. Leave it alone unless one of them actually happens to you.

---

## 3. What you've built, in plain words

Prism is a browser extension that swaps the text of a web page for a translation, in place, keeping the layout.

| Part | What it does | Where it lives |
|---|---|---|
| **The engine** | Finds the text on a page, groups it into sensible chunks, sends it off for translation, puts the result back, and watches for new text (comments loading, next chapter). | `src/engine/` |
| **Providers** | The services that do the translating: free Google (the default, which works by borrowing Google Translate's website key) and Google Cloud (paid, your own key, the backup). | `src/engine/providers/` |
| **The background worker** | The extension's "brain" that runs behind every tab: settings, the translation cache, talking to Google. | `entrypoints/background.ts` |
| **The page script** | Runs inside each web page and drives the engine there. | `entrypoints/content.ts` |
| **The screens** | The floating bubble on the page, the toolbar popup, the Settings page, the hover-to-see-original tooltip, and the select-text-to-translate popup. | `components/`, `entrypoints/popup/`, `entrypoints/options/` |
| **Safety nets** | 890 automatic tests; saved copies of real pages (Wikipedia, sangtacviet, pixiv) replayed with Google's recorded answers; checks that run on every push to GitHub. | `tests/`, `.github/workflows/` |

It builds for Chrome, Firefox and Safari (Mac and iPhone). It's about 13,000 lines of code, which is medium-sized for one person.

**Your one big outside risk:** free Google translation works by borrowing a key from Google Translate's own website. Google could change that any day without warning. The backup already exists: switch to "Google Cloud Translate" in Settings and paste your own key. But a backup you've never tried isn't really a backup (section 7, step 3).

---

## 4. Health check today

Everything was run fresh in this session:

| Check | What it means | Result |
|---|---|---|
| Type check | The code is internally consistent | Pass |
| Lint | Style and common mistakes | Pass (2 minor warnings) |
| Engine purity and UI reactivity guards | Two custom checks for mistakes that caused real bugs in the old version | Pass |
| Unit tests | 890 small automatic checks | 890 of 890 pass, 96% of the core code covered |
| Builds | Chrome and Firefox versions build | Pass, 211 KB (limit 300 KB) |
| End-to-end test | Loads the real extension in a real Chromium and clicks through it | 9 of 9 pass |
| Security advisories, shipped code | Known vulnerabilities in libraries the extension uses | 2 "critical", but low real risk (section 5) |
| Security advisories, build tools | Same, for tools that only run on the developer's machine | 7 more; don't affect the extension |

**What these checks can't tell you:** whether Prism works in Orion on your iPhone on today's version of sangtacviet. Only you can check that. History shows that's where real bugs show up.

---

## 5. What this check found that's new

None of these are extension bugs. They're housekeeping that makes AI sessions work better, ordered by how much they matter.

| # | Finding | Why it matters | Effort |
|---|---|---|---|
| 1 | **The repo's hooks block tests in cloud sessions.** `.claude/hooks/pre-bash.sh` refuses `npm test` and `npm run build` and says to use `agora-code`, which isn't installed in cloud sessions. `pre-agent.sh` also blocked subagents during this session. | An AI session that can't run tests either works around them or ships untested work. This is the most likely way a future session breaks Prism by accident. | 15 min: have the hooks skip themselves when `agora-code` isn't installed, or remove them from `.claude/settings.json` |
| 2 | **`CLAUDE.md` sends every session to a file that only exists on a laptop**: `/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md`. It also says "read this first, always". | Cloud sessions can't read it, so each one starts by looking for something that isn't there. The real plan, [fix-plan.md](fix-plan.md), is already in the repo. | 10 min: point `CLAUDE.md` at `docs/reports/fix-plan.md` instead |
| 3 | **solid-js has 2 "critical" security advisories** (via a library called `seroval`). | The affected code is only used when a website builds its pages on a server, which Prism never does. I checked the built extension and it doesn't contain that code. Real risk is low, but the fix is one routine update (1.9.14 → 1.9.18). | 5 min, plus the normal checks |
| 4 | **`README.md` is stale.** It says lint is "not yet a CI gate" (it is), and it points to the laptop plan file. | Small, but it's the first file anyone opens. | 5 min |
| 5 | **There are far more docs than code.** About 470 KB of AI-written history (including a 164 KB ledger) against 13,000 lines of code. | Long history docs steer AI sessions toward old, no-longer-true facts. The plan already froze the ledger, so the fix is to stop adding narrative, not to delete it. | None: just stop growing it |
| 6 | **Releases have no "checked on a real page" gate.** Any merge to `main` that changes the version number publishes a release automatically. | Rules 3 and 4 depend on memory, and beta.72 and beta.73 came out within a day of the plan. A small mechanical check would hold where memory doesn't. | 30 min (see section 6, "Blind spots") |

---

## 6. The council's verdict

**How it ran:** five advisors answered the question "What should the owner focus on next, what should they stop, and is another audit the right move?" Each took a different angle: a sceptic, someone who questions the problem itself, someone who looks for upside, an outsider, and a practical "what do you do Monday" voice. Five reviewers then judged the answers anonymously, and a chairman summarized.

All of them were Claude playing different roles, not different AI models (the [aiwithremy/claude-skills-llm-council](https://github.com/aiwithremy/claude-skills-llm-council) skill). They saw a factual summary of this repo, not the code itself. One review was unanimous: all five reviewers rated the practical answer strongest and the upside answer weakest.

### Where the council agrees

- **No more audits.** All five advisors said it independently. The plan you wrote two days ago already forbids them. Audits make lists, lists make releases, and releases make new bugs. The bugs that mattered came from your own reading.
- **Do the pending iPhone test first.** Then, if it works, **call beta.73 stable and freeze it.** "Stable" is a label you choose. It means "the version I don't touch", not something tests prove.
- **Test the Google Cloud backup once, now,** while nothing is broken, so the day free Google stops working is a 2-minute settings change instead of an emergency.
- **Release at most once a week,** and only for a bug you actually hit, after checking it on the real page.
- **Stop writing narrative docs.**

### Where the council clashes

- **Does the AI-facing housekeeping matter?** The Outsider and First Principles said the laptop path, the hooks and the docs "don't matter, only the AI reads them". The Executor, the Contrarian and every reviewer disagreed: AI sessions are the only developers on this project, so whatever confuses them turns into bugs. **The council sides with fixing them.** It's under an hour, and it improves every future session.
- **Freeze, or build reading features?** The Expansionist wanted the extension to become a better reading machine:
  - a per-novel glossary for character and sect names;
  - a dedicated sangtacviet handler;
  - "remember where I stopped" and pre-translating the next chapter.

  All five reviewers called this the same "keep adding" loop with a new name. **Freeze first.** The glossary in particular was already ruled out in the plan's "Dropped" list. If, after a few weeks of calm reading, mangled names are your biggest annoyance, that's a real reason to reopen it.

### Blind spots the review caught

- **Rules held by memory don't hold.** The plan's rules were broken within 48 hours. All five reviewers said the fix is mechanical, not willpower. For example, the release workflow could refuse to publish unless the release notes contain a line like `Checked on: <page>, <browser>, <date>`. Then "check on a real page" can't be skipped by accident.
- **"I have no plan" means "done" was never defined.** A suggested definition: *Prism is done when it reads sangtacviet on the iPhone, says so when it fails, and has gone two weeks without a bug that stopped reading.*
- **Silent failure is the bug that keeps coming back.** The council asked for a visible "this didn't translate" signal. Beta.73 already added one: the bubble says "About N% of this page came back untranslated". If a page ever looks untranslated and the bubble *doesn't* say so, that's the one bug worth reporting straight away.
- **Turn every real bug into a saved-page test.** The replay tests (`tests/replay/`) already do this for three sites. When something breaks, ask the session to save that page as a replay case, so it can never silently come back.
- **Rolling back.** Every release, with its zip, stays on the repo's GitHub Releases page. If a new version breaks reading, reinstall the last good one from there.

### The recommendation

**Don't audit. Close the loop and go read.**

1. Run the iPhone check.
2. Declare a stable version.
3. Spend one short session on the housekeeping in section 5 (rows 1–4) plus the release gate.
4. Then use Prism normally for two weeks.

Open a coding session only when your list of things that broke has something on it, fix those in one batch, check them on the real page, and release once.

### The one thing to do first

**Pick up your iPhone, open a sangtacviet chapter in Orion with beta.73, and read it.** The plan describes the exact check:

- one chapter in Vietnamese mode, with the site's own translation off;
- one chapter in English mode (Bật, English, Google);
- tap the bubble and check its panel stays closed.

Until that's done, nothing else on this list counts.

---

## 7. A simple routine from here

1. **Today:** run the iPhone check above. If it fails, the plan says to reinstall beta.72, undo only the word-per-word change, and save the chapter as a replay case.
2. **If it passes:** release beta.73's code as **0.3.0** (stable). Ask a session to "exit beta mode and release 0.3.0". Changesets has a command for this.
3. **This week, once:** in Settings, switch to Google Cloud Translate, paste your key, translate one page to confirm it works, then switch back. Write down where your key is.
4. **One housekeeping session:** section 5 rows 1–4, plus the "checked on" release gate.
5. **Then just read.** Keep a plain note: date, URL, what looked wrong. Nothing on the note means no coding session.
6. **When the note has something:** one session, fix it with a test and a saved page, check it on the real page, release once.

### Words you'll see in sessions

| Word | Meaning |
|---|---|
| **Beta** | A test release. Prism has had 73. |
| **Stable** | A release you've decided is "the one". |
| **Provider** | The translation service (free Google, or Google Cloud). |
| **CI** | The checks GitHub runs automatically on every push. |
| **Replay test** | A saved real page, replayed with Google's recorded answer, to check a fix stays fixed. |
| **Changeset** | A small note describing a change, used to build release notes and bump the version. |
| **Grouping** | Sending a whole paragraph to Google at once for better context. It can scramble layout, and you can turn it off in Settings → Page translation → "translate each paragraph as a whole". |

---

## Appendix: the five advisors, in one line each

- **Contrarian:** the flaw is the loop, not the code; you broke your own no-audit rule in 48 hours. Get a known-good version and a tested fallback.
- **First Principles:** the goal is reading novels tomorrow morning, not a better codebase; "the novel is the plan".
- **Expansionist:** it's a one-reader web-novel machine. Add a one-tap "this page is broken" capture, a name glossary and reading features. _(Reviewers: right instinct on capture, wrong time for features.)_
- **Outsider:** you're the only user and it works today; stop looking for problems and follow the rules you already wrote.
- **Executor** _(rated strongest by all five reviewers)_: iPhone test, then tag stable, then test the paid key, then fix the hooks and `CLAUDE.md`, then bump solid-js, then stop.
