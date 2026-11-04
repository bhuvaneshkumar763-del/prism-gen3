#!/usr/bin/env node
// Mirrors a fresh `wxt build -b safari` into the Xcode project's extension
// resources and sets the app version. A plain copy, not the converter's
// --rebuild-project, which regenerates the whole project and drops its
// signing team and Swift edits.
//
// Run via `npm run safari:sync` (which builds first).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestVersionFor } from '../src/shared/manifestVersion.ts';

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

// Replaced wholesale so a chunk a later build dropped doesn't linger.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

// iOS doesn't allow a persistent background page, and MV2 defaults to one.
// background.ts already survives being stopped and restarted, so macOS gets
// the same setting.
const manifestPath = join(dest, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
if (manifest.background) manifest.background.persistent = false;
writeFileSync(manifestPath, JSON.stringify(manifest));

// The app's version follows package.json: marketing version X.Y.Z, and a
// build number (the manifest's fourth part) that rises with every release.
const pkgVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version;
const [major, minor, patch, build] = manifestVersionFor(pkgVersion).split('.');
const pbxprojPath = join(xcodeproj, 'project.pbxproj');
const pbxproj = readFileSync(pbxprojPath, 'utf-8')
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${major}.${minor}.${patch};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build ?? 0};`);
writeFileSync(pbxprojPath, pbxproj);

console.log(`Synced ${source} -> ${dest} (background.persistent forced to false for Safari)`);
console.log(`Xcode project version: ${major}.${minor}.${patch} (build ${build ?? 0})`);
console.log('Open safari/Prism/Prism.xcodeproj in Xcode (or `xcodebuild`) to build/run.');
