---
"prism-gen3": patch
---

Fixed a real bug reported by a user and reproduced live against their own X.com/Twitter account: translation would show success (the bubble turned "translated") but do nothing at all, even on a static single-post page with nothing new loading.

Root-caused to two compounding gaps:

- **The bug-detection safety net didn't recognize most Indic and Southeast-Asian scripts.** It already knew *about* Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Sinhala, Lao, Myanmar, and Georgian (they're listed as exempt target languages), but the actual character-range check used to detect "this looks like a silent echo failure" never covered any of their Unicode blocks — only Greek, Cyrillic, Armenian, Hebrew, Arabic, Devanagari, Thai, Japanese, CJK, and Hangul were covered. A Tamil post echoed back unchanged was invisible to the safety net entirely.
- **A page's language is guessed once, for the whole page — not per post.** X.com's own English UI chrome (nav, trending sidebar, footer) dominates the page-level language sample, so a feed full of Tamil/regional-language posts routinely gets guessed as English. When a wrongly-guessed source happened to equal the target language too, the failure was silently treated as a correct no-op instead of a bug. Even where a repair attempt was already built for a piece that looked suspicious, it kept resending the same wrong guessed source language every time instead of ever trying auto-detection.

Both are fixed together: the safety net now recognizes the missing scripts, and its repair path retries a confirmed-suspicious piece with `sourceLanguage: 'auto'` instead of repeating the same guess. Verified live against the reporting user's real, logged-in account — the exact static post that previously showed "translated" with unchanged Tamil text now translates correctly.

Also added Tamil to the target-language quick-pick dropdown — it was entirely missing even though it's one of the languages this fix is specifically about.
