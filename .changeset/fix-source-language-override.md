---
"prism-gen3": minor
---

Fixed two related translation-quality bugs reported on the same site: identically-shaped short tokens (like a chapter-count filter's "> 50" / "> 100" / "> 200") could come back inconsistently reworded, and manually pinning a site's source language (the bubble's "From" picker, or a per-site override) forced that language onto every single translate request for the page, overriding Google's own per-request detection — an English word on an otherwise-foreign page could come back as an unrelated word. Both confirmed against the live endpoint; the second is fixed with a new safety net that recognizes content already in your target language (using surrounding page context, not just the one short word) and leaves it alone regardless of the pinned language.

Also closes 15 other real gaps:

- **Accessibility**: text inside a page's shadow-DOM sections (some comment widgets) can now be selected for translation; the floating bubble's settings panel is keyboard-reachable; the text-selection translate button responds to keyboard-driven selection, not just the mouse; frames (`<iframe>`s) now get both translation and an inherited auto-translate decision from the main page, instead of nothing at all.
- **Reliability**: popup messages to a page now time out instead of hanging on "translating…" forever; settings loaded from storage are validated the same way imported settings already were; a bad/expired API key now fails immediately instead of retrying for ~30 seconds first.
- **Robustness**: an extremely deeply nested page can no longer crash translation outright.
- **Floating bubble**: settings changes now roll back visibly if the save fails instead of silently drifting; the bubble's position now actually stays in sync across open tabs; a page's own CSS can no longer hide the bubble/tooltip/selection popup; right-click-menu and keyboard-shortcut translate actions now show a brief toolbar indicator if they fail instead of doing nothing visible.
- **Polish**: no more flash of the wrong color theme when opening the popup or settings page; the "clear cache" button now shows it's working.
