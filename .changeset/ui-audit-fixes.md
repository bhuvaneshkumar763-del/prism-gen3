---
"prism-gen3": patch
---

**UI audit, release 1 of 2 — fixes.** The first dedicated pass over the UI rather than the translation engine: all five surfaces (floating bubble, popup, options page, selection popup, hover tooltip), each change test-first and confirmed failing without its fix, and the keyboard and rendering behaviour then checked in a real browser with the built extension — which caught two bugs every unit test missed.

**Speed**

- **The selection popup rebuilt itself on every keystroke, on every website.** It listens for key presses on the whole page, and each one ended in a full teardown and re-render — including every character typed into any text field, where the popup was already hidden. Measured directly: 20 keystrokes caused 21 renders; now 1. It renders once and updates in place, and a run of Shift+Arrow presses is treated as one gesture, so language detection runs once instead of per key.
- **The popup opens faster.** It asked the page three independent questions one after another; it now asks them at once, and one question failing no longer throws away the other two answers.
- **The floating bubble no longer measures its hidden panel on every resize or viewport change** — at most once per frame, and only while the panel is actually showing. On iOS this fires continuously during pinch-zoom and as the toolbar collapses.
- **Hovering over a translated page does less work** — the tooltip no longer builds a list of every translated node each time the pointer crosses an element.

**Bugs**

- **The popup's language buttons claimed a language the page wasn't in.** Clicking "Spanish" on a page already translated to English only saved the setting, but lit Spanish up as active while the page stayed English. Changing language or service in the popup now retranslates immediately, the way the bubble's own pickers always have.
- **Pages Prism can't run on showed a raw browser error** ("Could not establish connection. Receiving end does not exist."). They now say "Prism can't translate this page" — or "Reload this page to use Prism" for an ordinary page opened before Prism was installed — with Translate disabled.
- **Per-site checkboxes flipped on pages where they couldn't do anything**, showing a setting as on when nothing had been saved. They're now disabled there.
- **The selection translation could run off the screen** — sideways near the right edge, and downward with no way to scroll for a long passage. It now stays inside the window, opens above the text when there's more room there, and scrolls.

**Accessibility** — the popup and options page already labelled their controls properly; the bubble panel didn't.

- The bubble's From/To/Service pickers now have names; before, a screen reader announced three unnamed pop-up buttons.
- The bubble button's name now says what clicking it will do ("Show original", "Retry translation", …) instead of always "Translate this page".
- Status changes are announced: translated, failed, offline, and the selection result.
- "Always" and "Never translate this site" now expose whether they're on, not just by colour.
- **The bubble panel works properly from the keyboard.** Merely tabbing onto the bubble used to pop the whole panel open and drag you through every control in it; now ArrowDown opens it, Escape closes it from anywhere inside and returns focus to the bubble, and tabbing away closes it.
- The bubble's field labels now pass WCAG AA contrast (they were about 4.0:1).
- The selection button is the translate icon at 30px instead of a bare 26px "T", and Escape dismisses the selection popup — and it stays dismissed until the selection actually changes.

**Caught only by testing in a real browser**

- ArrowDown opened the panel, but focus silently stayed on the bubble: the panel was still mid-way through its fade-in, and browsers won't focus anything inside a hidden element. Test environments don't model that at all. Fixed, and now guarded by the end-to-end suite.
- Escape dismissed the selection popup, then it reappeared a moment later: a real keypress is a key-down *and* a key-up, and the key-up re-read the still-selected text. Fixed.

**Housekeeping:** the known-gaps doc still called the bubble panel keyboard-unreachable — out of date before this release, fully resolved by it. The engine-purity check was rejecting a harmless hostname inside a string ('chrome.google.com'); it now ignores quoted text for that one check, verified to still catch real API use, including inside template literals, and the import check it shares a code path with.
