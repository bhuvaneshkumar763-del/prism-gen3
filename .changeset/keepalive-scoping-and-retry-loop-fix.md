---
"prism-gen3": minor
---

Two fixes, shipped together: a planned speed follow-up from round 3, and a serious live regression found while verifying it.

- **Speed — the keepalive alarm ran unconditionally for the whole browser session.** `entrypoints/background.ts`'s `chrome.alarms` keepalive ping used to be created once at extension startup and left running forever — waking the MV3 service worker every 24 seconds (~2,880 times a day) even for a user who never translates anything. It's now scoped to actual translate activity: created when a translate request starts, self-clearing once none are in flight.

- **Reliability — a batch that Google correctly declined to translate could retry against its endpoint forever.** A round 3 accuracy fix widened detection of "this response looks like an untranslated echo" — correctly, but a real, successful response for content Google legitimately leaves untranslated (a language's own name written in its own script, as seen on Wikipedia's language-switcher sidebar) keeps looking exactly like that failure signature on every retry, since a working provider returns the same result every time. The page-translation loop didn't distinguish that from a genuinely broken provider, so it retried the whole batch unconditionally, forever, every tick — an unbounded request loop against an endpoint that was never actually down. A batch confirmed to be in this state now falls back to the existing bounded (give-up-after-3) per-node retry instead of retrying forever; a batch with a real network/HTTP failure still retries unconditionally, exactly as before.

Both verified against real, live behavior — the keepalive scoping via `chrome.alarms.getAll()` sampled over real wall-clock time and a real triggered translate; the retry-loop fix via a real Wikipedia page, confirming request volume to Google's endpoint plateaus instead of growing without bound.
