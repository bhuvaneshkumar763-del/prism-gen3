---
"prism-gen3": patch
---

Audit round 6: 13 findings from a three-angle sweep (speed/wasted work, correctness, security/reliability/code-health), each verified by hand and shipped with a revert-and-confirm-fails regression test.

**Real defects fixed:**

- **`google.ts`'s reflow-repair check was blind to a dropped MIDDLE index.** `splitPieceResponse` builds a sparse array by index assignment, so `.length` is `maxIndex + 1`, not the entry count — `needsRepair` compared against `.length`, which only caught the LAST index disappearing. A dropped middle/first index escaped both guards: the neighboring index absorbed the merged content, and the holed index came back `undefined`, got retranslated on its own — the page showed the merged clause plus a duplicate of it. Fixed by counting real entries (`.filter(s => s !== undefined).length`) instead.
- **`attributeTranslator.ts` was missing three guards `mutationWatcher.ts`'s text-node path already has**, ported here: no ancestor walk at all (dynamically-added attributes inside a `translate="no"`/skip-tag subtree got translated — the beta.35 bug for text nodes, unported for attributes); no own-write guard on the childList branch (a detached/re-attached element — a virtualized list row — re-sent its own already-translated value, burning a second repair request on the same-language echo); no generation guard on write-back (`restore()` landing mid-flight still wrote the stale translation through, and corrupted the restore baseline for the *next* restore too).
- **Bubble "Hide" leaked the whole Solid root.** `host.remove()` without `dispose()` meant `onCleanup`'s listeners (document/window/visualViewport, a `configStore` subscription) survived every Hide click for the page's lifetime, unreachable afterward.
- **One message handler of fifteen had no sender validation** (`translatePiecesProgress` in `remoteTranslator.ts`) — a sprayable `requestId` could let an untrusted sender choose what text appears as a page's "translation." Defense-in-depth, not privilege escalation, but now consistent with the other fourteen.
- **A literal separator character inside a node's own text broke the LLM/Google-Cloud-Translate wire format** — `transformPiece`/`splitPieceResponse` joined/split on an unescaped delimiter, so page text containing that exact character produced more wire parts than nodes, misaligning every subsequent node's translation. Now escaped before joining, reversed after splitting.
- **A dead Bing-dictionary carve-out in `htmlEscape.ts`** (no Bing provider exists in this codebase) protected a literal `<mstrans:dictionary...>` substring from escaping entirely — worse than inert, since it let a stray `<`/`>`/`"` reach the wire format unescaped for page text that happened to contain it. Removed.
- **The settings export raced `URL.revokeObjectURL` against a detached anchor's `click()`** — confirmed WebKit-specific risk (a shipped target). Extracted into a small, directly-testable `downloadBlob()` helper that attaches the anchor and defers the revoke to a later task.
- **`configStore`'s live `onChanged` path adopted a storage change with zero validation**, unlike its own `initConfig()` — a value corrupted by something other than this store's own `set()` (another context, a bad migration) used to be trusted as-is, and a real key removal (`change.newValue === undefined`) violated the store's own "every key always has a value" guarantee. Now validates and falls back to the existing value, same as startup.

**Optimizations (behavior-preserving, verified via the same tests before and after):**

- Link-cluster-row detection (`grouping.ts`) was O(L²) per tick — every node under a shared container re-scanned all of that container's children. Now memoized per `groupNodesForBatching()` call.
- The translation cache rewrote the full record (translated value included) on every single cache hit to bump a timestamp. Now skips the rewrite for anything touched within the last hour.
- A redundant `isNoTranslateNode(parent)` check in `collectTextNodes`'s hot path ran on every text node, on every resweep — but was only ever needed for the one case where the walk's `root` is itself a Text node (a bare Text node added via a mutation). Scoped to exactly that case; every other node's parent was already validated during normal descent.
- Two `Promise.race` backstop timers (`sendOnce()`, `findAuth()`) were never cleared after a request settled normally. No functional effect, just tidiness.

**Product decision:** the settings export includes API keys in plain text (removing them would silently break restoring a backup on another device) — the options page now says so plainly next to the Export button, matching what `diagnostics.ts`'s own separate export already redacts.

**Deliberately not touched:**

- The LLM provider's CORS behavior and prompt-injection hardening (the project's own long-standing deferred item) — investigated as part of this round's security angle, confirmed real, explicitly scoped OUT of this pass on request; it needs a dedicated round of its own.
- The `<a i=N>` markup-ceremony batch-budget fix from earlier this session — real, but `maxBatchChars` has its own incident history (beta.22) and needs live-page verification before shipping; held for its own release.
