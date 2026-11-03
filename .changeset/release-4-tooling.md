---
"prism-gen3": patch
---

**Release 4: safer releases and checks that check.** Nothing about how pages are translated changes.

- **Release notes and the real-page check are a tested script** (`scripts/release-notes.mjs`) instead of untested shell lines in the workflow.
- **A re-run release no longer ships an unsigned Firefox add-on.** When Mozilla says the version already exists, the release now downloads the copy Mozilla already signed. That is what had to be done by hand for 0.3.1.
- **The two CI guards now really catch what they claim.** Both read the code with the TypeScript parser instead of text patterns, and their own tests run broken examples through them: framework imports, imports from the wrong layer, ambient extension globals, and settings read in a way the screen won't update from.
- **CI is pinned and locked down.** Every GitHub Action is pinned to an exact commit, workflows get read-only permissions unless they need more, Firefox signing uses `web-ext` from the lockfile, and Dependabot proposes updates weekly.
- **The Safari app is current.** Its copy of the extension was three betas old and still held the removed AI provider; it now matches, its version follows `package.json`, CI fails when it falls behind, and a new workflow builds the macOS and iOS apps.
- **Coverage is checked per folder**, so a folder that loses tests fails CI.

Checked on: built extension in desktop Chromium (9 end-to-end checks; saved sangtacviet search, pixiv and Wikipedia pages), plus live free Google, 2026-11-03. iPhone check comes before stable 0.3.2.
