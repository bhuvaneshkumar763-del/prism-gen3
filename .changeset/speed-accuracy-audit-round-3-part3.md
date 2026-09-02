---
"prism-gen3": minor
---

Round 3's last 7 items (the "long tail" from the original plan), all previously deferred behind beta.34/35/36.

- **Accuracy — a same-origin iframe always translated with the literal `'auto'`, never the page's actually-detected language.** The relay protocol that already exists so a sub-frame inherits the main frame's auto-translate decision only ever carried the target language, not the detected source language — the exact `'auto'` silent-no-op input a previous fix replaced everywhere else, just never covered for iframes. The main frame's detected language is now relayed too.

- **Accuracy — the tab title ignored a manually-forced source language.** The bubble's From picker correctly applied to every body text node's translate request but the tab-title translator was wired to the ambient detected language directly, bypassing the manual override — a page mis-detected and manually corrected translated correctly everywhere except the title.

- **Speed — a periodic timer forced a full-page resweep every ~500-750ms, forever, on any static page.** A mechanism meant to catch mutations a `MutationObserver` structurally can't see (shadow-DOM content added after load) fired on every tick the observer saw nothing — which is the default state of any page that simply isn't mutating, not a signal something invisible happened — defeating the page-resweep scheduler's own adaptive backoff. Removed; the resweep scheduler already does this same catch-up walk independently, on its own adaptive schedule.

- **Speed — the original-language detector forced a full synchronous page layout just to build a text sample.** Reading `document.body.innerText` requires the browser to lay out the whole page first. Switched to a `textContent`-based walk that still excludes script/style element text (so page code doesn't corrupt the language guess), with no layout cost.

- **Speed — the two source-language detectors ran strictly one after the other, each independently timeout-bounded**, so a slow or unanswered background relay paid its own full timeout and then the fallback's, back to back. They now start together, capping the worst case at one timeout window instead of two.

- **Reliability — a rapidly-updating node (a live score, a streaming counter) could be queued for translation more than once at the same time**, wasting a request and racing two write-backs for the same node. Fixed with a membership check before queueing.

- **Reliability — a translate cycle could end up running two batches concurrently** if new content arrived while a batch was still awaiting its response, racing shared progress/queue state. Fixed with a re-entrancy guard, careful to still allow a genuinely new translate cycle to proceed immediately even while an old, abandoned cycle's batch is still resolving in the background (matching this extension's existing language-switch-mid-translate behavior).

- **Reliability — scrolling an inner scrollable pane (a common app-shell layout: fixed header/sidebar, scrolling content area) never triggered a prompt content re-check**, unlike scrolling the whole page — element scroll events don't bubble the way a plain window listener expects. Fixed.
