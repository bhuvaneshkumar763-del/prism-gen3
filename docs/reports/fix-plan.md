# Prism fix plan

_2026-11-01 · from Prism 0.3.0-beta.70 (commit fed8806)_

**Status: plan only. No code has been changed.** This plan merges the three reports:
- [prism-self-audit.md](prism-self-audit.md): the line-by-line read and history, with 13 defects checked by hand
- [prism-vs-immersive-translate.md](prism-vs-immersive-translate.md)
- [prism-vs-twp.md](prism-vs-twp.md)

Where the reports disagree, the self-audit wins: it is the only one that read every line, and it moves the comparison reports' "first step" (the cache key) behind the punctuation bug.

## Rules for every release in this plan

1. **One release per batch, not one per fix.** At most one release a week.
2. **Every fix ships with a test that fails before it.** The test name says what it guards.
3. **No new features until 0.3.0 stable.** The comparison reports' features wait until Release 5.
4. **Before any tag, check it on a real page in a real browser.** Use the pages listed for each fix.
5. **Fix the class, not just the instance**, where the fix is already a small shared helper (R1-5, R1-8). The larger consolidations wait for Release 4.

Sizes: S is under an hour, M is half a day, L is several days.

---

## Release 1 — beta.71: the confirmed bugs

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

## Release 2 — gates, then 0.3.0 stable

Until this release, every commit went straight to main. This release adds the checks that stop the next 70 betas.

| ID | Item | Notes | Size |
|---|---|---|---|
| R2-1 | **Branch protection on `main`**: PR only, CI required | A GitHub setting that you have to switch on yourself | S |
| R2-2 | **Real-page smoke test required before a tag** | Extend the existing Playwright harness (`tests/e2e/run.mjs`) with 3–5 saved pages (es, ja, link-heavy, SPA) and recorded provider responses. This is the seed of the R5-1 corpus. | M |
| R2-3 | **Coverage includes `entrypoints/` and `components/`** | `vitest.config.ts:27`. Report-only first, then a threshold set from the measured number, not 90%. | S |
| R2-4 | **Manual translate reaches same-origin iframes** | `entrypoints/content.ts:419-425`: register the `pageTranslate` handler in every frame the way `pageRestore` is. Test on a page with an embedded comments frame. | M |
| R2-5 | **Make the docs true** | Fix or delete the stale entries in the out-of-scope list (Firefox, iframes, attribute translation, backup UI), known-gaps (shadow-DOM selection) and current-status ("as of beta.64"). Freeze the 164 KB ledger. | S |
| R2-6 | **Check the store dashboards** | Chrome Web Store and Mozilla add-ons install and uninstall counts. This decides how much Releases 5–6 matter. | S |
| R2-7 | **Tag 0.3.0 stable** | Only after R2-1 to R2-4 pass. | S |

---

## Release 3 — 0.3.1: the remaining bugs

Found by the line-by-line read, but not checked by hand. **Confirm each in the code before fixing it**; drop any that turn out to be wrong.

**Silent-failure chain** (the "says translated but nothing changed" class, which has been fixed 8 times):
- `throw undefined` loses the error kind (`batchedHttpProvider.ts:526`).
- Every mutation cancels the error backoff (`translateLoop.ts:425, 1104, 1168`).
- Show an error that names the Google key as the cause when both the scrape and the fallback key fail (from the Immersive Translate report).

**Page translation:**
- `attributeTranslator.ts`: four bugs (stale restore, no `sentText` staleness check, an unhandled rejection, the wrong skip check).
- `titleTranslator.ts`: no generation guard, so a late response sets a stale title.
- `google.ts:511-516`: repair reportedly drops the explicit source language. The code at line 512 passes `request.sourceLanguage`, so check what that holds before changing anything.

**UI:**
- Keystrokes leak from the bubble's picker to the page (`FloatingBubble.tsx:326-360`).
- The selection trigger doesn't follow scroll (`mountSelectionPopup.ts:351-362`).
- Bubble text contrast is below WCAG AA (3.30:1 on green).
- `.catch` on `applyListPatch`.

**Platform:**
- Firefox context menus vanish after a browser restart (`background.ts:487-501`).
- The cache budget falls out of sync after Clear cache (`translationCache.ts:122, 370`).
- Add a 30-day maximum age to cache entries (from the Immersive Translate report).
- Both CI guard scripts pass broken fixtures, so fix the scripts until those fixtures fail.

**Grouping kill switch:** a config flag that turns `groupByBlock` off without a release, ready before R5-2 measures whether grouping is worth keeping.

---

## Release 4 — 0.3.2: one helper per rule

Each fix so far landed in one place and missed its sibling. Build one shared helper per rule, move every caller to it, and delete the copies.

