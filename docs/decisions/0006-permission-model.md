# 0006 — Permission model: broad access by default, confirmed working

## Status
Accepted — 2026-08-01 (Session 7)

## Context
The old repo tried scoping its permissions down (`activeTab` + an optional
`<all_urls>` grant a user could turn on) during its own Gen 2 rebuild, and
then reverted that back to unconditional `<all_urls>`-equivalent access
after a real user report: automatic/always-translate silently never fired
on Orion (a WebKit-based iOS browser) because `scripting
.registerContentScripts` — the API the scoped-down model depended on to
dynamically register the content script once the optional permission was
granted — isn't supported there, and Orion has no separate native
"allow on all sites" fallback UI either. See that repo's `CLAUDE.md`,
"Permission model: reverted to unconditional access," for the full
incident account.

The Gen 3 plan's Session 7 section calls for "starting from the old
repo's final, reverted-to state" as a deliberate decision, not an
oversight — this session is where that call actually gets made and
written down for Gen 3.

## What Gen 3 already does (as of Session 2)
`entrypoints/content.ts` has always used a **static** `matches: ['*://*/*']`
in its `defineContentScript()` call (`registration: 'manifest'`, WXT's
default — never the `'runtime'` dynamic-registration mode the old repo's
scoped-down experiment used). `wxt.config.ts`'s `manifest.permissions` is
`['storage', 'contextMenus', 'activeTab']` — no `host_permissions` entry at
all, and yet auto-translate-on-load has worked in every real verification
run since Session 5 (most recently confirmed again in Session 6/7's
Playwright checks), with zero permission-grant step.

This is the exact mechanism the old repo's Session 4 documented finding
described: **a static `content_scripts` manifest entry's own `matches`
pattern grants injection rights independent of `host_permissions`.**
Verified here by inspecting the real built `manifest.json` — it has no
`host_permissions` key, and the content script still runs on every page.

## Decision
**No change needed.** Gen 3's permission model already matches the old
repo's final, reverted-to, known-working state — broad, unconditional
content-script injection via a static manifest entry, not gated behind a
runtime-registration API with browser-specific support gaps. This was
true from Session 2 onward; Session 7 is just where that fact gets
confirmed against the actual documented plan requirement and written down,
rather than left as an unstated assumption.

`activeTab` stays in the permissions list for the popup's
`getActiveTabId()`-based tab targeting (`src/platform/messaging/tabTarget.ts`)
and the context-menu/keyboard-command handlers in `background.ts` —
unrelated to the content-script injection question above, and does not
need `host_permissions` either since it only needs to identify/message the
*current* tab, not read its content cross-origin.

## Consequences
- No `optional_host_permissions`, no permission-request UI, no
  `chrome.permissions` API usage anywhere in this codebase — there is
  nothing optional to request.
- If a future feature genuinely needs a permission this project doesn't
  have yet (e.g. `scripting` — see `src/platform/diagnostics.ts`'s
  capability check, which currently and correctly reports `hasScriptingApi:
  false` since nothing uses it), add it to `wxt.config.ts`'s
  `permissions` array directly rather than reaching for the
  optional-grant pattern — that pattern is the one this project has
  concrete evidence against.
