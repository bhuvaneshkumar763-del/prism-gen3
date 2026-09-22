---
"prism-gen3": patch
---

**Fix scrambled tag/filter chips on sangtacviet.vip's search page — reported from the live site.** On first load the facet panel rendered chips like `System (192673) Fantasy (` and `189348)` instead of one tag per chip; untranslating and retranslating usually fixed it, which is the signature of a nondeterministic provider-side reflow rather than a layout bug.

Root cause, confirmed against the live DOM: that panel is a single `<span>` holding ~1000 `<button class="btn btn-light">` siblings — a tag cloud in every respect except the element name. This project already isolates chip/nav/breadcrumb clusters into one translate piece per item, precisely so Google's multi-item `<a i=N>` wire format has nothing to scramble, but every path into that logic required an `<a>`: the tag-anchor walk looked only for `A`, and the cluster-container check rejected the container the moment it saw a non-`A` child. So all ~1000 chips fell through to ordinary block grouping, were packed into large multi-item pieces, and Google redistributed content across the markers.

Cluster detection now treats `<button>` as a cluster item alongside `<a>`. Scoped deliberately to those two interactive controls rather than "any short element": a container whose children are all short anchors or buttons with no letter-bearing text between them is a control row, and prose is not built that way. Widening it to `<span>`/`<div>` would reopen the over-eager-isolation risk this file's own notes warn about, so that stays closed until a real report needs it. Every existing guard is unchanged — a button inside an ordinary sentence is still grouped with its prose, and a lone button still needs a sibling to read as a cluster.

**Known limitation this does not close:** the provider-level reflow *detector* still only catches a reflow that drops an index or leaks literal marker text. This page's reflow preserved the entry count and moved content between indices, which neither check sees. The fix above removes the trigger for this DOM shape rather than detecting the corruption after the fact, so a same-count reflow elsewhere would still get through. Logged as open.
