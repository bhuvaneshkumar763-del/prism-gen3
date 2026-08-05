---
"prism-gen3": patch
---

Reverted the bubble hover-panel change from the previous release — it was a misdiagnosis of a different, unrelated Android issue the user actually reported. `components/bubble/bubbleStyles.ts` is back to exactly what it was before. The real cause of the reported "table of translation options on top of the bubble" on Android is still open.
