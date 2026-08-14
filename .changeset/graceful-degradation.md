---
"prism-gen3": minor
---

Improved reliability, speed, and accuracy together, with particular attention to flaky or low/no internet connectivity (graceful degradation, not full offline translation):

- **Connectivity awareness** (new `connectivity.ts`): the extension now knows when the browser is offline, skips doomed network attempts instead of burning the retry budget on them, and resumes translation the instant the connection returns instead of waiting for the next scheduled retry.
- **Distinct error states**: the bubble and popup now show a clear "Offline — will resume automatically" state, separate from "the translation service is actually broken" — previously both looked identical.
- **Smarter retry**: added jitter to retry delays (desyncs retry waves during a real provider outage) and extended the backoff so a long-lasting outage backs off further over time instead of retrying at a fixed rate forever.
- **Speed**: translated content now prioritizes what's visible in your viewport first on long pages, and concurrent request limits adapt automatically to a detected slow connection (Chrome only; degrades to the previous fixed behavior everywhere else).
- **Accuracy**: added a bounded, one-shot retry for translation results that look like a silent failure (empty output, or output that's suspiciously unchanged from the input when the languages genuinely differ), catching a class of silent bad translations that previously went straight through unnoticed.
