---
"prism-gen3": patch
---

Speed fix (round-4 audit, item 4): incremental write-back — the feature beta.34 added so translated text appears progressively on the page instead of only once an entire translation tick completes — was silently inert in the real extension, working only inside unit tests.

`translateLoop.ts` passes an `onPieceComplete` callback into `translator.translateBatch(...)` so each piece can be written to the page the instant it resolves. In the real extension, that translator relays the call to the background script over `chrome.runtime` messaging — and a function property cannot survive that structured-clone serialization, so `onPieceComplete` was silently dropped before the message ever left the page. The whole point of beta.34's fix never actually took effect outside a test's in-process mock translator; every real page waited for the entire batch to resolve before showing anything, exactly the behavior that release was written to remove.

Fixed by tagging each translate request with an id, stripping the callback out before sending, and relaying each piece's own completion back to the requesting frame over a dedicated message the instant the provider resolves it — the background script already had this signal internally (it's how the "grouped translation" repair mechanism has worked all along); it just had no way to forward it back across the messaging boundary until now.
