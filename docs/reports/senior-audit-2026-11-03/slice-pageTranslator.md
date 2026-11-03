# Slice: page-translation engine (`src/engine/pageTranslator/`) — Grade B− (correctness B, maintainability C)

_Read every non-test line (translateLoop.ts 1,481 lines, plus grouping, collectTextNodes, attributeTranslator, titleTranslator, mutationWatcher, resweep, autoTranslateDecision, viewportPriority, tagText, boundaryText, dedupe). 287 tests pass._

## Top findings
- **Med NEW, R1-1 regression** boundaryText.ts:6, 27-32; translateLoop.ts:796: `NOT_CARRIED` lacks `（ 【 ( [`. `（本章完）` comes out as `（(End of this chapter)`. **Hand-verified** by running `restoreBoundaryText`: `【` + `[Chapter 1]` gives `【[Chapter 1]`.
- **Med NEW** translateLoop.ts:701, 715-722; grouping.ts:333-342: `MAX_PIECES_PER_TICK` (300) counts nodes. A word-per-element sangtacviet chapter is one block, so it's cut every 300 word nodes and neither half gets the boundary punctuation. About 1,500 nodes means 5 ticks in a row and about 4 split sentences. No test covers more than 300 word nodes. (mechanism read-verified, quality impact reasoned)
- **Low-Med KNOWN + new path** translateLoop.ts:471, 1204, 1268: `wakeRoutine()` cancels the error backoff, and an orphaned 0 ms timer inside a tick also clears it. A down provider plus a mutating page means one request per mutation.
- **Low-Med NEW** translateLoop.ts:834, 877, 887-890, 375: `translatedChars` counts only a word run's head node, so the denominator is about 10x too small on sangtacviet. About 200 characters of echoed names can trigger "About 60% of this page came back untranslated" on a fully translated chapter.
- **Low NEW** translateLoop.ts:915-924, 1096-1103: the catch path requeues nodes already written by `onPieceComplete`. On iOS a killed background re-translates English output and sends `''` pieces.
- **Low NEW** translateLoop.ts:1443-1446: the hover original for a word run is only its head word.
- **Low KNOWN:** `totalPieces` is fixed per cycle, so the progress bar vanishes early on AJAX chapters. The four attribute-translator bugs are still present. Attributes in shadow DOM are never collected (collectTextNodes.ts:393). The attribute observer starts late. The title translator has no generation guard, so a fast chapter skip shows the wrong title. Restore skips detached nodes. Retry counters aren't reset between cycles. `translate="NO"` is case-sensitive.
- **Fixed since beta.70:** ReDoS in `PURE_TAGS_RE`; `¿ « 「` stripping (`restoreBoundaryText`, 13 tests, but this fix introduced the `（` regression).

## Design
- **Praise:** browser-API-pure engine behind an injected `Translator`; generation guards; `sentText` staleness check; an always-schedule-a-successor `finally`; WeakSet dedupe; iterative shadow-aware walks; pure exported helpers; thoughtful silent-failure handling.
- `createPageTranslator` is one ~1,360-line closure with ~25 mutable variables, and `runTranslationTick` is ~530 lines. Split it into a scheduler, write-back, a pure error/backoff state machine, and progress.
- 834 of translateLoop's 1,481 lines are comments, including 32 "Real bug, found via…" narratives. Four cross-references are stale, and tagText.ts:65 points at CLAUDE.md.
- Timers have no single owner. Use one `schedule(delay)` that always clears, with backoff as a floor.
- Error state is spread over six variables; an explicit state type would make "what does the bubble show" checkable.
- The attribute and title translators re-implement staleness, generation and retry more weakly. Requeue and failure-surfacing blocks are each written twice.
- grouping.ts stacks five numbered isolation rules with magic thresholds (24, 4, 40, 10), and `BLOCK_TAGS` misses UL/OL/TABLE/custom elements. "Is grouping worth it?" is the right question.

## Tests
- Strong: 287 tests on a real happy-dom DOM that reproduce real races; nearly every fix has a regression test.
- Weak: 69 real-clock `waitFor` calls, so there's flake risk and backoff and timers are effectively untested. The uppercase fake translator can't model Google (turning `（` into `(`), which is how the bracket regression slipped through.
- Gaps: word runs over 300 nodes, word-run character accounting, catch after a partial write, shadow-DOM attributes, and the attribute, title and progress races.

## Verdict
It works and it's defensive, and the core concurrency ideas are sound. But it reads like an incident log, not a design. The newest work (word runs, boundary punctuation) fixed the reported cases and created new edge bugs on the very pages the owner reads, which a realistic provider fake would have caught.
