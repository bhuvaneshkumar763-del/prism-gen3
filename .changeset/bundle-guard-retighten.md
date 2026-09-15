---
"prism-gen3": patch
---

Bloat audit round 5, release 3 (the small stale items from this round):

- `scripts/check-bundle-size.mjs`'s `MAX_BYTES` was 1MB against a ~286KB Session-8 baseline — that 3.5x headroom is exactly what let `zod` triple itself across bundles (202KB, 51% of the shipped extension) go unnoticed for 51 releases. Retightened to 300KB, ~1.5x the real ~194KB total measured after this round's zod-removal and idle-frame-cost fixes, so a future dependency that grows the bundle meaningfully gets caught instead of hidden in slack.
- `remoteTranslator.ts`'s `TRANSLATE_PIECES_TIMEOUT_MS` doc comment cited a "~62s worst case" for a single `translatePieces` call — true when written, but `batchedHttpProvider.ts`'s `OVERALL_DEADLINE_MS = 30000` (round-4 audit item 5) now bounds one `translateBatch()` call's retry sequence at 30s. The 90s value is still correct (a single `translatePieces` request can span multiple batches serialized through the shared concurrency gate), but the comment's stated reasoning was stale. Corrected; the value itself is unchanged, pending a future live-measured re-tune.
- `collectTextNodes.ts`'s `isWholePageBarePre` was `export`ed but used only inside its own file — confirmed via repo-wide grep, including tests. No longer exported.
