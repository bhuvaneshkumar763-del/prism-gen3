---
"prism-gen3": patch
---

Reliability fix (round-4 audit, item 2): clicking "Show original" while a translation had a retry pending could permanently spin the translation loop and lock the "Translate page" button disabled — a real bug on any page with even one piece that keeps failing (the repo's own X.com/Wikipedia-endonym cases).

`noteMissingResult`'s cooldown-retry timer (a plain `setTimeout`, not tied to the translate cycle it was scheduled under) carried no check of its own. If it fired after `restorePage()` had already emptied the queue and moved the page back to "original", it re-pushed the node into the just-emptied queue anyway — but neither of the tick loop's real work branches ever run outside the "translated" state, so nothing could ever drain it, leaving the page permanently rescheduling itself and the bubble stuck showing "Translating…" with its primary button disabled.

Also fixed two closely related bugs found in the same function while working on this:

- `restorePage()` never reset the "busy" signal at all — any restore while a genuine retry was still pending (the ordinary case whenever a batch has even one failing piece) left the bubble stuck on "Translating…" even without the timer race above.
- A node whose cooldown-retry timer fired after it had been recycled off-DOM (a virtualized/recycled list) lost its only remaining lifeline back into the queue when it reappeared with the same still-untranslated text, staying stuck forever with no error shown.

All three verified independently via revert-and-confirm-fails.
