---
"prism-gen3": patch
---

Fixed a real bug where a page's tag list (e.g. `<a><em>#</em>travel</a>` repeated many times in a row — the marker and word split across sibling nodes, common real-world tag markup) got scrambled on translation. Neither the marker nor the bare word alone was recognized as tag text, so the whole list was batched into one shared multi-item translation request and came back reordered/merged. Tag anchors are now isolated by their enclosing `<a>` element's full text, one request per tag, and bare `#`/`@` marker nodes are no longer sent for translation at all.
