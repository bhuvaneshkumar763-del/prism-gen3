---
"prism-gen3": patch
---

Security/privacy fix (round-4 audit, item 8): a manual translate in an incognito window wrote the page's source text into the normal profile's on-disk translation cache. Extensions run in "spanning" mode by default — one shared background service worker across normal and incognito windows — so `translatePiecesWithCache` (background.ts) ran identically regardless of which kind of window a request came from; `translationCacheEnabled` said nothing about that. The cache key itself contains the source text, so this persisted content from an incognito session into IndexedDB past that session ending, with no indication to the user it had happened. Fixed by also checking `sender.tab.incognito` (the standard WebExtensions field for this) before either reading or writing the cache — an incognito translate now neither leaks into nor benefits from the normal profile's cache.

While auditing this, the round-4 finding's second half — "although `translationCache.clear()` exists, no UI calls it" — turned out to already be fixed: Settings' Advanced tab already has a working "Clear translation cache" button wired directly to `translationCache.clear()`. No change needed there; noted here so it isn't re-flagged in a future audit.
