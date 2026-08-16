# 0008 — Firefox releases: AMO unlisted signing, not a store listing

## Status
Accepted — 2026-08-16

## Context
Firefox was already a build-time target (`wxt build -b firefox` /
`npm run zip:firefox`, see `wxt.config.ts`'s header comment), and
`.github/workflows/release.yml` attached the resulting zip to every GitHub
Release. A real user tried installing that zip in regular Firefox and got
"This add-on could not be installed because it appears to be corrupt" — the
file itself was verified intact (valid zip, correct internal structure,
valid `manifest.json`). The actual cause: Firefox refuses to permanently
install *any* unsigned extension outside Developer Edition/Nightly/ESR,
and its error message for that case doesn't mention signing at all, just
"corrupt." Every release's Firefox zip was, and had always been,
uninstallable in a normal Firefox install — a real, silent product gap
that had gone unnoticed because nothing in this repo's Firefox support had
been used past the build step until now.

This is personal-use only, not public store distribution — but Mozilla's
signing requirement applies regardless of whether the extension is publicly
listed. AMO ("addons.mozilla.org") offers exactly this case: submit for
signing on the **unlisted** channel, which skips AMO's review queue and
public store listing entirely, and returns a signed `.xpi` for
self-distribution — permanently installable, no reload-on-every-restart
workaround needed.

## Decision
Sign Firefox releases via AMO's unlisted channel, using Mozilla's own
`web-ext sign` CLI (wraps the same signing API `mozilla/sign-addon`, the
underlying Node library, uses) in `release.yml`:

- `wxt.config.ts` now sets `browser_specific_settings.gecko.id` — AMO
  requires a stable id for signing; without one, every signed version would
  look like an unrelated add-on rather than an update to the same one.
  Harmless on the Chrome build (Chrome ignores the key).
- The sign step runs only when both `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` repo
  secrets are set (checked via a job-level `env:` — a step's own `if:`
  can't read `secrets.*` directly). Until they're added, the release falls
  back to today's behavior (the unsigned zip) rather than failing the
  release outright.
- `gh release create` prefers the signed `.xpi` from
  `web-ext-artifacts/*.xpi` when the sign step produced one, falling back
  to the raw zip otherwise.

## Consequences
- To get a real signed `.xpi` on future releases: create a free account at
  addons.mozilla.org, generate API credentials at
  `https://addons.mozilla.org/en-US/developers/addon/api/key/` (a JWT
  issuer + secret), then add them as this repo's `AMO_JWT_ISSUER` and
  `AMO_JWT_SECRET` GitHub Actions secrets (Settings → Secrets and
  variables → Actions, or `gh secret set AMO_JWT_ISSUER` /
  `gh secret set AMO_JWT_SECRET` run locally — the credential values
  themselves should never pass through an AI assistant's hands to get set,
  same as any other secret).
- Until those secrets exist, `v0.3.0-beta.17` and any release after it
  still ship an unsigned Firefox zip — installable only via
  `about:debugging` → "Load Temporary Add-on" (cleared on every Firefox
  restart). Not a regression from before this ADR; the zip was never
  permanently installable regardless.
- Not pursued: the `listed` channel (public AMO store presence, subject to
  Mozilla's review queue) — out of scope for a personal-use extension, and
  a materially different commitment (review turnaround, a public listing to
  maintain) if ever wanted later.
