---
"prism-gen3": patch
---

Fixed a wrong default shipped in the previous release: the new "translate `<pre>` blocks" setting was defaulted to off, based on a mistaken read of what TWP's own default actually is. Re-checked directly against their real source — TWP's default is in fact to translate `<pre>` blocks unless a user explicitly turns it off. Flipped ours to match, so a page like the reported forum thread (prose wrapped in a bare `<pre>` for line breaks, not code) now translates correctly out of the box, with no setting to find and enable. `<code>` blocks remain protected regardless, same as before.
