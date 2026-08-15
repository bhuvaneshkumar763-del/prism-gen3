# Working on this repo — read this first

This is **Prism, Gen 3** — a ground-up rewrite of a browser extension that
translates web pages in place. It is a **brand-new repository**, not a
continuation of the old one at `/Users/jb/Downloads/TWP`.

**Read the plan file first, always**:
`/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md` (the
section titled "Prism Gen 3 — ground-up rewrite in a new repository" at
the top — the rest of that file is the old repo's superseded history, kept
for reference). It has the full session-by-session breakdown, the context
for why this rewrite exists, and every "keep vs. diverge" decision already
made. **Read that file's session map before starting any Gen 3 work** — it
tells you exactly which session you're in and what it depends on.

## Why this repo exists (short version)

_Moved to `.claude/skills/why-this-repo-exists-short-version/SKILL.md` — load via `/why-this-repo-exists-short-version`._

## The old repo's inventory (what Gen 3 needs to not silently drop)

A full audit of the old repo — every user-facing feature (25), every
translation provider and its real quirks (7), the page-translation engine's
module boundaries, the config/messaging architecture, every documented
"gotcha," test coverage gaps, dependencies, and CI/release infra — was done
to scope this plan. It's summarized in the plan file's session breakdown;
the old repo's own `CLAUDE.md` has the full incident-by-incident narrative
behind each gotcha if you need more depth than the summary gives.

## Repo structure (established Session 1)

_Moved to `.claude/skills/repo-structure-established-session-1/SKILL.md` — load via `/repo-structure-established-session-1`._

## Conventions established so far

_Moved to `.claude/skills/conventions-established-so-far/SKILL.md` — load via `/conventions-established-so-far`._

## Current status

_Moved to `.claude/skills/current-status/SKILL.md` — load via `/current-status`._

## Testing

_Moved to `.claude/skills/testing/SKILL.md` — load via `/testing`._

## Known gaps (expected at this stage, not oversights)

_Moved to `.claude/skills/known-gaps-expected-at-this-stage-not-oversights/SKILL.md` — load via `/known-gaps-expected-at-this-stage-not-oversights`._

## Post-launch incident: translation didn't work out of the box, and failure was silent

_Moved to `.claude/skills/post-launch-incident-translation-didn-t-work-out-of-the-box-and-failure-was-silent/SKILL.md` — load via `/post-launch-incident-translation-didn-t-work-out-of-the-box-and-failure-was-silent`._

## Post-launch UI-depth pass: bubble/popup/settings restored toward the pre-rewrite fork's feature set (Phase 1: bubble)

_Moved to `.claude/skills/post-launch-ui-depth-pass-bubble-popup-settings-restored-toward-the-pre-rewrite-fork-s-feature-set-phase-1-bubble/SKILL.md` — load via `/post-launch-ui-depth-pass-bubble-popup-settings-restored-toward-the-pre-rewrite-fork-s-feature-set-phase-1-bubble`._

## Post-launch UI-depth pass, Phase 2: popup

_Moved to `.claude/skills/post-launch-ui-depth-pass-phase-2-popup/SKILL.md` — load via `/post-launch-ui-depth-pass-phase-2-popup`._

## Post-launch UI-depth pass, Phase 3: settings

_Moved to `.claude/skills/post-launch-ui-depth-pass-phase-3-settings/SKILL.md` — load via `/post-launch-ui-depth-pass-phase-3-settings`._

## Post-launch pass: speed, dynamic-content correctness, tag-cluster accuracy

_Moved to `.claude/skills/post-launch-pass-speed-dynamic-content-correctness-tag-cluster-accuracy/SKILL.md` — load via `/post-launch-pass-speed-dynamic-content-correctness-tag-cluster-accuracy`._

## Post-launch pass: three real bugs from the speed/persistent-connection change, plus a default-language fix

_Moved to `.claude/skills/post-launch-pass-three-real-bugs-from-the-speed-persistent-connection-change-plus-a-default-language-fix/SKILL.md` — load via `/post-launch-pass-three-real-bugs-from-the-speed-persistent-connection-change-plus-a-default-language-fix`._

## Post-launch: provider removals (`builtin`, `libretranslate`), shadow-DOM translation, and Google reflow corruption

_Moved to `.claude/skills/post-launch-provider-removals-builtin-libretranslate-shadow-dom-translation-and-google-reflow-corruption/SKILL.md` — load via `/post-launch-provider-removals-builtin-libretranslate-shadow-dom-translation-and-google-reflow-corruption`._

## Explicitly out of scope for v1

_Moved to `.claude/skills/explicitly-out-of-scope-for-v1/SKILL.md` — load via `/explicitly-out-of-scope-for-v1`._

