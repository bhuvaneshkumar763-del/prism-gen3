# Prism fix plan

_2026-11-01 · from Prism 0.3.0-beta.70 (commit fed8806) · cut down for personal use the same day_

**Status: Release 1 shipped as 0.3.0-beta.71; N-1 to N-3 shipped as 0.3.0-beta.72; the sangtacviet fixes, the untranslated warning and the LLM removal shipped as 0.3.0-beta.73. Next: [The plan from here](#the-plan-from-here-2026-11-02).** The rest of the plan was cut down after Release 1. Prism is for personal use only. There are no other users and no store audience, and no new translation providers are planned. So the original plan's store, launch, branch-protection, i18n, new-provider and LLM-hardening work is dropped (see [Dropped](#dropped)).

The plan came from three reports:
- [prism-self-audit.md](prism-self-audit.md): the line-by-line read and history, with 13 defects checked by hand
- [prism-vs-immersive-translate.md](prism-vs-immersive-translate.md)
- [prism-vs-twp.md](prism-vs-twp.md)

## Rules

1. **The pages you read decide what gets fixed.** A bug found only by reading code is confirmed in the code before it's fixed. Fix it now if you've hit it; otherwise it waits.
2. **Every fix ships with a test that fails before it.** The test name says what it guards.
3. **Before a release, check the fix on the page where it broke**, in a real browser.
4. **Batch fixes into one release.** No same-day bursts of one-fix betas.
5. **No new providers and no AI audit rounds.**
6. **Fix the class, not just the instance.** When a fix touches a rule that's copied elsewhere (see [Copied rules](#copied-rules)), fix every copy in the same change.

Sizes: S is under an hour, M is half a day, L is several days.

---

## The plan from here (2026-11-02)

_From [where-prism-stands.md](where-prism-stands.md). This is the current plan; the sections below it are history and a waiting list._

**Goal:** Prism is **done** when it reads sangtacviet on the iPhone, says so when a page fails, and goes two weeks without a bug that stops reading. After that it's maintenance: fix what breaks, nothing else.

Each step says who does it. **You** means you, in a browser. **Session** means an AI coding session; paste the prompt shown.

### Step 1 — You, today (15 min): check beta.73 on the iPhone

In Orion, with beta.73 installed:
- [x] Read one sangtacviet chapter in Vietnamese mode (the site's own translation off).
- [x] Read one chapter in English mode (Bật, English, Google).
- [x] Tap the bubble. Its panel should stay closed.

_Passed 2026-11-02._

**If all three pass**, go to step 2. **If any fail**, write down the chapter URL and what looked wrong, reinstall beta.72 from GitHub Releases, and give a session this prompt:

> Beta.73 failed on the iPhone: <URL, what looked wrong>. Follow `docs/reports/fix-plan.md`: revert only the word-per-word change, save this chapter as a replay case in `tests/replay/`, and don't release until I've checked it.

### Step 2 — Session (about 1 hour): housekeeping, then stable 0.3.0

Paste:

> Do step 2 of "The plan from here" in `docs/reports/fix-plan.md`, as one change and one release. Don't fix anything else.

What that session does, all in one batch:
- [x] **H-1** Remove the agora-code hooks (`.claude/hooks/` and `.claude/settings.json`, which held only those hooks); the owner dropped agora-code.
- [x] **H-2** Point `CLAUDE.md` at this file instead of the `/Users/jb/...` plan path that cloud sessions can't read.
- [x] **H-3** Fix `README.md`: lint is a CI gate, and the plan is this file.
- [x] **H-4** Update `solid-js` to 1.9.18 (clears the two "critical" advisories; the affected code isn't in the extension, so this is routine).
- [x] **H-5** Add a release gate: `release.yml` refuses to publish unless the version's changelog entry has a line starting `Checked on: <page>, <browser>, <date>`. This turns rules 3 and 4 from memory into a check.
- [x] Leave beta mode and version the stable release (`changeset pre exit`). Its changelog entry records your step 1 check, so the gate lets it through. It's **0.3.1**, not 0.3.0: the first 0.3.0 release attempt failed because Firefox's add-on site already holds a 0.3.0 from early betas, and 0.3.0 would also count as older than the 0.3.0.N beta builds.

Then **you** (5 min): install 0.3.1 on the iPhone and read one chapter. If it's fine, 0.3.1 is your stable version. If not, go back to beta.73 and tell a session what broke.

### Step 3 — You, once (10 min): try the backup

- [ ] Settings → Page translation → Translation service → **Google Cloud Translation API**, paste your key, translate one page.
- [ ] Switch back to Google.
- [ ] Write down where your key is kept.

Now the day free Google stops working is a two-minute settings change.

### Step 4 — You, two weeks: just read

- [ ] Keep one note (on your phone is fine): date, URL, what looked wrong.
- [ ] No coding sessions while the note is empty.
- [ ] One thing to watch: a page that looks untranslated **but the bubble doesn't say so**. That's the silent failure that keeps coming back. Note it right away.

### Step 5 — Session, only when the note has something: one fix batch

Paste:

> Here's what broke while I was reading: <your note>. Follow `docs/reports/fix-plan.md`: confirm each one in the code, fix it with a test, save the page as a replay case, and put all the fixes in one release. I'll check them on the real pages before you tag it.

Then **you** check each fix on its real page, give the `Checked on:` line, and the session releases. At most one release a week.

### Not part of the plan

- AI audits or "find improvements" sessions, including councils over the code.
- New features (glossary, reading position, pre-translating chapters), until you've gone two quiet weeks and one of them is your biggest annoyance.
- Anything from "Bugs to confirm" below that hasn't happened to you.
- New narrative docs. Release notes go in the changeset; nothing else.

---

## Release 1 — beta.71: the confirmed bugs (shipped)

Every row here was checked against the code by hand. Together they're about one to two days of work.

| ID | Fix | Where | Change | Test | Size |
|---|---|---|---|---|---|
| R1-1 | **Punctuation restore strips `¿ « 「`** | `src/engine/pageTranslator/translateLoop.ts:739-741, 785-787` | See the design note below the table. | `translateLoop.test.ts`: `"Are you sure? "` keeps Google's `¿`; `"¿Qué pasa? "` → en has no `¿`; `". The program "` keeps its period when Google drops it; and when Google echoes it, the period doesn't appear twice | M |
| R1-2 | **Long-press also toggles translation**, and so does right-click | `components/bubble/FloatingBubble.tsx:254-292` | Set a `longPressFired` flag in the timer; `onPointerUp` returns early when it's set. Ignore `e.button !== 0`. | `FloatingBubble.test.tsx`: long-press opens the panel and doesn't toggle; right-click doesn't toggle | S |
| R1-3 | **Google key is fetched for LLM and Cloud users** | `entrypoints/background.ts:306` | Prefetch only when the selected provider is Google. Also prefetch when the user switches to Google. | Unit test on the gating function | S |
| R1-4 | **`www.` site lists get stuck**, and the Settings text contradicts the code | `src/shared/config/listMutations.ts:28-30, 96-118`; `entrypoints/options/App.tsx:531` | Add and remove go through `apexForm`, the same as membership does. Removing deletes every entry that matches by apex. Adding to one list removes the site from the other. Change the Settings text to match the code (never-translate wins), unless you decide otherwise (see Decisions). | `listMutations.test.ts`: `www.example.com` with `example.com` listed can be removed; adding to always removes it from never | S |
| R1-5 | **A short LLM reply shifts translations into the wrong nodes** | `src/engine/providers/batchedHttpProvider.ts:560` (the shared base, not `llm.ts`) | If `results.length !== pending.length`, treat the whole batch as missing, so the existing per-piece repair retries it. Fixing it in the base covers every provider. | `batchedHttpProvider.test.ts`: a reply of 4 items for 5 pieces writes nothing out of place | S |
| R1-6 | **`temperature: 0` is always sent** | `src/engine/providers/llm.ts:85` | Stop sending `temperature`, so the endpoint uses its default. OpenAI reasoning models reject any non-default value. | `llm.test.ts`: the request body has no `temperature` | S |
| R1-7 | **Cache key leaves out the LLM model and base URL** | `entrypoints/background.ts:358`, `src/platform/cache/translationCache.ts:379` | For the LLM provider, add the model and base URL to the key. Use a hash so the key holds no secret. | `translationCache.test.ts`: different models give different keys | S |
| R1-8 | **Raw language compare in the echo check** (`zh-CN` ≠ `zh`) starts the silent-failure chain | `src/engine/providers/outputSanityCheck.ts:242`; the same bug in the popup's always-translate-language toggle, `alwaysLangs().includes(...)` at `entrypoints/popup/App.tsx:109` | Compare with `baseLanguageTag()` from `src/shared/languages.ts`, which already exists. | `outputSanityCheck.test.ts`: `zh-CN` detected with target `zh` isn't suspicious; `iw` with `he` likewise | S |
| R1-9 | **Key-scrape pattern `(\w{39})` can't match `-`** | `src/engine/providers/google.ts:189` | Use `([\w-]{39})`. | `google.test.ts`: a key containing `-` is scraped | S |
| R1-10 | **ReDoS in `PURE_TAGS_RE`** | `src/engine/pageTranslator/tagText.ts:36-37` | Return `false` early for text over 200 characters, and stop letting a token absorb its own separators (take `/` out of `TAG_TOKEN`). | `tagText.test.ts`: `"#a/".repeat(40) + " x"` finishes in under 50 ms; the existing tag-cluster cases still pass | S |
| R1-11 | **Google Cloud: no segment cap, and the key goes in the URL** | `src/engine/providers/googleCloudTranslate.ts:41-52`; `batchedHttpProvider.ts:74` | Add a `maxBatchPieces` option to the base and set it to 128 for Cloud. Send the key in the `X-Goog-Api-Key` header instead of `?key=`. | `googleCloudTranslate.test.ts`: 300 pieces become 3 requests; the URL has no key | S |
| R1-12 | **Release workflow leaves a write token in `.git/config` while `npm ci` runs** | `.github/workflows/release.yml:31` | Set `persist-credentials: false` on checkout. Pass the token explicitly only to the step that publishes. | Run the release workflow once on a test tag | S |

### Design note for R1-1 (punctuation)

The strip exists for a real reason: on live Wikipedia, Google dropped a node's leading `". "`, which belongs to the end of the previous sentence (comment at `translateLoop.ts:694-720`). So the fix keeps that case and stops treating every leading symbol the same way.

- **Carried back from the source:** whitespace, plus *closing* punctuation that ends the previous sentence: `. , ; : ! ? ) ] } » 」 』 。 ， 、 ！ ？ ； ： …`
- **Never carried back:** *opening* punctuation, which belongs to the sentence itself: `¿ ¡ « 「 『 „ “ ‘ (`. The translation keeps whatever opening punctuation Google produced.
- **Doubling guard:** strip the carried prefix from the front of the translation only when the translation already starts with that same prefix.
- **Trailing side:** no change. It restores whitespace only.

This changes the strip-and-replace into "restore what Google is known to drop; never overwrite what it produced". Check the four test cases on a live page in Spanish, Japanese and French before tagging.

### Real-page check before tagging beta.71

- An es → en page and an en → es page with inline links (R1-1)
- A ja page with `「」` (R1-1)
- Long-press and right-click on the bubble, on a touch-emulated tab (R1-2)
- An LLM provider set to a reasoning model (R1-6), then switch models and reload (R1-7)
- A Google Cloud key on a nav-heavy page (R1-11)
- A `www.` site added to and removed from both lists through the popup (R1-4)

---

## Next: your own pages as the test set (shipped in beta.72)

| ID | Item | Notes | Size |
|---|---|---|---|
| N-1 | **Save pages that translate badly as replay tests** (done: `tests/replay/`, with Wikipedia, sangtacviet and pixiv cases; novel543 and bilibili need a page saved from your browser, `--html`) | When a page you read goes wrong, save its HTML and the recorded Google response, and run it in CI through the Playwright harness (`tests/e2e/run.mjs`). Start with the sites from past reports: sangtacviet, novel543, pixiv, bilibili, and one Wikipedia page. This replaces the old smoke-test (R2-2) and replay-corpus (R5-1) items. | M |
| N-2 | **A clear error when the Google key fails** (done: Google rejects a dead key with HTTP 400, which now fetches a new key and names the cause) | When both the scraped key and the fallback key fail, say so: name the key as the cause and point to the Google Cloud provider in Settings as the manual backup. First check what Prism shows today (beta.45 fixed part of this). | S |
| N-3 | **Make the docs true** (done) | Fix or delete the stale entries in the out-of-scope list (Firefox, iframes, attribute translation, backup UI), known-gaps (shadow-DOM selection) and current-status ("as of beta.64"). Freeze the 164 KB ledger. | S |

## Bugs to confirm, then fix when they bite

Found by the line-by-line read but not checked by hand. **Confirm each in the code before fixing it**, and drop any that turn out to be wrong. Order them by what you actually hit.

**"Says translated but nothing changed":**
- `throw undefined` loses the error kind (`batchedHttpProvider.ts:526`).
- Every mutation cancels the error backoff (`translateLoop.ts:425, 1104, 1168`).

**Page translation:**
- `attributeTranslator.ts`: four bugs (stale restore, no `sentText` staleness check, an unhandled rejection, the wrong skip check).
- `titleTranslator.ts`: no generation guard, so a late response sets a stale title.
- `google.ts:511-516`: repair reportedly drops the explicit source language. The code at line 512 passes `request.sourceLanguage`, so check what that holds before changing anything.
- Manual translate doesn't reach same-origin iframes (`entrypoints/content.ts:419-425`). Fix it if your sites put comments or chapters in frames: register the `pageTranslate` handler in every frame, the way `pageRestore` is.

**UI:**
- Keystrokes leak from the bubble's picker to the page (`FloatingBubble.tsx:326-360`).
- The selection trigger doesn't follow scroll (`mountSelectionPopup.ts:351-362`).
- `.catch` on `applyListPatch`.
- Bubble text contrast is 3.30:1 on green, below WCAG AA. Fix it if it bothers you.

**Platform:**
- Firefox context menus vanish after a browser restart (`background.ts:487-501`), if you use Firefox.
- The cache budget falls out of sync after Clear cache (`translationCache.ts:122, 370`).
- Add a 30-day maximum age to cache entries.

**Tooling:**
- Both CI guard scripts pass broken fixtures, so fix the scripts until those fixtures fail.
- ~~A config flag that turns `groupByBlock` off without a release.~~ Shipped in beta.73 as Settings → Page translation → "translate each paragraph as a whole". Turning it off also turns off beta.73's word-per-word chapter fix, so it is not a fix for sangtacviet's Vietnamese mode.

## Later, only if the saved pages show a need

Both need N-1's saved pages first.
- **Is grouping worth it?** Compare grouped and ungrouped on the saved pages: quality, request count, time to first visible translation, reflow repairs. If the gain is small, turn it off and delete the heuristic stack around it.
- **Does size cause reflow?** Try zh, ja and ko pages at 500, 1000 and 2000 characters per group. If size matters, lower `maxGroupChars` for those pairs only.

## Copied rules

Each earlier fix landed in one place and missed its copy. When a fix touches one of these rules, move every caller to one shared helper in the same change.

| Rule | Has it | Missing it |
|---|---|---|
| `sentText` staleness check | translateLoop | attributeTranslator |
| Generation guard | attributeTranslator | titleTranslator |
| `.catch` on fire-and-forget | `openSettings` | `applyListPatch` |
| `isTrustedSender` check | each handler by hand | an `onTrustedMessage` wrapper |

Apex hostname matching, base language-tag equality and the response-count check were unified in Release 1.

## Dropped

Cut on 2026-11-01 because Prism is for personal use and no new providers are planned:
- Branch protection, store install counts, and 0.3.0 stable as a gated release. Tag it whenever you like.
- Pushing coverage into `entrypoints/` and `components/`.
- LLM hardening, LLM prompt features, and an LLM → Google fallback.
- A second free translation path.
- i18n, a "this page translated badly" link, a custom dictionary, and hover-to-see-translation.
- The paragraph-HTML experiment, and mining TWP's issue tracker.
- Everything the comparison reports already ruled out: Immersive Translate's site rules, 60 providers, header spoofing, OCR or telemetry; TWP's Bing, Yandex and DeepL paths, silent failure and unbounded cache.

## Open question (answered)

Prism shipped an LLM provider it never used. Decided 2026-11-02: removed. Google Cloud, with your own key, stays as the backup if the scraped Google key breaks.

## First step

_Superseded by [The plan from here](#the-plan-from-here-2026-11-02), step 1. Kept for its replay-recording command._

**Pending: check beta.73 on the iPhone in Orion.** Its sangtacviet fixes were verified in emulated mobile Chrome against a copy of the site's markup, not on the live site. Read one chapter in Vietnamese mode (the site's translation off) and one in English mode (Bật, English, Google), and tap the bubble to check its panel stays closed. If it fails, reinstall beta.72, revert the word-per-word change alone, and record the chapter as a replay case.

Then use beta.73 on the pages you normally read. When one goes wrong, save it with `npm run replay:record -- <name> --url <url> --to <lang>`, add a check to its `case.json` that fails, and fix it; that's the next release.
