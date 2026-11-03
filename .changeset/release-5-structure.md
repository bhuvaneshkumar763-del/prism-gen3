---
"prism-gen3": patch
---

**Release 5: the code's structure, rebuilt behind tests.** Mostly invisible; the visible parts are listed first.

- **Translate and "Show original" now reach embedded frames the same way, whichever control you use.** Before, the bubble's "Show original" left a same-origin embedded frame (comments, a chapter viewer) translated, and translating from the popup, menu or shortcut skipped those frames. Checked in a real browser: the old code fails, the new code passes.
- **Clearer error messages.** The bubble now says what actually went wrong: Google limiting requests, the service being slow, Google changing how it answers (with the advice to switch to Google Cloud in Settings), or the free key not working. Before, almost everything said "Couldn't reach the translation service".
- **Short Vietnamese sentences that come back untranslated are noticed and retried.** Names, titles and genre labels are left alone. The rule was checked against every unchanged line on the three saved pages with zero false alarms, but not yet against a saved sangtacviet chapter.
- **The progress bar no longer disappears** while text that loads after the start of a translation is still translating.
- **A service that is down no longer gets one request per page change**; Prism waits out its retry pause.
- **The translation cache keeps one shared size**, so "Clear translation cache" in Settings takes effect everywhere at once, entries expire after 30 days, and a full disk can't leave a save hanging.
- **Under the hood:** the main translation file is split into smaller tested parts; the background's translation logic and the Settings tabs are separate, tested pieces; a realistic stand-in for Google is used in tests; dead code is removed. Existing tests were kept unchanged wherever behaviour stayed the same.

Checked on: built extension in desktop Chromium (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages; popup by hand; same-origin iframe translate and restore from bubble and popup), plus live free Google, 2026-11-03. iPhone check comes before stable 0.3.2.
