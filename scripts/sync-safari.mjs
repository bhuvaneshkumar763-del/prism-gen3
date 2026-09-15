#!/usr/bin/env node
// Syncs the Safari Xcode project's web-extension resources from a fresh
// `wxt build -b safari` output.
//
// Deliberately NOT `xcrun safari-web-extension-converter --rebuild-project`
// — tested directly and confirmed that flag fully REGENERATES the whole
// Xcode project (targets, build settings, boilerplate Swift files) from
// scratch rather than just refreshing the copied resources. That's fine
// for a from-scratch project, but it silently discards this project's own
// customization — the baked-in `DEVELOPMENT_TEAM` in every build
// configuration (see `safari/README.md`), any future hand-edits to
// `SafariWebExtensionHandler.swift`/`AppDelegate.swift`, and it renames
// derived-data paths, invalidating any open Xcode session. The web
// extension itself is 100% the WXT build output — nothing in
// `Shared (Extension)/Resources` needs Xcode-side intelligence to update,
// so a plain directory mirror is the correct, minimal operation. Confirmed
// via `find` that this folder's contents are an exact 1:1 mirror of
// `.output/safari-mv2`.
//
// Run via `npm run safari:sync` (which builds first) or directly after
// your own `wxt build -b safari`.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, '.output', 'safari-mv2');
const xcodeproj = join(repoRoot, 'safari', 'Prism', 'Prism.xcodeproj');
const dest = join(repoRoot, 'safari', 'Prism', 'Shared (Extension)', 'Resources');

if (!existsSync(source)) {
  console.error(
    `No build found at ${source} — run "npm run build:safari" first (or use "npm run safari:sync", which does both).`,
  );
  process.exit(1);
}
if (!existsSync(xcodeproj)) {
  console.error(
    `No Xcode project found at ${xcodeproj} — the Safari project scaffold is expected to already exist in the repo (see safari/README.md for how it was generated).`,
  );
  process.exit(1);
}

// Replace wholesale (not merge) so a file removed from a later WXT build
// (e.g. a renamed chunk) doesn't linger as stale dead weight in the Xcode
// project forever.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

// Real compatibility gap, found via Apple's own converter output: `xcrun
// safari-web-extension-converter` warns "Persistent background pages are
// not supported on iOS and iPadOS" — the MV2 manifest WXT generates has no
// `background.persistent` key, which defaults to `true` per the MV2 spec
// (matching this codebase's Firefox MV2 build, where a persistent
// background page is the norm and expected). Chrome's MV3 build already
// runs under the OPPOSITE assumption — a service worker that Chrome can
// evict at any idle moment, which is exactly why `entrypoints/background.ts`
// already has the whole `chrome.alarms`-based keepalive mechanism and
// tolerates its own module state being torn down and rebuilt on a fresh
// wake. Setting `persistent: false` here makes Safari's background page
// behave the same way on BOTH iOS (where it's required) and macOS (where
// it's optional but strictly more correct, given the codebase already
// assumes a background context that can be evicted and restarted, not a
// forever-alive one) — a single, universal manifest edit rather than a
// macOS/iOS-specific special case.
const manifestPath = join(dest, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
if (manifest.background) manifest.background.persistent = false;
writeFileSync(manifestPath, JSON.stringify(manifest));

console.log(`Synced ${source} -> ${dest} (background.persistent forced to false for Safari)`);
console.log('Open safari/Prism/Prism.xcodeproj in Xcode (or `xcodebuild`) to build/run.');
