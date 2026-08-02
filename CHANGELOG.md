# prism-gen3

## 0.2.2-beta.1

### Patch Changes

- Fix two real bugs reported by a user testing the beta: translation never worked out of the box because the shipped default provider (libretranslate.com, unauthenticated) is rate-limited to the point of being unusable — the default is now 'google' (free, no signup, confirmed working live). Separately, a totally failing provider used to report a false "Translated" success with zero visible error in the popup/bubble; the page translator now tracks consecutive batch failures and surfaces a real "Translation failed" state in the floating bubble instead of silently retrying forever.

## 0.2.2-beta.0

### Patch Changes

- Enter changesets prerelease ("beta") mode. Gen 3's 10-session plan is complete and the codebase is ready for real-world testing before a stable v1 — releases now ship as `X.Y.Z-beta.N` prereleases (auto-detected by the release workflow, which marks the GitHub Release as a prerelease) until this project exits beta with `npx changeset pre exit`.

## 0.2.1

### Patch Changes

- Session 10 (parity audit and launch readiness): compile the ADR index, a full old-repo-vs-Gen-3 feature/provider parity checklist, and an explicit out-of-scope-for-v1 list. Found and documented a real gap via manual verification: content inside an open shadow root on a third-party page is never translated (`collectTextNodes.ts` doesn't descend into shadow roots). No source behavior changed.

## 0.2.0

### Minor Changes

- Add release infrastructure: a committed Playwright E2E harness (real Chrome via `--headless=new`, not the extension-less `chrome-headless-shell`), a bundle-size CI guardrail, a finalized CI pipeline order (typecheck → lint → engine-purity → foot-gun guards → tests+coverage → build → bundle-size → E2E → zip), per-browser zip artifact uploads, a Firefox build-validation CI job, and a release workflow triggered by CI's own completion (idempotent, auto-detects prerelease versions) using Changesets for versioning/changelog.