| Rule | Has it | Missing it |
|---|---|---|
| `sentText` staleness check | translateLoop | attributeTranslator |
| Generation guard | attributeTranslator | titleTranslator |
| apex hostname matching | membership | add/remove (done in R1-4) |
| Base language-tag equality | autoTranslateDecision | popup, outputSanityCheck (done in R1-8) |
| Response-count check | Google | LLM (done in R1-5) |
| `.catch` on fire-and-forget | `openSettings` | `applyListPatch` |

Also add an `onTrustedMessage` wrapper so no handler repeats the `isTrustedSender` check by hand.

Add a short checklist to the PR template for any new async path: generation guard, staleness check, `.catch`, timeout.

---

## Release 5 — measure, then decide

Nothing here ships to users until a measurement says it helps.

| ID | Item | Source | Size |
|---|---|---|---|
| R5-1 | **Replay corpus**: about 20 pages, each saved HTML with recorded provider responses, run in CI. Start from the ~22 live site reports (sangtacviet, novel543, pixiv, bilibili, Wikipedia), and add es `¿`, ja `「」`, RTL, SPA, docs and forum pages. | All three reports | L |
| R5-2 | **Is grouping worth it?** Compare grouped and ungrouped on the corpus: quality, request count, time to first visible translation, reflow repairs. Grouping drives both the reflow chain and the ReDoS path. If the gain is small, turn it off and delete the heuristic stack around it. | Self-audit | M |
| R5-3 | **Does size cause reflow?** Try en → zh, ja and ko at 500, 1000 and 2000 characters per group. If size matters, lower `maxGroupChars` for those pairs only. | TWP report | S |
| R5-4 | **Paragraph-HTML experiment** on `translateHtml` | Immersive Translate report | M |
| R5-5 | **Mine TWP's issue tracker** for recurring Google-endpoint and real-page breakage, and add the cases to the corpus. | TWP report | S |

---

## Release 6 — LLM hardening, then the comparison reports' cheap wins

**LLM hardening first** (deferred across three audit rounds):
- Validate the base URL (https only, except localhost) and redact it in diagnostics.
- Strip `<think>…</think>` and other preambles before parsing JSON.
- Frame page text as data in the prompt to resist prompt injection.

**Then the cheap wins, each with a counter and an off switch:**
- Page title and an optional glossary in the LLM prompt. Needs R1-7, so the cache key includes the prompt context.
- Pause translation while the tab is hidden (`visibilityState`).
- Skip regexes (written fresh, with a counter).
- Per-piece same-language skip via `i18n.detectLanguage`, with a minimum length.
- Lazy translation for LLM providers only. Keep the free Google path eager.
- An LLM → Google fallback with a budget, **opt-in only**: a user who picked an LLM to keep page text away from Google must not be sent there silently (see Decisions).

---

## Later, ranked

1. **i18n per ADR 0007**: error messages and the popup first. This was the TWP report's biggest reach item.
2. **A second free path that isn't another scraped endpoint**: Chrome's on-device Translator as a fallback only, behind an availability check, or a fallback key that can be updated without a store release. The single scraped key is the biggest outside risk, including store takedown.
3. **A custom dictionary or "never translate these terms" list** for names and brands, tested against the reflow and sanity guards.
4. **A "this page translated badly" link**, so real users set priorities instead of audits.
5. **Archive the narrative docs and changelog-style code comments**: git already holds the history.
6. Hover to see a translation (TWP's `showTranslated`), reusing the tooltip.

**Deferred:** bilingual mode; cross-origin frames (only on a user report, as an opt-in per site).

## Not doing (agreed in the comparison reports)

- Immersive Translate's site rules, 60 providers, header spoofing, OCR or telemetry, or its request rates (ban risk on the shared key).
- TWP's Bing, Yandex or DeepL tab robot, the trailing space, silent failure, or the unbounded cache.
- Glossary, pinyin and learner features before stable.
- More hand-tuning of Google reflow heuristics. R5-2 decides grouping's future instead.

## Stop list

- Numbered AI audit rounds until Release 3 is closed.
- One fix per beta, and same-day beta bursts.
- Pushing to main without the real-page check.
- Growing the ledger.
- Reading silence as safety.

## Decisions only you can make

1. **Always vs never precedence** (R1-4). The Settings page says always-translate wins; the code makes never-translate win. The plan changes the text to match the code, which is the safer default. Say if you want the opposite.
2. **LLM → Google fallback** (Release 6). The plan makes it opt-in. Dropping it entirely is also reasonable.
3. **Branch protection** (R2-1). This is a GitHub setting on your account, so you have to switch it on.

## Dependencies

- R1-7 (cache key) must come before the LLM title and glossary work in Release 6.
- R2-2 (smoke pages) grows into R5-1 (corpus), and R5-1 must exist before R5-2 to R5-4.
- The R3 kill switch must exist before R5-2.
- Release 4 relies on R1-4, R1-5 and R1-8 for three of its six rules.

## First step

R1-1: the punctuation restore in `translateLoop.ts`, written test-first with the four cases in the design note.
