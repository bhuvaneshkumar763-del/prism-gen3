---
"prism-gen3": patch
---

**Word-per-word chapters come out as real sentences.** Some reader sites (sangtacviet.vip in Vietnamese mode) wrap every word of a chapter in its own `<i>`, with the punctuation between them as bare text. Prism sent those 100+ fragments to Google as one multi-item piece, and Google moved words across fragments and paragraphs, so the chapter came back scrambled. Each paragraph of such a block is now sent as one string, punctuation included, written into its first word, and the rest of the paragraph is emptied; Show original puts every word and comma back. Only blocks of four or more short word elements with sentence punctuation and no other letters are treated this way, so prose, links and menu rows are unchanged.

**Tapping the bubble on a phone no longer leaves its panel open.** Touch browsers keep `:hover` stuck on the last tapped element, and the panel opened on hover. Hover now only opens the panel on devices that really hover; long-press still pins it on touch.
