---
name: post-launch-provider-removals-builtin-libretranslate-shadow-dom-translation-and-google-reflow-corruption
description: Four related real-user reports, worked through in sequence in one session,
---

# Post-launch: provider removals (`builtin`, `libretranslate`), shadow-DOM translation, and Google reflow corruption

Four related real-user reports, worked through in sequence in one session,
`0.3.0-beta.9` → `0.3.0-beta.13`.

**1. `builtin` (on-device Chrome Translator API) — root-caused, then
removed.** A user reported "the local model doesn't work," which turned
out to mean the Built-in AI provider, producing
`[builtin] not configured or unavailable`. First pass: added a
`checkBuiltinAvailability` message (background → options page) so the UI
could show *why* — not available in this browser/profile, needs to
download, unsupported for this language pair, or ready — instead of one
flat error string. The user then shared their `chrome://version` output:
Vivaldi, not Google Chrome (its User-Agent deliberately omits any
"Vivaldi" token for site-compatibility reasons — the giveaway was the
Executable Path, `/Applications/Vivaldi.app/...`). Root cause, confirmed
rather than guessed: Chrome's on-device AI model (Gemini Nano) and its
`Translator` JS API are Google's own proprietary service, gated to actual
Google Chrome. Other Chromium-based browsers (Vivaldi, Brave, Opera,
Edge, ...) share the open-source engine — including
`chrome://on-device-translation-internals`, a page compiled into Chromium
itself, which is why it loaded and listed real language packages even
though nothing behind it could work — but never get Google's private
model-distribution backend. This is a hard platform limitation, not
fixable by this extension. Per the user's explicit follow-up
("remove the built in model its useless now"), the whole provider was
deleted rather than left half-working: `builtin.ts`,
`checkBuiltinAvailability` (message + background handler + options-page
status UI), the `'builtin'` `ProviderId`/enum entries, all gone. A new
config migration (`CONFIG_SCHEMA_VERSION` 2 → 3) falls any existing
`pageTranslatorProvider: 'builtin'` back to `'google'` — `initConfig()`
reads raw storage straight into state with **no schema validation** (see
`configStore.ts`'s own comment), so an orphaned enum value would otherwise
only surface as a runtime type mismatch in `registry.ts`'s
`createProvider` switch, not a clean fallback.

**2. `libretranslate` — removed at the same user's explicit follow-up
request** ("remove libretranslate too"), immediately after the `builtin`
removal above. It had already been demoted from the default provider
earlier (see the "Post-launch incident" section above — the public
`libretranslate.com` rate-limits unauthenticated requests to uselessness)
and wasn't worth keeping as a selectable-but-broken-by-default option.
Same removal shape as `builtin`: `libretranslate.ts` deleted, `'libretranslate'`
removed from `ProviderId`/the config enum/`ProviderConfig`, `libreTranslateBaseUrl`/
`libreTranslateApiKey` schema fields removed (the orphaned raw storage
keys are left in place rather than actively deleted — `initConfig()` only
copies keys present in `defaultConfig`, so removing them from the schema
already makes them inert). Another migration (version 3 → 4) falls any
existing `pageTranslatorProvider: 'libretranslate'` back to `'google'`.
As of this update, `descriptors.ts` covers exactly 3 providers: `google`,
`googleCloudTranslate`, `llm`.

**3. Shadow-DOM content never translated — real bug, confirmed live, not
the Session 10 gap being rediscovered.** A user reported bilibili's main
comment thread never translates, while its danmaku bullet-comment overlay
does. Live DOM inspection (not guessed) confirmed bilibili's comments are
a deep tree of custom elements (`bili-comment-renderer` >
`bili-rich-text` > `bili-comment-user-info` > ...), each attaching its own
**open** shadow root — several levels deep. `element.childNodes` never
includes a shadow host's `shadowRoot` content, so `collectTextNodes.ts`'s
DFS walk structurally could not see any of it (danmaku works because it's
a plain overlay layer, not shadow DOM). This is the exact gap Session 10
found and explicitly deferred (see the "Known gaps" entry above, now
resolved) — this session is where it actually got fixed: the walk now
recurses into `el.shadowRoot` wherever present. Closed shadow roots stay
unreachable by design, same documented limitation as this project's
same-origin-iframe gap. This also makes `resweep.ts`'s existing
periodic/scroll-triggered backstop (its own header comment already named
"mutations inside a shadow root" as exactly the case it exists for)
actually reach shadow content for the first time, since it re-walks
through this same function — not a separate fix, a consequence of this
one.

**4. Google provider reflow corruption — real bug, reproduced live before
fixing.** Same report also described "random punctuation showing up at
the start of sentences or paragraphs." Traced to `google.ts`'s multi-item
`<a i=N>` reconstruction, used because `descriptors.ts` gave `google` a
`batchingHint` (Session 5) to group sibling DOM text nodes into one
request for extra context. `google.ts`'s own header comment already
documented that Google's endpoint can reflow translated text across those
piece-internal boundaries for some language pairs — this session
reproduced it against the real live endpoint rather than trusting the old
comment alone: an en→zh request through the real built extension produced
duplicated/merged word fragments and truncated output, while the same
code path with en→fr reconstructed cleanly — language-pair-dependent, not
a parsing bug in this codebase. Fixed by removing `google`'s
`batchingHint` entirely, reverting to one-node-per-piece translation — the
same safe default every provider without a `batchingHint` already used.
Re-ran the identical live en→zh request after the fix: clean per-node
reconstruction, no duplication, no truncation, no stray leading
punctuation. `grouping.ts`'s tag-anchor isolation logic (added just before
this pass, see below) still exists for `llm`, the one remaining provider
with a `batchingHint` — it simply never engages for `google` anymore,
since `groupNodesForBatching` returns one-node-per-piece immediately when
no `batchingHint` is present.

