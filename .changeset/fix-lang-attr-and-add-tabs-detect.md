---
"prism-gen3": minor
---

Fixed a real bug that could silently disable translation entirely on some sites: an earlier "respect an explicit lang attribute" fix compared every text node's nearest `[lang]` ancestor against the target language, but that walk almost always resolves to `<html lang>` — which most sites set to describe their own UI language, not the actual language of whatever content is being viewed. On pixiv.net specifically, `<html lang="en">` reflects the logged-in user's interface language while a given novel or post can be in any language, so the old check excluded 100% of the page whenever the target language happened to match. Removed the check entirely, matching how TWP (this extension's original inspiration) actually works — confirmed against their live source, which has no equivalent check at all.

Also closed a real gap found while comparing against TWP's real detection flow end-to-end: this project never called `tabs.detectLanguage()`, a background-only browser API that inspects the browser's own view of a tab's actual rendered content — TWP uses it as its primary detection method, falling back to a client-side text-sample heuristic only when unavailable. This project only ever had the fallback. `tabs.detectLanguage` is now tried first (needs no new permissions — verified), with the existing text-sample method kept as the fallback exactly as before.
