---
"prism-gen3": patch
---

Fixed three real bugs reported by a user: (1) "Attempt to get a record from database without an in-progress transaction" — a regression in the recent cache speed-up, where the persistent IndexedDB connection could be closed by the browser (much more common on mobile) and every subsequent translate would fail; now transparently reopens, retries once, and cache failures no longer break an otherwise-successful translation. (2) On Android, the bubble's From/To/Service panel got stuck permanently open on top of the page after a tap, since touch devices have no way to "unhover" — the hover-reveal behavior is now scoped to real pointer devices only. (3) The default target language was Spanish; changed to English.
