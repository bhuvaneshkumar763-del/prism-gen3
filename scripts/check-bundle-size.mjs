#!/usr/bin/env node
// Bundle-size guardrail (Gen 3 plan, Session 9). Fails the build if the
// packed Chrome output grows past a threshold — catches an accidental
// dependency bloat (e.g. a full library pulled in for one helper) before
// it ships, without being so tight that legitimate feature growth trips
// it constantly.
//
// Threshold picked from a real measurement, not a round number pulled out
// of the air: the actual Session 8 build totals ~286KB (see `wxt build`'s
// own size report). 1MB gives ~3.5x headroom over that — enough for
// Sessions yet to land real feature weight (i18n corpus, more providers'
// worth of UI, DeepL if it comes back) without masking a real regression
// the way a multi-MB placeholder would.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = '.output/chrome-mv3';
const MAX_BYTES = 1 * 1024 * 1024; // 1MB

function totalSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    total += stat.isDirectory() ? totalSize(full) : stat.size;
  }
  return total;
}

let size;
try {
  size = totalSize(BUILD_DIR);
} catch {
  console.error(`Bundle-size check FAILED: no build found at ${BUILD_DIR} — run "npm run build" first.`);
  process.exit(1);
}

const sizeKb = (size / 1024).toFixed(1);
const maxKb = (MAX_BYTES / 1024).toFixed(0);

if (size > MAX_BYTES) {
  console.error(`Bundle-size check FAILED: ${sizeKb}KB exceeds the ${maxKb}KB threshold.`);
  console.error('If this growth is legitimate, raise MAX_BYTES in scripts/check-bundle-size.mjs with a note on why.');
  process.exit(1);
}

console.log(`Bundle-size check passed — ${sizeKb}KB (threshold ${maxKb}KB).`);
