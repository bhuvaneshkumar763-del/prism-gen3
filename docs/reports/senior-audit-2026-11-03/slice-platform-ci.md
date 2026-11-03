# Slice: platform, shared, scripts, CI, harnesses — Grade B−

317/317 tests pass (96% statements, 92% branches). Both guards were run against bad fixtures.

## Top findings
- **Med NEW** wxt.config.ts:15-16, scripts/fetch-signed-xpi.mjs:29-31: betas map to `X.Y.Z.N` and stable to `X.Y.Z`, so a stable release is always older than its own betas. 0.3.1 dodged it once; the next cycle (0.3.2-beta.N → 0.3.2.N, then stable 0.3.2) repeats the 0.3.0 failure. Other prerelease tags (`-rc.0`) pass straight through as invalid manifest versions. (read-verified)
- **Med NEW** release.yml:129-158, 175-182: a re-run after AMO signing succeeded falls back silently to the unsigned zip (`continue-on-error`). This happened on 0.3.1 and was fixed by hand with fetch-signed-xpi.
- **Med NEW** safari/Prism/…/Resources: the committed Safari bundle is beta.70 (manifest 0.3.0.70) and still contains the LLM code. `MARKETING_VERSION = 1.0` (project.pbxproj:630) has never been bumped. Not in CI. (Orion on iPhone installs the Chrome/Firefox build, so the owner isn't affected today.)
- **Med KNOWN** listMutations.ts:130-154: language add/remove match exactly, while the decision compares base tags (never-list first). `zh` on never plus "Always translate from Chinese" on a `zh-CN` page means the toggle reads ON but the page never auto-translates.
- **Med KNOWN** translationCache.ts:122, 370 + options/App.tsx:163: Clear cache resets only the options page's instance; the background evicts fresh entries until the worker restarts.
- **Med KNOWN** check-engine-purity.mjs:20, 36; check-solid-reactivity.mjs:69: both guards pass broken fixtures (`#imports`, `@webext-core/messaging`, `../platform/configStore`, WXT `storage`; `const label = () => configStore.get(...)`, `createMemo`). (ran it)
- **Low NEW** translationCache.ts:133-135, 167-168: a failed `indexedDB.open` is cached forever (the `configStore.onReady` fix wasn't copied), so one WebKit "connection lost" turns the cache off for the background's lifetime.
- **Low NEW** translationCache.ts: no `onabort`, so a quota failure leaves `setMany` unsettled.
- **Low KNOWN:** eviction byte-count race; no `onversionchange`/`onblocked`; configStore init/onChanged race and no rollback; fetch-signed-xpi shows "not approved yet" as a red run, leaves two Firefox assets, and keeps write credentials; actions pinned to movable tags and `npx web-ext` dependencies outside the lockfile.
- **Fixed since beta.70:** www/apex site lists; apex-aware language helpers; `persist-credentials: false`; the LLM credential leaks are gone (migration 5, backups strip keys); release-body trimming; solid-js 1.9.18.

## CI, release, tooling
- **Solid:** gated, ordered CI; release builds the exact `head_sha` CI tested; secrets scoped per step; the changelog gate runs before install.
- **The replay harness is the best engineering in the repo** (per-piece recordings, network blocked, misses and service-worker restarts detected). But it has only 3 cases, desktop Chrome only, and no sangtacviet *chapter*.
- **E2E calls live Google but asserts nothing about the output.** It's not hermetic and wouldn't catch Google changing its API. A daily scheduled canary (one page, assert the text changed) is the cheapest early warning for the biggest risk.
- **Release logic is inline bash in YAML,** with no local tests; two of the three failed runs broke in this layer.
- **The `Checked on:` gate is a speed bump, not a check:** the releasing session writes the line, and 0.3.1 cites the beta.73 check although solid-js changed.
- **The coverage gate is one global threshold.** background.ts and content.ts are excluded, and a new file can land at 0% (`icons.ts`).
- **Safari isn't in CI;** delete the Xcode project or sync it during release.
- **Dependencies:** a small tree, lockfile installs, Biome pinned. No Dependabot.

## Design
- **Good:** `validate.ts` mapped type keeps schema and validators in sync; list mutations as pure snapshot→patch functions; `withTimeout` and frame-id routing are clean.
- The hand-kept, per-instance cache byte counter causes three bugs. Recompute the total in the eviction transaction instead.
- Copied rules keep recurring: `getDb` missed `onReady`'s fix; the provider-removal remap exists twice (migrations.ts and backup.ts — `parseBackup` should run `applyConfigMigrations`).
- Comments are mostly incident narrative, often over half a file, and several are stale.

## Tests
- Regression-named tests; the cache is tested against real fake-indexeddb.
- Gaps line up with the bugs: no two-instance cache test, no abort/quota test, no reopen-recovery test, no regional-language cross-list test, no concurrent `setMany`/evict test.
- Scripts are untested; the guards were shown to pass bad input. A fixtures folder that CI expects to be rejected is about 30 minutes of work.

## Verdict
The runtime core is sound and more careful than most hobby extensions. The weak points are release engineering (the version scheme will break the next stable, silent unsigned fallback, stale Safari bundle) and drift (copied rules, stale comments). Before the next stable tag: fix the manifest-version mapping, and make the AMO step fall back to fetching the signed file.