**Also folded into this pass, landed just before it (`0.3.0-beta.9`):
tag-list scrambling when the `#`/`@` marker is a separate sibling node.**
A real site (alicesw.com) markets tags as `<a><em>#</em>travel</a>` — the
marker and the word are two separate Text nodes. Neither alone matched
`tagText.ts`'s `isPureTagText` (built for the single-node `#travel` case,
see the "Tag-cluster translation accuracy" section above), so the whole
tag list fell through into ordinary block-level grouping — exactly the
multi-item scrambling that section's own isolation logic exists to
prevent, just from a DOM shape it didn't check for. Fixed two ways:
`collectTextNodes.ts` no longer queues a bare `#`/`@` marker node at all
(nothing useful to translate in a lone punctuation character), and
`grouping.ts` gained anchor-based isolation (`nearestTagAnchor` +
`isolationKeyFor`) alongside the existing node-based isolation — a node's
nearest `<a>` ancestor is checked against `isPureTagText` using the
anchor's full `textContent` (which still includes the marker in the live
DOM), and every node under that anchor groups together, isolated from
neighboring anchors. Verified against the real page's live DOM structure
via Playwright before fixing, not assumed.

**Verification across all of the above**: every fix was checked against
the real built extension, not just unit tests — a live `chrome://version`-style
DOM inspection of bilibili's actual comment tree, live `en->zh`/`en->fr`
Google translate requests before and after the reflow fix, and a live
Options-page walkthrough confirming the provider dropdown now lists
exactly `Google (free)` / `Google Cloud Translation API` /
`AI (OpenAI-compatible — cloud or local)`, nothing else. Full standard
chain (`compile`, unit tests, `lint`, both guards, both browser builds,
`guard:bundle-size`, `test:e2e`, `npm audit`) clean after every step, plus
an ad hoc `npm audit fix` for an unrelated transitive `nanoid` advisory
picked up along the way.
