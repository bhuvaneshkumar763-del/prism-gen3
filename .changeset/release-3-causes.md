---
"prism-gen3": patch
---

**Release 3: fixing what caused the audit's B−.** Nothing about how pages are translated changes, except the small fixes listed here.

- **The code's comments are now short explanations, not a diary.** Comment lines went from 5,333 to 1,962 and the source from 13,191 lines to 9,889. The built extension was proven byte-for-byte identical before and after this cut, so it can't have changed what the extension does.
- **Rules that had been fixed in one place and missed in others now live in one shared place:**
  - **Translated button labels, placeholders and tooltips** no longer overwrite a label the page changed while the translation was on its way, and "Show original" now restores the page's own current label (for example a Play/Pause toggle) instead of an old one. One failed request no longer stops later label changes from being translated.
  - **The tab title** can no longer show the previous chapter's translated title after a fast chapter skip.
  - **The translation cache** recovers from a browser hiccup on the next request, instead of switching itself off until the browser restarts.
  - **Settings backups** are upgraded by the same code as stored settings.
  - **Saving "Always translate this site" from the bubble or popup** rolls back visibly if the save fails, instead of showing a saved state that was never stored.
  - **The hover tooltip** no longer sticks on an iPad or on an iPhone in desktop mode.
  - **The extension's message checks** go through one shared wrapper instead of 14 copies.

Checked on: built extension in desktop Chromium (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages; popup by hand), plus live free Google, 2026-11-03. iPhone check comes before stable 0.3.2.
