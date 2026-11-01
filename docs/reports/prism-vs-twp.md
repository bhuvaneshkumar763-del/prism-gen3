# Prism vs TWP – Translate Web Pages: mechanism-by-mechanism comparison

_2026-11-01 · Prism 0.3.0-beta.70 (commit fed8806) vs TWP 10.2.1.0 (github.com/FilipePS/Traduzir-paginas-web, commit 50a9211, 2026-08-16)_

**Status: analysis and plan only. No code was changed.** Companion to [prism-vs-immersive-translate.md](prism-vs-immersive-translate.md).

## Why this comparison is different

TWP is Prism's grandparent. Prism's old repo began as a fork of TWP, and Prism is a from-scratch rewrite of that fork. The project rule is that TWP-lineage code is reference only and never copied. Several TWP designs carried over into Prism as ideas, not code:

- Google's `translateHtml` endpoint, with `<a i=N>` index tags
- the scraped Google key
- hover to show the original
- translation of attributes and the tab title

So on most of the core pipeline, Prism is TWP's design plus guards added after real incidents. The useful question is narrower than "who wins": what real-world knowledge does TWP hold that Prism lacks?

## How this was done

- **TWP**: open source (MPL-2.0), plain JS, about 13k lines, no tests. The main files read were `src/contentScript/pageTranslator.js`, `src/background/translationService.js`, `src/background/translationCache.js`, both manifests, and `src/contentScript/deepl.js`.
- **Prism**: read from source, with the same files as the Immersive Translate report plus `entrypoints/content.ts` and the ADRs.
- **Verdicts**: run through the five-advisor council. Every claim the council disputed was then checked against the real code. One claim that all five reviewers had praised turned out to be **wrong**: that Google returns one detected language per batch. It returns one per piece (see #11).
- **Caveat**: neither extension was run on live pages, and TWP's issue tracker was not mined. Both are in the plan.

## Verdict table

| # | Mechanism | Better | Action for Prism |
|---|---|---|---|
| 1 | Content discovery | Prism | **Already have**, including `notranslate` / `translate="no"` |
| 2 | Wire format, inline formatting | Prism | **Already have.** Measure payload size vs reflow. **Don't bring back** the trailing space. |
| 3 | Display | Tie | **Adapt** `showTranslated` (hover to see a translation). Selection translation and hover-original already exist. |
| 4 | Scheduling | Split | **Adapt**: pause while the tab is hidden. Lazy loading for LLMs only. |
| 5 | Dynamic content | Prism | **Already have** |
| 6 | Providers | TWP on redundancy, Prism on quality | **Don't bring back** Bing, Yandex or the DeepL tab robot. **Adapt** the *principle* of a second free path. |
| 7 | Batching, throughput | Prism | **Already have** |
| 8 | Failure handling | Prism | **Already have** |
| 9 | Caching | Prism | **Already have** (the cache-key fix is still pending) |
| 10 | Custom dictionary | TWP | **Adapt** |
| 11 | Language detection | Tie | **Already have** |
| 12 | Scope, platform | Prism on engineering, TWP on locales | **Adapt** locales. **Don't bring back** cross-origin frames, TTS, the PDF viewer, or the 3-language hotkeys. |

## Mechanism details

### 1. Content discovery
- **TWP** walks the DOM recursively, including shadow roots. It builds pieces from text nodes that share their nearest non-inline ancestor, and hard-splits at 1000 characters with no sentence awareness. It honors `notranslate` and `translate="no"`.
- **Prism** groups by block ancestor, up to 2000 characters, preferring to cut at sentence ends. Tag and link clusters are kept as separate pieces. Prism also honors `notranslate`, `translate="no"` and contentEditable (`collectTextNodes.ts:192`, `:358`).
- **Verdict**: Prism is better. Nothing to import.

### 2. Wire format and inline formatting
- **Both** send a piece's text nodes as `<a i=N>` segments to `translateHtml`. TWP wraps them in `<pre>`, has a `dontSortResults` option (evidence that it also hit reordering), writes back with `textContent`, and appends a **trailing space to every node**.
- **Prism** adds `reflowIntegrity.ts`, `outputSanityCheck.ts`, and a contained `needsRepair` path that re-sends a scrambled group as single items.
- **Reflow history, verified**:
  - The beta.9–13 corruption was **language-pair dependent**: en→zh broke, en→fr was clean.
  - Prism removed Google grouping, then re-enabled it after beta.37 because one node per piece destroyed context. In "She left the party", "left" was translated as the direction.
  - The repair path was added at the same time.
  - Whether reflow gets worse with piece size (Prism 2000 vs TWP 1000) has **never been measured**.
- **Verdict**: Prism is better. Run the cheap experiment below. Never bring back the trailing space.

### 3. Display
- **Both** replace text in place and restore it, and both show the original on hover. **TWP** also has `showTranslated.js`: hover a paragraph to see its translation without translating the whole page. **Prism** has selection translation with copy (`components/selection/`), but not hover-to-translate.
- **Verdict**: a tie. `showTranslated` is a cheap entry point that can reuse Prism's tooltip.

### 4. Scheduling
- **TWP** is strictly lazy. `translationRoutine` runs **every 300 ms, forever**, calls `getBoundingClientRect` on every untranslated piece, sends only pieces whose edge is inside the viewport (no margin), and **pauses while the tab is hidden**.
- **Prism** translates the whole page, visible blocks first.
- **Council split**:
  - The Contrarian and the Expansionist wanted laziness for Google too, to cut load on the key.
  - The Outsider, the First Principles Thinker and the Executor said whole-page is what users expect: Ctrl+F, copy and print work, and nothing flashes untranslated while scrolling.
- **Verdict**: keep Google eager. Take TWP's hidden-tab pause. Lazy loading for LLMs only, as already planned, using IntersectionObserver with a margin rather than polling. The reviewers added a privacy argument: laziness sends less unseen text to the provider.

### 5. Dynamic content
- **TWP**: a MutationObserver, plus a 2-second interval and linear-scan dedupe. It doesn't watch characterData, so text that changes inside an existing node (live scores, chat) stays in the original language.
- **Prism**: childList and characterData, O(1) dedupe, and an adaptive resweep.
- **Verdict**: Prism is better.

### 6. Providers
- **TWP**: Google (same endpoint and key trick), Yandex (scraped SID), Bing (Edge auth token), DeepL by **driving a real deepl.com tab** that types into DeepL's textarea, and a custom LibreTranslate. Users can switch service with a hotkey. All services share one `Service` base class.
- **Prism**: Google web, Google Cloud (user key), and an OpenAI-compatible LLM. Prism already has a uniform `Translator` interface and a shared `batchedHttpProvider`, so TWP's `Service` class adds nothing.
- **Key insight**: TWP and Prism depend on the same scraped Google key. TWP users can switch to Bing or Yandex when it breaks. A fresh Prism install with no LLM key has nothing, and an LLM→Google fallback lands *on* that key, so it doesn't count as resilience.
- **Verdict**: don't bring back the scraped Bing or Yandex endpoints (ADR 0004 quality ceiling, Web Store and ToS exposure) or the DeepL tab robot (ADR 0005: fragile, and looks like malware). Prism does need *a* second free path, but it must not be another scraped endpoint. The candidates from the Immersive Translate plan still apply: Chrome's on-device Translator as a fallback behind an availability check, or a fallback key that can update without a store release. ADR 0005 also calls the official DeepL Free API (user key) a trivial addition.

### 7. Batching and throughput
- **TWP**: requests of at most 800 characters, all fired at once via `Promise.all` with no concurrency cap and no retry. It dedupes in-flight requests.
- **Prism**: at most 6 concurrent requests, 2000 characters per batch, 3 attempts, a 30 s deadline, and in-flight dedupe.
- **Verdict**: Prism is better.

### 8. Failure handling
- **TWP**: `console.error` only. Failed pieces stay untranslated with no signal to the user.
- **Prism**: visible offline vs provider errors (added after its own silent-failure incident), sanity checks, and repair.
- **Verdict**: Prism is better. Never regress.

### 9. Caching
- **TWP**: one IndexedDB database per service and language pair. No automatic cap or expiry; users clear it by hand on the options page.
- **Prism**: a single database with a 5 MB LRU, batched transactions, and skipped in incognito.
- **Verdict**: Prism is better. The live LLM cache-key bug from the Immersive Translate report still applies.

### 10. Custom dictionary
- **TWP**: users define a dictionary. Keywords are replaced with `@%…#$` placeholders before sending, or Bing's native `<mstrans:dictionary>` markup, and restored afterwards with case preserved.
- **Prism**: has none.
- **Verdict**: TWP is better, and this is Prism's one real capability gap. For LLMs, put the glossary in the prompt (already planned). For Google, TWP's clean path was Bing's markup, which Prism doesn't have. Placeholders are likely to trip `reflowIntegrity` and the length-ratio check. Ship only a narrow "never translate these names" list for Google, with tests against the guards. A full replacement dictionary stays unsolved for Google.

### 11. Language detection
- **Both** use `tabs.detectLanguage`, falling back to `i18n.detectLanguage` on a page text sample.
- **Verified**: Google returns `detectedLanguage` **per piece** when the source is `'auto'`. TWP parses `response[1][index]`, and Prism's `google.ts:364` does the same and already feeds it into `outputSanityCheck`. It arrives *with the response*, so it can't save a request. A skip that cuts requests still needs local detection before sending, which the Immersive Translate plan already covers.
- **Verdict**: a tie. Prism already has it.

### 12. Scope and platform
- **TWP**: MV2 for Chrome as well as Firefox (verified in `src/chrome_manifest.json`), and Chrome has removed MV2 support. It translates all frames, cross-origin included. It has 40+ UI locales via Crowdin, plus TTS, translate-document, a PDF viewer site, a mobile popup, and hotkeys for 3 target languages.
- **Prism**: MV3. It translates the main frame and **same-origin** sub-frames (frame-language relay since beta.37, iframe restore since beta.48). It deliberately skips **cross-origin** frames. English-only UI (ADR 0007).
- **Verdicts**:
  - **Locales**: TWP is clearly better. A translation tool whose popup and error messages are English-only works against its own purpose. ADR 0007 already accepts the TWP-lineage 43-locale string values as a bootstrap corpus. TWP is MPL-2.0, and copying code is neither allowed by Prism's rule nor needed.
  - **Cross-origin frames**: keep skipping them. Login, payment and webmail frames are usually cross-origin, so translating them would send that content to Google. Revisit only on a user report, as an opt-in per site.
  - **Migration**: whether TWP's Chrome listing still works for users wasn't checked. Don't plan around TWP users moving to Prism.
  - **Stale docs**: the out-of-scope list's "Iframe support… main-frame only" entry is out of date. Same-origin frames are translated. Its "element-attribute translation not built" entry is also out of date, because `attributeTranslator.ts` exists.

## Council summary

- **Agreed**: Prism wins on #2, #5, #7, #8 and #9, and every guard came from a real incident. Never bring back the DeepL tab robot, the trailing space, silent failure, or the unbounded cache. The glossary is the one real gap. If laziness is built, use IntersectionObserver, not polling.
- **Disagreements**:
  - **Laziness for Google**: keep Google eager.
  - **Is the LLM→Google fallback enough resilience?** No.
  - **Locales**: the Outsider wins, so do them.
  - **Does payload size cause reflow?** Measure it.
  - **The Expansionist's TWP-migration thesis**: unverified, so don't plan on it.
- **Strongest advisor**: the Contrarian, picked by all five reviewers for spotting the shared single key. But its claim about `detectedLanguage` was wrong.
- **What every advisor missed**: TWP's issue tracker as real evidence; privacy (laziness and frame gating as privacy controls); Web Store risk from scraped keys; licensing.

## Plan

**Phase 0: carried over from the Immersive Translate plan, not re-planned**
- Cache-key fix (S)
- Local same-language skip (M)
- LLM-only laziness (M)
- LLM→Google fallback (S)
- Glossary in the LLM prompt (S)
- Second keyless path (L)

This comparison changes one thing: the second keyless path **must not** be another scraped endpoint, and the LLM→Google fallback doesn't count as resilience.

**Phase 1: cheap additions from TWP**
- [S] Pause translation while the tab is hidden (`visibilityState`).
- [S] Reflow vs size experiment: en→zh, ja and ko at 500, 1000 and 2000 characters per piece. If size matters, lower `maxGroupChars` for those pairs only.
- [S] Mine TWP's GitHub issue tracker for recurring Google-endpoint and real-page breakage.
- [S] Fix the stale out-of-scope entries (iframes, attribute translation).

**Phase 2: reach**
- [L] i18n per ADR 0007, moved up. Error messages and the popup first, from the existing 43-locale corpus.

**Phase 3: polish**
- [M] `showTranslated`-style hover translation, reusing the tooltip.
- [M] A Google "never translate these terms" list (names and brands), with tests against the guards.
- Cross-origin frames: only on a user report, as an opt-in per site.

**First step**: fix the LLM cache-key bug (`src/platform/cache/translationCache.ts:379` and `entrypoints/background.ts:358`), add a test, then run the reflow vs size experiment.
