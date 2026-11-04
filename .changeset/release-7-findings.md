---
'prism-gen3': patch
---

**Release 7: every remaining audit finding settled, and the tools brought up to date.**

- **Reading**
  - The bubble's **From** pick now reaches Google every time. Before, Prism sent "detect it yourself" and used your pick only when something went wrong.
  - **Show original** also restores text that was off the page at that moment, such as a collapsed section or a list the site had swapped out.
  - Simplified and Traditional Chinese are kept apart. Translating a Simplified page into Traditional is no longer skipped as "same language".
  - A timed-out batch no longer resends text that was already translated. Lists, tables, menus and headers are grouped as their own blocks. Parts of a page marked "don't translate" are respected however the page spells it.
- **Bubble and select-to-translate**
  - Typing in the bubble no longer triggers the site's own keyboard shortcuts.
  - **Show original** works even while a translation is still running.
  - Escape closes the selection button for good. Keyboard users can reach it with Tab, and its buttons are big enough to tap.
- **Menus and the popup**
  - The right-click menus no longer disappear after Firefox or Orion restarts. The menu and the shortcut act on the tab you used, and the "!" failure badge shows on the tab that failed.
  - Translating inside embedded frames keeps working after the browser pauses Prism's background in the middle of a page.
  - The popup shows "Restoring…" while it restores. Settings' **Test translation** saves a key you just typed before testing it. The per-site **From** list moved to Page translation.
- **Behind the scenes**
  - Settings changed in another tab while Prism starts are no longer lost, and a failed save puts the old value back.
  - The old LibreTranslate key is deleted from storage. A backup made by a newer Prism is refused with a clear message.
  - The release gate now needs a real date and a browser or device on the "Checked on" line. The size check covers the Firefox build and single files. A release keeps only the signed Firefox file.
  - TypeScript 7, Vitest 5, happy-dom 21, Biome 2.6 and the GitHub Actions v7 versions are all in.

Checked on: built extension in desktop Chromium (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages; popup by hand; right-click menus after a background restart), plus live free Google, 2026-11-04. iPhone check comes before stable 0.3.2.
