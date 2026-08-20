---
"prism-gen3": minor
---

Fixed a real bug found via a live user report: an old-school forum (cool18.com) wraps its post bodies in a bare `<pre>` tag purely to preserve the author's line breaks, not to mark code — but `<pre>` was always hardcoded to be skipped entirely (added earlier to protect real code samples from being reworded), silently excluding 60% of that page's content with no way to turn it back on. Compared against TWP's real, current source to check how it handles this: `<pre>` skipping there is a per-user setting, off by default, with one automatic exception — a page that's nothing but one bare `<pre>` (viewing a raw text/JSON response) is always translated regardless. Matched exactly: a new "Translate text inside `<pre>` blocks" toggle on the Page translation settings tab (off by default, matching TWP), plus the same automatic whole-page exception. `<code>` blocks (the real code-sample signal, semantically) stay protected either way.
