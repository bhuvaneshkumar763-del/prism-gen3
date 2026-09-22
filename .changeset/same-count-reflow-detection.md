---
"prism-gen3": patch
---

**Detect the reflow shape that previously had no detector at all.** The Google provider repairs a grouped piece when the response drops an index or leaks literal `<a i=N>` marker text. The corruption reported on sangtacviet.vip did neither: the entry count was intact and every marker parsed cleanly — Google simply moved content between the indices, so one chip read `System (192673) Fantasy (` and the next read `189348)`. Both existing checks are blind to that by construction. The previous release removed the *trigger* for that page by isolating `<button>` chips; this adds the missing detector, so the same corruption in any other grouped piece is now caught and repaired.

The new check is not a general "does this translation look plausible" heuristic. It tests three structural invariants a correct per-node translation cannot violate, so a violation means content crossed a node boundary rather than merely that the translation was surprising:

- **A node with real words came back empty.** Its share of the response went somewhere else.
- **A node whose source brackets were balanced came back unbalanced.** Only checked when the source node itself was balanced, so a parenthetical legitimately split across inline markup is unaffected.
- **A run of four or more digits in the source is missing from that node's own output.** Compared as a digit stream, so regrouping `1000` as `1,000` still matches; skipped entirely when the provider rendered numerals in another numeral system, where the ASCII run legitimately disappears.

All three were validated against the reported failure before being written, transcribed from the report's own screenshots. The bracket check and the digit check flag **disjoint** node pairs in that data — which is why both earn their place — and neither fires on the same page's known-good translation, which is now a regression test in its own right.

An over-eager answer here costs one extra repair request for that piece, never wrong text: a repair re-sends each node as its own single-string piece, which has no multi-index structure left to reflow across. The checks are tuned with that asymmetry in mind.
