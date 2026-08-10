# 0005 — DeepL: not ported this session

## Status
Accepted — 2026-08-01 (Session 4)

## Context
The old repo has two distinct DeepL integrations, with very different risk
profiles:

1. **DeepL Free API** (`api-free.deepl.com`) — a real, documented, stable
   JSON HTTP API. Structurally almost identical to LibreTranslate (already
   ported in Session 2) and Google Cloud Translation (added this session):
   user-supplied API key, `q`/`source_lang`/`target_lang` fields, JSON
   response. This is a trivial, low-risk addition to
   `createBatchedHttpProvider`.
2. **DeepL live-tab bridge** — a fundamentally different mechanism: a
   content script drives DeepL's own web UI (`www.deepl.com/translator`) in
   a real background tab, typing text into their page and scraping the
   translated result back out. This isn't an HTTP provider at all — it's
   browser automation against a third-party product Prism doesn't control,
   coupled to their frontend's DOM structure, and dependent on
   tab-lifecycle machinery (opening/reusing/closing a hidden tab,
   coordinating with whatever else has a tab open) that none of the other
   five providers need.

The Gen 3 plan flagged the bridge specifically as "the most fragile/
unusual provider" and asked for an explicit choice here rather than a
silent 1:1 port or a silent drop.

## Decision
**Neither DeepL integration is ported in Session 4.** Scope this session
was explicitly narrowed (by the user, mid-session) to: keep Google's free
scraped endpoint as a fallback, drop Bing/Yandex, add the real Google Cloud
Translation API, and give the Builtin/LLM providers polish — DeepL wasn't
part of that narrowed list, and pulling it in would have meant either
rushing the bridge's tab-lifecycle design or shipping only the free-API
half without a decision about the other. Deferring both together, as one
clean follow-up unit, beats shipping half now and deciding the harder half
later under time pressure.

When DeepL is picked up in a future session, the two integrations should
be treated as separable decisions, not a package deal:
- **DeepL Free API**: straightforward — add it the same way
  `googleCloudTranslate.ts` was added this session, on
  `createBatchedHttpProvider`, gated on a user-supplied key via
  `descriptors.ts`/`registry.ts`. No open design question.
- **DeepL live-tab bridge**: needs its own design pass for the
  tab-lifecycle machinery (a `src/platform/` concern — opening/reusing a
  background tab is a `browser.tabs` operation, so the engine layer can
  only define the port, not implement it) before it's built, matching this
  project's engine/platform boundary rather than the old repo's structure.
  Whether it's worth the fragility once the Free API already covers DeepL
  translations is a real product question to revisit then, not decided
  here.

## Consequences
- No DeepL provider exists in `descriptors.ts`/`registry.ts` as of Session
  4. `providerDescriptors` covered `libretranslate`, `google`,
  `googleCloudTranslate`, `llm`, `builtin` at that time — `libretranslate`
  and `builtin` were both later removed entirely (see
  `docs/decisions/0004-provider-scope.md`'s "Update" section); the current
  set is `google`, `googleCloudTranslate`, `llm`.
- This ADR is the record that the gap is deliberate, not forgotten — see
  also `docs/decisions/0004-provider-scope.md`, which narrowed this
  session's scope and pointed here for the DeepL-specific reasoning.
