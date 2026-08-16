---
name: known-gaps-expected-at-this-stage-not-oversights
description: deliberate Session 4 deferral, see
---

# Known gaps (expected at this stage, not oversights)

- No DeepL provider (neither the Free API nor the live-tab bridge) — a
  deliberate Session 4 deferral, see
  `docs/decisions/0005-deepl-live-tab-bridge.md`.
- No iframe support for auto-translate-on-load — main-frame only, see
  `originalLanguageTracker.ts`'s header comment. The typed messaging layer
  this needs now exists (Session 6); relaying a main frame's detected
  language into same-origin iframes is still unbuilt.
- No element-attribute translation (placeholder/title/alt/aria-label) or
  custom-dictionary application — every text node still gets found and
  translated correctly, this is the same documented phase-2 scope cut the
  plan calls out, not a regression. Custom dictionary specifically:
  deliberately not started in Session 6 either, see that session's writeup.
- ~~The floating bubble has no drag-to-reposition or edge-docking~~
  **Resolved** by the post-launch UI-depth pass's Phase 1 (see that section
  above) — the bubble is now always-on, draggable, edge-docked, with a
  remembered position and a full From/To/Service/Always/Settings/Hide
  panel, at parity with the pre-rewrite fork.
- The selection-translation popup has no drag-to-move, editable
  replace-in-place, listen/copy actions, cross-frame focus arbitration,
  or per-selection service/language pickers — a deliberate scope cut
  (see Session 6's writeup), not an oversight. It also only mounts in the
  main frame, same as every other UI surface in this list. (Not part of
  the bubble/popup/settings UI-depth pass — that pass's scope was
  explicitly limited to the bubble, popup, and settings surfaces.)
- The mobile in-page translate trigger is folded into the floating bubble
  rather than a separate mobile-specific menu — no always/never-
  translate-from-language quick shortcuts on it specifically (those live
  in the options page's Automatic Translation section for every
  viewport). See Session 6's writeup for the reasoning; the trigger itself
  is now just the same always-on bubble every other viewport gets, not a
  narrow-viewport-only prompt (see the post-launch UI-depth pass above).
- No i18n — every UI string is hardcoded English, see
  `docs/decisions/0007-i18n-corpus-deferred.md` for the deferred corpus
  port and the concrete handoff steps.
- ~~No options/backup UI wired to `configStore.export()`/`import()` yet~~
  **Resolved** by the post-launch UI-depth pass's Phase 3 (see that section
  above) — Export/Import/Restore-defaults now live on the General tab.
- ~~Shadow-DOM page content is never translated~~ **Resolved** post-launch
  (see "Provider removals and shadow-DOM/reflow fixes" below) —
  `collectTextNodes.ts` now recursively descends into every open shadow
  root it encounters. Closed shadow roots remain unreachable from outside
  by design; no fix possible there.
- Standalone auxiliary windows (improve-translation, translate-text,
  translate-document), text-to-speech, a backup export/import UI, a
  release-notes page, and the toolbar icon's translated/original state
  swap were never scoped into any Gen 3 session — see the parity
  checklist above for the full "Deliberately Not Built" list.
- The LLM provider has real, unfixed gaps — deliberately left as-is per
  the user's own direction during the post-launch audit pass below (the
  free `google` provider is what's actually used; LLM issues are written
  down, not fixed):
  - `llm.ts`'s `parseResponse` ignores the `pieceCount` argument its own
    interface passes it. If the model returns fewer/more strings than
    requested, every piece after the mismatch point gets a different
    piece's translation, permanently and silently — no test exercises a
    length-mismatched model response.
  - Whitespace can be lost at the `PIECE_PART_SEPARATOR` join/split
    boundary for a `groupByBlock` piece (LLMs routinely trim whitespace at
    string boundaries), visibly welding two words together
    (`Bonjourmonde`).
  - There are no `host_permissions` in the manifest, and an MV3 service
    worker's `fetch` is CORS-governed. Google's endpoints evidently send
    permissive CORS headers (it works today); a user-supplied LLM
    `baseUrl` (OpenAI, Ollama, LM Studio) generally does not, and this has
    **only ever been exercised against mocks** (`vi.stubGlobal('fetch')`
    in unit tests, a localhost mock server in E2E) — never a real
    third-party endpoint. `docs/decisions/0006-permission-model.md`
    reasons carefully about content-script injection permissions and
    never addresses the fetch path.
  - `translateLoop.ts` slices the queue into `MAX_PIECES_PER_TICK`-sized
    batches before `groupNodesForBatching()` ever runs, and that function
    keeps no state across calls — so a paragraph whose nodes straddle a
    100-node tick boundary loses shared grouping context. Only affects
    `groupByBlock` (the LLM provider); `google`/`googleCloudTranslate`
    don't use it.
- Selection-translation (`getSelectionInfo`/`window.getSelection()`)
  cannot see text inside an open shadow root — `window.getSelection()`
  doesn't reach into one, even though page translation itself
  (`collectTextNodes`) deliberately does. A user can highlight
  shadow-DOM text but the "translate selection" trigger never appears.
  Fixing this needs Chromium's non-standard `ShadowRoot.getSelection()`
  (no cross-browser spec, and `happy-dom` doesn't implement it, so it
  couldn't be verified automatically) — flagged during the post-launch
  audit pass below, not fixed.
- The floating bubble's panel (language pickers, Service, Always/
  Settings/Hide) is keyboard-unreachable — visibility is CSS
  `:hover`/`.pinned` only, with `.pinned` set solely by a 450ms
  pointer long-press. A keyboard user can trigger translate/restore via
  the ball itself (Enter/Space), but can't reach anything inside the
  panel. Flagged during the post-launch audit pass below; fixing it needs
  a `:focus-within` CSS path plus a real keyboard-open affordance on the
  ball, not just a guard-script-sized change.
- ~~Icons/branding are still the WXT template defaults~~ **Resolved**
  post-launch: `public/icon/*.png` now ships a real icon (two rounded
  arcs forming an exchange loop, cyan→blue gradient) plus a source
  `icon.svg`, replacing the literal WXT puzzle-piece default. Deliberately
  a fresh mark, not the older triangle-and-dispersion "Prism" logo the
  Gen 2 fork uses (and that this repo's own floating bubble still reuses
  inline in its panel header — that inline mark was left as-is, out of
  scope for this change, which only touched the actual extension icon
  files). Two concepts were mocked up and shown to the user at real icon
  sizes (16-128px, light/dark) before building; the chosen one was
  verified for real against `chrome://extensions` on the built extension,
  not just the isolated mockup.
