# prism-gen3

## 0.2.1

### Patch Changes

- Session 10 (parity audit and launch readiness): compile the ADR index, a full old-repo-vs-Gen-3 feature/provider parity checklist, and an explicit out-of-scope-for-v1 list. Found and documented a real gap via manual verification: content inside an open shadow root on a third-party page is never translated (`collectTextNodes.ts` doesn't descend into shadow roots). No source behavior changed.

## 0.2.0

### Minor Changes

- Add release infrastructure: a committed Playwright E2E harness (real Chrome via `--headless=new`, not the extension-less `chrome-headless-shell`), a bundle-size CI guardrail, a finalized CI pipeline order (typecheck → lint → engine-purity → foot-gun guards → tests+coverage → build → bundle-size → E2E → zip), per-browser zip artifact uploads, a Firefox build-validation CI job, and a release workflow triggered by CI's own completion (idempotent, auto-detects prerelease versions) using Changesets for versioning/changelog.
