---
"prism-gen3": patch
---

**Release 2: the reading bugs from the senior-engineer audit, plus release safety.**

- **No more doubled brackets.** `（本章完）` used to come out as `（(End of this chapter)`, and `【第一章】` as `【[Chapter 1]`. The saved sangtacviet search page had 18 lines like `【 [Trial Rules + …]`; they now read `[Trial Rules + …]`.
- **sangtacviet chapters are no longer cut every 300 words.** A chapter that wraps every word separately is sent in one go, so sentences aren't split in half, and it takes one round trip instead of about five.
- **No false "N% of this page came back untranslated" on those chapters.** Every word of a translated paragraph is now counted, not just the first.
- **Tapping the bubble while its panel is open closes the panel** instead of switching the page back to the original.
- **The bubble's pickers no longer make iOS zoom the page** (16px text on touch screens).
- **Picking a service that still needs its key no longer breaks every page.** The bubble and popup keep the current service and open Settings, where the service and key are set together.
- **Clearer Settings labels.** "Source language" is now "Source language for selected text" (page translation detects the language itself). The paragraph switch says that turning it off also stops sangtacviet's words being joined into sentences.
- **Stable releases now sort above their own betas** in Chrome and Firefox, so the next stable release can't break the way 0.3.0 did. One shared rule (`src/shared/manifestVersion.ts`) feeds both the build and the Mozilla lookup.
- **A daily check of free Google** (`npm run test:live`, run every morning by the Google canary workflow): a failed run means Google changed something, before it shows up as an untranslated chapter.
- **Rules for every AI session** at the top of `CLAUDE.md`: a failing test before each fix, no history in comments, pull requests only, one release per batch.

Checked on: built extension in desktop Chromium (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages), plus live free Google, 2026-11-03. iPhone check comes before stable 0.3.2.
