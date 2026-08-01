# 0007 — i18n: no UI-string translation corpus yet, deliberately

## Status
Accepted — 2026-08-01 (Session 7)

## Context
The Gen 3 plan's Round 3 scoping decision was explicit: "nothing to do
with TWP" is about code/architecture/naming, not about redoing 43
languages of human UI-string translation work from zero — **the old
repo's 43 locale files' translated string *values*** (not the code, not
the key names/organization) are a legitimate bootstrap corpus to reuse
when this project's own UI strings get internationalized.

Every UI surface built so far (popup, options, the floating bubble, the
hover tooltip, the selection popup) has its strings hardcoded in English
directly in the `.tsx` files — there is no `@wxt-dev/i18n` setup, no
`_locales/` directory, and no message-key scheme in this repo yet at all.

## Decision
**Not built this session.** Porting a 43-language corpus is real,
substantial, mechanical work (extracting ~264+ old message keys' English
source + all 43 languages' translated values, mapping them onto whatever
new key names/file organization this project settles on, and wiring every
UI surface built across Sessions 2-7 to use `browser.i18n.getMessage()` or
equivalent instead of hardcoded strings) — it is its own dedicated task,
not a corner of a session that also covered the disk cache, diagnostics,
and the permission-model/dark-mode confirmations above. Rushing it here
would mean either a shallow partial port (a handful of strings in a
handful of languages, not a real i18n foundation) or crowding out the
other Session 7 work — neither is the right trade.

## What this defers, concretely, for whoever picks it up next
1. Decide the i18n mechanism: WXT ships `@wxt-dev/i18n` (Chrome's
   `_locales/<lang>/messages.json` convention) as the natural fit given
   this is already a WXT project — a real evaluation belongs in that
   session, not assumed here.
2. Extract the old repo's 43 `_locales/*/messages.json` files' *values*
   (`git show` against the pre-Gen-3 repo, or the fork's own locale files
   if further back reference is useful) — keep the human translation
   content, not the old key names or file layout.
3. Design fresh message keys matching this project's actual current UI
   strings (which don't 1:1 match the old repo's — Sessions 2-7 built a
   different set of surfaces with different copy), and map the old
   corpus's translated values onto the ones that have a clear equivalent.
   Strings with no old equivalent (e.g. the diagnostics panel, the
   mobile-viewport translate prompt on the bubble) start English-only
   until translated.
4. Wire every hardcoded string in `entrypoints/popup/App.tsx`,
   `entrypoints/options/App.tsx`, `components/bubble/FloatingBubble.tsx`,
   `components/hoverTooltip/HoverTooltip.tsx`,
   `components/selection/SelectionPopup.tsx`, and `manifest.json`'s own
   `name`/`description`/`action.default_title` to the new message system.

## Consequences
- Every UI string in this repo is English-only until the above lands —
  a real, visible gap for non-English users, not a silent one. Documented
  here rather than left implicit.
- No `_locales/` directory exists yet; `wxt.config.ts`'s manifest has no
  `default_locale` key.
