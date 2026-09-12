---
"prism-gen3": patch
---

Security fix (round-4 audit, item 1): any web page could drive the floating bubble and the selection-translate popup as if the user had clicked them, because neither surface checked `event.isTrusted` and both mount into an `open` shadow root at a fixed, guessable id (`prism-bubble-host`, `prism-selection-popup-host`).

A malicious page could:

- Persist its own hostname into `alwaysTranslateSites` (via a synthetic click on the bubble's "Always" chip), so every future visit silently ships the whole page — including anything rendered for a logged-in user — to the configured translation provider with no prompt and no visible cause.
- Fire unlimited real translate requests through the user's configured provider with attacker-controlled text (via the selection popup), burning a paid Google Cloud key or rate-limiting the free endpoint for every other site.
- Silently change the target language or translation service, then hide the bubble so the user has no way to notice or undo any of it.

This was not theoretical — it was demonstrated live this session, by accident, while debugging an unrelated issue: driving the bubble from page-context JavaScript with synthetic `PointerEvent`s worked exactly like a real click.

Every page-reachable handler in the bubble and the selection popup (button clicks, chip clicks, select changes, the ball's pointer/keyboard toggle) now rejects an event whose `isTrusted` is `false` — the standard defense for exactly this class of bug. A real user click, tap, or keypress always has `isTrusted: true`; only a script-dispatched event does not, so this has no effect on legitimate use. Verified live: the exact synthetic-event attack that worked before this fix is rejected after it, while a real click still translates the page correctly.
