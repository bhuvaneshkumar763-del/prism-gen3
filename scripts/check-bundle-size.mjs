#!/usr/bin/env node
// Bundle-size guard: fails when a packed build grows past a limit, so an
// accidental dependency pulled into one bundle is caught before it ships.
// Checks the total and the largest single file of each build, since one
// bundle can bloat while the total still fits.
//
// Usage: node scripts/check-bundle-size.mjs [chrome|firefox ...]   (default: both)
//
// Limits sit about 1.5x over the measured build (~233KB total, largest file
// content.js ~98KB): room for features, not for another large library. If
// growth is legitimate, raise them and re-anchor this note to the new figures.

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUILDS = { chrome: '.output/chrome-mv3', firefox: '.output/firefox-mv2' };
export const LIMITS = { totalBytes: 300 * 1024, fileBytes: 150 * 1024 };

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

/** Total bytes under `dir` and its largest file. Throws when `dir` doesn't exist. */
function measure(dir) {
  let total = 0;
  let largest = { path: '', size: 0 };
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      total += stat.size;
      if (stat.size > largest.size) largest = { path: relative(dir, full).split('\\').join('/'), size: stat.size };
    }
  };
  walk(dir);
  return { total, largest };
}

/** Checks each `{ name: dir }` build against `limits`; `problems` is empty when all pass. */
export function checkBuilds(builds, limits = LIMITS) {
  const problems = [];
  const lines = [];
  for (const [name, dir] of Object.entries(builds)) {
    let result;
    try {
      result = measure(dir);
    } catch {
      problems.push(`${name}: no build found at ${dir}; build it first.`);
      continue;
    }
    const { total, largest } = result;
    if (total > limits.totalBytes)
      problems.push(`${name}: total ${kb(total)} exceeds the ${kb(limits.totalBytes)} limit.`);
    if (largest.size > limits.fileBytes)
      problems.push(
        `${name}: ${largest.path} is ${kb(largest.size)}, over the ${kb(limits.fileBytes)} per-file limit.`,
      );
    lines.push(`${name}: total ${kb(total)}, largest ${largest.path} ${kb(largest.size)}`);
  }
  return { problems, lines };
}

function main(names) {
  const chosen = names.length ? names : Object.keys(BUILDS);
  const unknown = chosen.filter((name) => !(name in BUILDS));
  if (unknown.length) {
    console.error(`Unknown build ${unknown.join(', ')}; expected one of: ${Object.keys(BUILDS).join(', ')}.`);
    process.exit(1);
  }
  const { problems, lines } = checkBuilds(Object.fromEntries(chosen.map((name) => [name, BUILDS[name]])));
  for (const line of lines) console.log(line);
  if (problems.length) {
    for (const problem of problems) console.error(`Bundle-size check FAILED: ${problem}`);
    console.error('If this growth is legitimate, raise LIMITS in scripts/check-bundle-size.mjs with a note on why.');
    process.exit(1);
  }
  console.log(`Bundle-size check passed (limits: ${kb(LIMITS.totalBytes)} total, ${kb(LIMITS.fileBytes)} per file).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
