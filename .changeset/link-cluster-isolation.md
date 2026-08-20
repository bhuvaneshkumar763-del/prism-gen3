---
"prism-gen3": minor
---

Isolates each link in a nav row / breadcrumb trail / chapter-title cluster (`« Prev | Chapter 12 | Next »`) into its own translation piece, instead of letting several short, unrelated link fragments land in one shared multi-item piece.

This is the follow-up the earlier tag-cluster fix (`#go#be`) explicitly left as a documented gap — a real repro confirmed the same class of risk exists for link clusters: a chapter-nav row's three link texts landed in one multi-item piece today, which the AI/LLM provider (the only provider currently batching sibling nodes into shared pieces) sends as a single segment with parts joined by a separator character — real risk of a model dropping/merging/mistranslating the separator boundary. A single inline link inside an ordinary sentence is unaffected (needs at least 2 short-link siblings with no real prose between them to be recognized as a cluster at all).
