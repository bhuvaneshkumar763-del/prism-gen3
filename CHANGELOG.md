# prism-gen3

## 0.2.0

### Minor Changes

- Add release infrastructure: a committed Playwright E2E harness (real Chrome via `--headless=new`, not the extension-less `chrome-headless-shell`), a bundle-size CI guardrail, a finalized CI pipeline order (typecheck → lint → engine-purity → foot-gun guards → tests+coverage → build → bundle-size → E2E → zip), per-browser zip artifact uploads, a Firefox build-validation CI job, and a release workflow triggered by CI's own completion (idempotent, auto-detects prerelease versions) using Changesets for versioning/changelog.
