# Prism vs Immersive Translate: mechanism-by-mechanism comparison

_2026-11-01 · Prism 0.3.0-beta.70 (commit fed8806) vs Immersive Translate 1.34.4 (commit 2ff98f3 of its GitHub repo, built 2026-10-23)_

**Status: analysis and plan only. No code was changed.**

## How this was done

- **Prism**: read from source. The main files were `src/engine/pageTranslator/*`, `src/engine/providers/*`, `src/platform/cache/translationCache.ts` and `entrypoints/background.ts`.
- **Immersive Translate (IT)**: its GitHub repo has no source code. It only holds the built extension (`dist/chrome`, `dist/firefox`, a userscript). The findings come from the bundled `content_main.js` (4.3 MB, minified but not mangled), `background.js`, `manifest.json`, `request_modifier_rule.json`, and the 566 KB `default_config.json`. That config contains nearly every tuning value, provider setting, prompt, and its 801 per-site rules.
- **Verdicts**: run through the five-advisor "LLM Council" (independent advisors, anonymous peer review, then a chairman's summary). After that, the key claims were checked against Prism's real code. Where a check contradicted an advisor, the checked fact wins.
- **Caveat**: neither extension was run on live pages. Speed and quality verdicts are judgments about mechanisms, not measurements. Phase 1 of the plan exists to close that gap.
- **Clean-room rule**: IT is closed source. Take its *ideas* only. Never paste its prompts, regexes or site rules into Prism.

## Verdict table

| # | Mechanism | Better | Action for Prism |
|---|---|---|---|
| 1 | Content discovery | IT, for skip lists | **Adapt** regex skip patterns (written fresh, with a counter). **Don't copy** the site rules, nav skipping or main-content guessing. |
| 2 | Inline formatting | IT, in principle | **Adapt**: experiment with sending paragraph HTML to `translateHtml`. No full rewrite. |
| 3 | Display (bilingual) | Tie for Prism's audience | **Already have** hover-to-see-original. **Defer** bilingual mode. |
| 4 | Scheduling / laziness | IT | **Adapt**: lazy for LLM providers only; keep visible-first whole-page translation for free Google. |
| 5 | Dynamic content | Tie | **Already have.** |
| 6 | Providers & prompts | IT on resilience, Prism on integrity | **Adapt**: page title and glossary in the LLM prompt, plus a plan for when the Google key stops working. **Don't copy** header spoofing, 60 providers, or aiBatch. |
| 7 | Throughput / rate limits | Tie | **Don't copy.** IT's request rates would raise ban risk on the shared key. |
| 8 | Failure handling | Prism on visibility, IT on fallback | **Adopt** a budgeted LLM→Google fallback. **Don't copy** "toast only after 20 errors". |
| 9 | Caching | Tie, but Prism has a bug | **Fix** the cache key (live bug, below). **Adopt** a 30-day max age. |
| 10 | Scope / injection | Prism, for its size | **Don't copy.** |
| 11 | Language detection | IT | **Adapt**: skip pieces already in the target language via `i18n.detectLanguage`, with a minimum length, a counter and an off switch. |

## Mechanism details

### 1. Content discovery: what gets translated
- **Prism** walks every Text node, including open shadow roots. It skips code, `pre`, icon fonts, KaTeX and text with no letters. `grouping.ts` then joins nodes that share a block ancestor into pieces of up to 2000 characters, cutting at sentence ends where possible. Tag clusters (`#tag`, `@mention`) and link clusters are kept as separate pieces. Attributes and the tab title are translated by their own subsystems.
- **IT** works on paragraphs and blocks. It decides what counts as one using:
  - large tag lists: `inlineTags`, `allBlockTags`, `stayOriginalTags` (CODE, SUP, SUB, IMG, MathML)
  - minimum lengths: `paragraphMinTextCount` 2, `blockMinTextCount` 24
  - main-content detection: `bodyRule`, which looks for an article, at least 4 `<p>`, at least 800 characters
  - `preTranslateLimiter`, which skips header and nav by default
  - `noTranslateRegexp` and `excludeRegexps`, which skip timestamps like "3 min ago", single letters, emails and file paths
  - **801 per-site rules**, fetched remotely, that patch the cases where all of the above misfires
- **Verdict**: the regex skip list is a cheap, visible win. Usernames, emails and paths that get mangled are embarrassing. The heuristics only work because the site rules patch their failures, and one maintainer cannot keep a rules feed going. Skip lists can fail silently, so count how often they fire and let users turn them off.

### 2. Inline formatting
- **Prism** keeps each Text node as its own string. On Google, a piece goes out as segments tagged `<a i=N>`; on an LLM, as segments joined with `␟`. Results are written back node by node. A defensive stack (`reflowIntegrity.ts`, `outputSanityCheck.ts`, repair retries for individual pieces) exists because Google reorders or merges those markers.
- **IT** uses "rich translate". It turns a paragraph into one string, replacing inline elements with placeholders that differ by provider: `{0}`, `<b0>`, `{{0}}`, `@0#`. It translates that string, then rebuilds the DOM with the original elements, so links keep their `href` and event listeners. IT turns this **off** for LLMs in bilingual mode (`dualEnableRichTranslate: false`).
- **Verdict**: the First Principles Thinker argued that node-level splicing is the root cause of Prism's guard stack. The Executor and the Contrarian countered that the guards are already paid for, and that even IT can't make placeholders reliable with LLMs. **Middle path**: Prism already calls the HTML-capable `translate-pa.googleapis.com/v1/translateHtml` endpoint, the same one IT uses. Sending real paragraph HTML with inline tags could get most of the benefit without a rewrite. Run it as an experiment checked against the test corpus.

### 3. Display
- **Prism** replaces text in place, and it can be restored.
- **IT** defaults to `translationMode: "dual"`. It inserts a `<font class="immersive-translate-target-wrapper">` after each paragraph, offers about 15 visual themes, and handles RTL and dark mode. It also has a translation-only mode, with per-URL and per-language patterns.
- **Verdict**: the Expansionist ranked bilingual mode first, as the feature language learners choose IT for. Every reviewer called that the council's biggest blind spot. Bilingual mode is a second rendering engine: it touches restore bookkeeping, dynamic-content tracking and CSS, and inserted wrappers are the classic cause of broken layouts. Prism already shows the original on hover (`components/hoverTooltip/`), which covers the "what did this say?" need. **Defer.** If it ever gets built, build one style only.

### 4. Scheduling and laziness
- **Prism** translates the whole page, moves visible blocks to the front of the queue (`viewportPriority.ts`), and sends 300 pieces per tick.
- **IT** translates about 5000 characters immediately (`immediateTranslationTextCount` 4999). After that it uses IntersectionObservers with a rootMargin reaching about 2 screens below the viewport (`visibleObserverScreens [0,0,2,0]`, plus a deferred-render margin of `35%`). Content far off-screen is never requested.
- **Verdict**: IT is better, mostly because of **cost for LLM users**. Translating a 40,000-word page you only skimmed shows up on your bill. For free Google, whole-page translation keeps Ctrl+F, printing and restore working. So make it lazy for paid providers only, and reconcile that with the 30-second overall deadline and restore.

### 5. Dynamic content (SPAs, infinite scroll)
- **Prism** uses a MutationObserver on childList and characterData, O(1) dedupe, and an adaptive resweep that backs off from 1.5 s to 10 s.
- **IT** uses a MutationObserver with 100 ms consume and build timeouts, `paragraphStableWindow` to wait for text to settle, exclude selectors for highlighters, URL-change detection, and per-site blocklists.
- **Verdict**: a tie. Consider a 100–300 ms settle window only if users report flicker or double translation.

### 6. Providers and prompts
- **Prism** has three providers:
  - Google's web endpoint, using a scraped key with a hard-coded fallback
  - Google Cloud Translation, with the user's own key
  - any OpenAI-compatible LLM, sent as a numbered list with a JSON array expected back
- **IT** offers about 60 services, including Bing, DeepL, Yandex, Chinese MT engines, about 40 LLM vendors, and its own paid proxy. Its LLM batching ("aiBatch") sends 8 items per request (up to 32), each starting with an id line and closed by a `[[source_end]]` terminator; ids may come back in any order. Prompts have slots for page title, an AI-generated summary, glossary and style guide, and some languages get their own system prompt. Temperature is 0. IT also uses declarativeNetRequest rules to rewrite Origin and Referer, impersonating `deepl.com` and other extension IDs.
- **Verified**: Prism's hard-coded fallback key is **byte-identical** to IT's Google `publicKey`. But IT's default service is **Bing**, so its out-of-the-box path doesn't depend on that key alone. Prism's does, and Prism has no way to ship a hot fix without a store release.
- **Verdict**:
  - **Adapt**: page-title and glossary slots in the LLM prompt.
  - **Don't copy**: aiBatch, since Prism's numbered-list→JSON format already covers it.
  - **Never copy**: header impersonation.
  - Prism also scrapes a key for an undocumented endpoint, so be careful about marketing it as "no impersonation".

### 7. Throughput and rate limits
- **Prism**: at most 6 concurrent requests per provider, 2000 characters per batch, a 20 s timeout, 3 attempts, and a 30 s overall deadline.
- **IT**: a token bucket per service (Google 20 requests/s, Claude 0.3/s), a concurrency limit of 50, up to 50 paragraphs per request for Google and DeepL (4 for LLMs), and a 300 ms debounce.
- **Verdict**: don't copy IT's numbers. They would raise the odds that Google bans the shared key. Add a token bucket only if 429 errors show up.

### 8. Failure handling and quality checks
- **Prism** has output sanity checks, reflow integrity checks, a repair pass, and visible offline vs provider errors. The visible errors were added after a real incident where failures were silent.
- **IT** has `recoveryPolicy: budgeted_fallback`: at most 2 recovery requests, then it falls back to an MT service. It also has `sameLangCheck` and `aiTranslatedCheck`, and only shows an error toast after **20 or more** errors.
- **Verdict**: adopt the budgeted LLM→Google fallback. Both providers already exist, so it's a routing change. Keep Prism's visible errors.

### 9. Caching
- **Prism** uses IndexedDB with a 5 MB LRU and batched transactions. **Verified live bug**: the cache key is `${providerId}>${source}>${target}:${text}` (`translationCache.ts:379`), and for LLMs `providerId` is just `'llm'`. If a user switches LLM model or endpoint, Prism keeps serving the **old model's** cached translations, with no error.
- **IT** uses IndexedDB with a 30-day max age and a daily cleanup.
- **Verdict**: fix the key first. Include the model and base URL, plus any future prompt context. Then add a 30-day max age.

### 10. Scope and injection
- **Prism**: about 13k lines of TypeScript and a CI-enforced engine with no browser-API imports. Content scripts run in all frames, but features run in the main frame only.
- **IT**: a 33 KB `content_guard.js` runs at document_start in every frame and loads the 4 MB `content_main.js` when needed. On top of page translation it has PDF, EPUB, subtitles, manga and image OCR (tesseract and onnx wasm), input-box translation, a side panel, telemetry, and remote config and upsell.
- **Verdict**: don't copy any of this. Prism's engine purity is an asset of its own: the engine could later become a library, a userscript, or a reader plugin.

### 11. Language detection
- **Prism** already detects the page language (`originalLanguageTracker.ts`, using `i18n.detectLanguage` and `tabs.detectLanguage`, both cross-browser) to decide whether to auto-translate. It does **not** skip individual pieces that are already in the target language.
- **IT** weighs page-level detection across html, body and tab, can optionally detect per paragraph, and uses LanguageDetector, franc and cld as fallbacks. It skips text already in the target language before sending it.
- **Verdict**: adapt it as a per-piece skip using `i18n.detectLanguage`, which also works on Firefox. Set a minimum length, since detection is unreliable on short text, and add a counter and an off switch. This also cuts request volume to the fragile Google key.

## Council summary

- **Agreed by all five**: never copy IT's scale machinery (site rules, 60 providers, spoofing, OCR/telemetry). Same-language skip and LLM fallback are cheap wins, laziness beats eager translation for paid providers, and errors stay visible.
- **Disagreements**:
  - bilingual mode: the Expansionist vs everyone else. Deferred.
  - rich translate rewrite: the First Principles Thinker vs the Executor and the Contrarian. Resolved as an experiment on `translateHtml`.
  - measure first or ship first: resolved as cheap fixes now, expensive bets gated on the test corpus.
- **Strongest advisor**: all five reviewers picked the Contrarian. It found the single-key failure point, the cache-key bug, and the risk that copying IT's request rates gets the key banned.

## Plan, in priority order

**Phase 0: correctness and resilience**
- [S] Put the LLM model, base URL, and any future prompt context into the cache key. This is a live bug.
- [S] When the Google key is rejected (scrape and fallback both fail), show an error that names that cause specifically, not a generic provider error.
- [S] Add a 30-day max age to the cache.

**Phase 1: measure**
- [M] Build a fixed corpus of about 20 hard pages: SPA, news, docs, forum, RTL, link-heavy. Score Prism and IT on time to first visible translation, quality, and layout breakage.

**Phase 2: cheap wins**
- [S] Regex skip patterns, written fresh, with a counter.
- [S–M] Per-piece same-language skip via `i18n.detectLanguage`.
- [S] Page title and an optional glossary in the LLM prompt. Needs Phase 0's cache-key fix first.
- [S] Budgeted LLM→Google fallback.

**Phase 3: bets that depend on the corpus results**
- [M] Laziness for LLM providers only, reconciled with the 30 s deadline and restore.
- [M] Paragraph-HTML experiment on `translateHtml`.

**Phase 4: a second free path**
- [M] Bring back Chrome's on-device Translator as a fallback only, behind an availability check. It was removed in beta.9–13 after it failed for a user, so it can't be the primary path. Alternatively, make the fallback key updatable without a store release.

**Deferred**: bilingual mode (L).

**First step**: fix the cache key in `src/platform/cache/translationCache.ts` and the call site in `entrypoints/background.ts`, and ship it as the next beta.
