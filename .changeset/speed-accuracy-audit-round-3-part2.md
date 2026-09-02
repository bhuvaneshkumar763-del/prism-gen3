---
"prism-gen3": minor
---

Round 3's accuracy half (the speed/cache half shipped as beta.34): 7 correctness fixes found via the same 12-angle audit sweep, all verified with revert-and-confirm-fails regression tests.

- **Accuracy — dynamically-added content inside a skip tag was translated anyway.** `mutationWatcher.ts` only checked a mutation's own added node (or, for a text change, its immediate parent) against the no-translate rules — never any ANCESTOR further up. A syntax highlighter rewriting `<code>`'s innerHTML with plain `<span>`s, or a charting library appending `<text>` labels into an existing `<svg>`, both add nodes that are themselves ordinary tags; only some ancestor is the actual skip tag. Now walks the full ancestor chain.

- **Accuracy — KaTeX-rendered math formulas got mistranslated.** Skipping `<math>` only protects KaTeX's hidden, screen-reader-only MathML copy — the visible rendering (`.katex-html`) is plain `<span>`s with no tag-based signal, so `sin(x)` rendered as `<span class="mop">sin</span>...` had "sin" translated as the ordinary English word. `.katex` (the outer wrapper around both renderings) is now skipped as one unit.

- **Accuracy — only 2 of 8 official Material icon-font class variants were recognized.** `material-icons-outlined`, `-round`, `-sharp`, `-two-tone`, and `material-symbols-rounded`/`-sharp` were missing from the list, so a site using any of them got its icon ligature text translated exactly like the two originally-listed classes were meant to prevent.

- **Accuracy — an `<option>` with no `value` attribute could have its form-submission value silently changed.** Per the HTML spec, an `<option>` with no `value` attribute submits its own text as the value — translating that text changes what the form actually submits, not just what the user sees. Now skipped (an `<option>` with an explicit `value` is unaffected either way).

- **Accuracy — a node whose translation kept failing while other content in the same batch kept succeeding could be silently abandoned forever.** The per-node retry cooldown returned early without rescheduling or re-queueing when a retry landed within its own 1.5s window — dropping the node out of consideration entirely, since nothing else (the batch-failure error path only fires when *everything* fails; the resweep backstop only re-adds a node whose content changed) would ever revisit it. Now schedules a real retry once the cooldown actually elapses.

- **Accuracy — a node the page updated in place while its translation was in flight could be silently overwritten with a stale translation.** Write-back only ever checked that the node was still connected to the page — never that its content was still the text that was actually sent. A live-updating node (a score, a streaming chat message) stays connected the whole time, so a translation of now-superseded text could clobber whatever the page had legitimately written in the meantime. Now verifies the sent text still matches before writing, and re-queues for a fresh translation of the current content otherwise.

- **Accuracy — a node that disconnected while its whole batch failed could be permanently stuck untranslated.** Both batch-failure paths correctly filtered disconnected nodes out of the retry queue, but — unlike the success path — never cleared their tracked "last seen" text. A recycled/virtualized-list node reattached later with the same (still-untranslated) content looked unchanged and was never picked back up.

- **Accuracy — the silent-failure detector added in beta.33 had its own false positive.** Any legitimately-unchanged text containing even one incidental non-Latin character — a physics variable like "Δt", a foreign-script proper noun embedded in an English sentence — was wrongly flagged as a translation failure, costing a wasted repair request and retry ticks. Now requires the overwhelming majority of the text's actual letters to be non-Latin, not just the presence of one, while still catching the short non-Latin nav-label case this check exists for.

Deferred to its own round: translating `placeholder`/`alt`/`title`/`value` attributes (TWP does this; Prism currently translates none) — a new collection/write-back/restore pipeline distinct from the existing Text-node engine, scoped out of this round for its own proper design pass.
