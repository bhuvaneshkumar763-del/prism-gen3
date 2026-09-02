---
"prism-gen3": minor
---

Round 3's biggest remaining items: sentence-context grouping, attribute translation, and a root-caused word-jamming bug.

- **Accuracy — Google translation now sees full sentence context again, safely.** Previously every DOM text node was translated in complete isolation, even when split across inline markup (`<b>`, `<a>`, `<span>`) — a real, measured accuracy cost (verified live: "left" mistranslated as the direction instead of the verb in "She left the party", when translated word-by-word instead of as a whole sentence). Sentence-context grouping is re-enabled, with a new safety net: a grouped response is checked for the exact signature of Google's known cross-node reflow behavior, and if found, immediately and safely repaired via individual per-node re-requests — never flashing corrupted text on screen, and never looping. Found and fixed a real corruption bug during the mandatory live-page verification for this exact class of change (this reopens a risk a previous release had to revert grouping for): a large, citation-heavy group could have its response's internal structure break in a way that spliced literal, unparsed markup directly into the visible page — now detected and repaired the same way.

- **Accuracy — search boxes, image descriptions, button labels, and tooltips are now translated.** Previously untranslated entirely, even on an otherwise fully-translated page.

- **Accuracy — a sentence immediately following a link could jam into the previous sentence with no space or period between them** (e.g. "...world champion Go player. The program..." losing its period to become "...Go playerThe program..."). Root-caused to a real, confirmed Google endpoint quirk: a bare leading punctuation mark with no letter before it is sometimes dropped from the translated output. Now restored deterministically regardless of what Google's response happens to contain.
