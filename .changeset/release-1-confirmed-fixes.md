---
"prism-gen3": patch
---

**Fix plan, release 1 — the confirmed bugs.** Twelve defects from the line-by-line self-audit (`docs/reports/prism-self-audit.md`), each checked against the code by hand and each fixed with a test that failed first. Then checked on live Wikipedia pages in real Chrome, against the unfixed build.

- **Opening punctuation survives translation.** A Spanish question kept losing its `¿` next to a link ("Are you sure? " → "Estás seguro? "), and Japanese `「` was forced onto English text. The translation's own opening marks are now kept; only a leading ". " or "、" that the translator drops is put back, and never twice. Live: 25 forced `「` on a Japanese page went to 0, and `¿`/`?` and `«`/`»` now balance.
- **Holding the bubble opens its panel without also translating the page**, with a mouse or on touch. Right-click no longer toggles translation.
- **The extension no longer contacts Google at startup** for people who chose an LLM or Google Cloud.
- **`www.` sites can be taken off the always/never lists.** `www.example.com` and `example.com` count as the same site when adding and removing, and adding a site to one list takes it off the other. Settings now says what the code does: never-translate wins.
- **An LLM reply with the wrong number of items no longer puts translations in the wrong places**; the affected pieces are retried one by one. This applies to every provider.
- **LLM requests no longer send `temperature`**, which OpenAI's reasoning models reject.
- **Switching LLM model or endpoint no longer serves the old model's cached translations.**
- **Regional and legacy language codes match** (`zh-CN` = `zh`, `iw` = `he`), so a page already in your language isn't treated as a failed translation, and the popup's language toggle can be switched off.
- **The Google key scraper accepts keys containing `-`.**
- **A crafted run of hashtags can no longer freeze the page.** 80 characters used to block it for 1.3 s; anything up to 500 now takes under 1 ms.
- **Google Cloud sends at most 128 segments per request** (Google's documented limit), and the API key goes in a header instead of the URL.
- **The release workflow no longer leaves its write token in `.git/config`** while dependencies install.

Found while checking on live pages, after the unit tests passed:

- Google translates a leading `。` into `.`, so the first punctuation fix produced `。. Its theme…`. When the translation starts with its own closing mark, that mark now wins.
