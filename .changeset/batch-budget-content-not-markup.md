---
"prism-gen3": patch
---

**Speed: the per-request batch budget is now charged against a page's own text, not the wire markup wrapped around it.** Held back from the round-6 release deliberately and shipped alone, because this exact constant has prior incident history (beta.22) and bundling it would make any regression unattributable.

`maxBatchChars` is documented as a CONTENT budget — "how much of the page's own text goes in one request" — but the batching loop charged it against the post-`transformPiece` string. For Google, a single-node piece's wire form is `<pre><a i=0>text</a><a i=1> </a></pre>`: exactly 34 chars of markup ceremony (the `<pre>` wrapper, the `<a i=N>` positional markers, and the throwaway padding string beta.28 added so a lone string translates reliably at all). On a page made of many short pieces — a novel chapter's dialogue lines, a nav list, a table of links — that markup dominated the budget, so each request carried far fewer real pieces than the budget's own name promises.

Measured on a chapter-shaped workload (300 pieces of ~19 chars each, the new regression test): **8 HTTP requests before, 3 after** — the same text in well under half the requests. Per-request overhead is the dominant cost at this shape, which is the same measurement that motivated raising the budget from 800 to 2000 in the first place.

A content-only budget isn't a complete substitute for the old wire budget, so it's paired with a hard 6000-char wire ceiling — whichever trips first closes the batch. 6000 is not a new guess: it's the largest wire size this file's own doc comment records as directly verified against the live endpoint with zero positional misalignment, at up to 300 pieces sharing one request. The ceiling also implicitly bounds pieces-per-request to roughly 170, well inside that verified range, so a batch of unusually many tiny pieces can't quietly grow past what's been measured safe. Both halves ship with their own regression test, each confirmed to fail when only that half is reverted.

**Not yet verified on a live page.** The ledger's own bar for touching this constant is real end-to-end verification against a large live page, not just unit measurement — that hasn't been done for this change and should be the first thing checked after installing this build.
