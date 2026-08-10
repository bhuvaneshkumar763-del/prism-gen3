# 0004 — Provider scope for Session 4, and how Google's provider was built

## Status
Accepted — 2026-08-01 (Session 4)

## Context
Mid-session, a real question came up: does any of this actually match the
translation quality users get from Chrome's or Arc's built-in "translate
this page" feature? Rather than guess, this got checked directly:

- **Chrome's native translate** (Chrome 138+, expanded further in May
  2026) runs **on-device using Google's Gemini Nano model** — a small LLM,
  not classical machine translation. [Chrome for Developers: Translator
  API](https://developer.chrome.com/docs/ai/translator-api).
- **Arc's translate** explicitly uses **the real Google Translate API**
  (Arc's own help center, not the free/scraped `translateHtml` "lite"
  endpoint every TWP-lineage extension — including this one's Google
  provider — talks to).

Neither of those is the endpoint this provider hits. The free scraped
Google endpoint has a real, unavoidable quality ceiling below both — that
is not something better client code can fix.

## Decisions
1. **Google's scraped `translateHtml` provider ships anyway**, as a free,
   no-signup fallback — not because it matches Chrome/Arc, but because
   "free and works with zero setup" has real value for someone who just
   wants *a* translation without configuring anything. It's clearly not
   the quality bar this project should be judged on.
2. **Bing and Yandex scraped providers are dropped from this session
   entirely** (Bing's was fully built, then deleted once this was decided
   — no half-finished code left behind). Same reasoning: more scraping
   surface area for a tier already confirmed lower-quality than what users
   are actually comparing against. Not a permanent rejection — if a real
   need for either surfaces later, it's a fresh decision with its own ADR,
   not a silent revival of deleted code.
3. **A real Google Cloud Translation API provider gets added** (user's own
   key + billing — same "bring your own credential" trust tier as the LLM
   and LibreTranslate-paid providers) as the closest available match to
   what Arc's experience is actually built on.
4. **Builtin (on-device Gemini Nano) and LLM providers get priority and
   polish** this session — they're the two paths that genuinely match or
   exceed the Chrome/Arc bar, confirmed above, not assumed.

## How the Google provider's response parser was built
A real, separate concern came up: was this provider actually independently
engineered, or retyped from the old repo's file? For the parts governed by
Google's own undocumented wire format (which neither this project nor the
old repo invented), a fresh implementation was derived by making real,
live requests directly against `translate-pa.googleapis.com` during this
session and inspecting the raw responses — not by reading the old repo's
parser and reproducing its logic. That testing is what surfaced (and is
now documented, with the actual request/response pairs, in `google.ts`'s
`splitPieceResponse` comment):

- Untagged "orphan" text between `<a i=N>` markers is real and had to be
  attributed somewhere — confirmed by an actual `en->fr` response.
- An index can receive text from more than one tag occurrence, because
  Google's translation genuinely reflows content across piece boundaries
  for some language pairs — confirmed by an actual `en->ja` response where
  a phone number moved from one piece into another's marker.
- The old repo's `<b>`/`<i>` "sentence confidence tag" handling was **not**
  reproduced, because it could not be reproduced against current live
  behavior in any test tried — it may be dead/historical, or specific to
  input this session's testing didn't happen to hit. If it turns out to
  matter later, it should be re-added with its own fresh evidence, not
  copied back in speculatively.

The auth-key scrape was verified the same way: the JS bundle URL was
fetched live, the actual key format inspected directly, and a real
translate request made with it to confirm the header name/value actually
work — not assumed from the old repo's regex.

## Consequences
- `docs/decisions/0005-deepl-live-tab-bridge.md` covers the DeepL decision
  separately — same "don't build a scraping-heavy, fragile integration
  without a clear reason" reasoning applies there too.
- The provider descriptor list (`descriptors.ts`) reflected this scope as
  of Session 4: `libretranslate`, `google` (free fallback),
  `googleCloudTranslate` (paid, real API), `llm`, `builtin`. No `bing`/
  `yandex` entries.

## Update — post-launch: `libretranslate` and `builtin` both removed
Two later, real, user-driven decisions narrowed this list further (see
`CLAUDE.md`'s post-launch sections for the full accounts — this ADR isn't
rewritten to pretend they didn't happen):
- **`builtin`** (on-device Chrome Translator API) was removed entirely.
  Root-caused a real "not configured or unavailable" report to a hard
  platform limitation, not a bug: the on-device model is Google's own
  proprietary service, gated to actual Google Chrome, and never works in
  any other Chromium-based browser (Vivaldi, Brave, Opera, Edge, ...) even
  though they share the same engine. A provider that only works for a
  subset of Chrome users and produces a confusing dead end for everyone
  else wasn't worth half-supporting.
- **`libretranslate`** was removed at the same user's explicit follow-up
  request, right after the `builtin` removal. It had already been demoted
  from the default provider earlier (see the "Post-launch incident"
  section in `CLAUDE.md` — the public `libretranslate.com` rate-limits
  unauthenticated requests to the point of being unusable) and wasn't
  worth keeping as a selectable-but-broken-by-default option.

As of this update, `descriptors.ts` covers exactly 3 providers: `google`
(free fallback), `googleCloudTranslate` (paid, real API), `llm`
(OpenAI-compatible, cloud or local). Both removals ship a config migration
(`migrations.ts`, versions 3 and 4) falling any existing selection of the
removed provider back to the default (`google`).
