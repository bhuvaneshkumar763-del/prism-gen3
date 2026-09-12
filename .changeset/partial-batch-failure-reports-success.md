---
"prism-gen3": patch
---

Reliability fix (round-4 audit, item 3): a partial provider outage could report success while silently leaving whole regions of a page untranslated, with no error ever shown.

Failure detection was all-or-nothing: a translate tick splits into many HTTP sub-requests, and a rate-limited or degraded provider's normal shape is a *mixed* result — some pieces land, some don't. Whenever even one piece in a tick succeeded, the failure counters and any already-surfaced error were unconditionally reset to zero, so a genuine, ongoing partial outage could never accumulate toward the threshold that surfaces a "Translation failed" message. The failing pieces still ran through the existing bounded (give-up-after-3) per-node retry in the background and were eventually abandoned — but with the error state wiped every single tick, that abandonment produced no visible signal at all: the busy indicator clears, the bubble shows the normal green "translated" state, and the untranslated regions just... stay that way.

Now the counters only reset on a tick with no genuine (non-`suspicious`) failures — a batch that's fully successful, or one whose failures are all confirmed-suspicious (Google declining to translate a language's own name written in its own script, an already-handled case), still resets exactly as before. A batch with any real network/HTTP/parse failure now correctly counts toward surfacing an error, the same way a fully-failed batch already did.
