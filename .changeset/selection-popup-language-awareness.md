---
"prism-gen3": minor
---

The "translate selected text" trigger now matches TWP's language-awareness settings for when it should show at all, checked directly against their real config rather than assumed:

- **Default-on fix**: the trigger no longer appears for a lone character or a selection with nothing translatable in it (only punctuation, digits, or whitespace) — matches TWP's `dontShowIfIsNotValidText`, the only one of their selection-popup visibility settings that defaults on. Previously the trigger showed for any non-empty selection at all, with no equivalent filter.
- **New opt-in setting** ("Don't show the button when the selected text is already in your target language", off by default, matching TWP's own `dontShowIfSelectedTextIsTargetLang` default): when enabled, detects the selected text's language and hides the trigger if it's already confidently the target language, instead of offering a no-op translation.

Both are configurable from the Selection & hover settings tab.
