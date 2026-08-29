---
"prism-gen3": patch
---

Fix a real bug reported by a user: novel543.com (and any similarly-structured page) translated only partially, with no error shown — some filter chips and short labels came through while every book title and description stayed in the original language. The cause was a known, previously narrow-scoped gap: Google's endpoint only reliably translates a piece wrapped in `<a i=N>` markers, and that wrapping only kicked in for pieces holding more than one string — a lone string sent bare is unreliable. `titleTranslator.ts` already worked around this for the tab title, but regular page translation didn't, and most real pages end up with plenty of single-node pieces (one `<li>` per nav/filter item, one `<p>` per paragraph). The Google provider now pads every single-string piece with a throwaway second string before sending, and trims it back off the result, so every request lands on the reliable path.
