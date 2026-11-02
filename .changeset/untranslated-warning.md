---
"prism-gen3": patch
---

**A page that came back untranslated now says so.**

- **A few untranslated paragraphs no longer pass as success.** When Google sends text back unchanged, Prism retries each piece three times and then gives up. It used to give up silently, which is right for a handful of language names, but when the text given up on is a quarter or more of the page (and at least 200 characters) the bubble now says "About N% of this page came back untranslated". It doesn't slow or stop translation.
- **A run of echoed text is named correctly.** When so much text comes back unchanged that Prism decides the service is failing, the bubble used to say "Couldn't reach the translation service". The service was reached; it now says it keeps sending text back untranslated.
- **New Settings switch: translate each paragraph as a whole.** On by default, as before. Turn it off (Settings → Page translation → Content handling) if a page comes out with words moved between links or styled text, or chips and tags run together; each piece of text is then sent on its own, with no update needed.
