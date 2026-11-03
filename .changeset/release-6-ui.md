---
"prism-gen3": patch
---

**Release 6: the popup, bubble, select-to-translate and Settings, redesigned for the iPhone.**

- **Popup:** the main button now says what it will do ("Translate to English" / "Show original"). Only the main button, the language picker and the bubble switch sit on top; everything else is under "More". Language pills no longer jump when tapped. "Translate this site" is one Always / Default / Never choice. There is one Settings link, errors are in plain words ("Prism can't reach this page. Reload it and try again."), and every control is big enough to tap.
- **Bubble:** tapping outside its panel closes the panel without turning the page, and tapping the ball doesn't reach the page either. "Hide" can be undone for 5 seconds. The ball is bigger (44 px) and fades while you scroll so it doesn't cover text. A long press no longer starts an iOS text selection, a tap while it's busy gives a short pulse, it stays put when you pinch-zoom, and its colours are easier to read.
- **Select-to-translate now works on the iPhone.** You can select a single Chinese character, the button follows the text when you scroll, typing in it no longer triggers the site's shortcuts, and a failure shows plain words instead of spinning forever. The button sits below the selection on touch screens (iOS shows its own Copy menu above) and above it on desktop. The hover tooltip no longer covers the next line.
- **Settings:** lists show language names ("Chinese (Simplified)") instead of codes, and Arabic can be added again. Diagnostics are in plain words, without the misleading red "no". Settings links bring the open Settings tab forward instead of opening another. Reset position confirms, and the buttons and text are bigger and easier to read.

Checked on: built extension in desktop Chromium and a 375 px mobile emulation with touch (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages; popup, bubble, selection and Settings clicked through with screenshots), plus live free Google, 2026-11-03. iPhone check comes before stable 0.3.2.
