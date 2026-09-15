#!/usr/bin/env node
// Bundle-size guardrail (Gen 3 plan, Session 9). Fails the build if the
// packed Chrome output grows past a threshold — catches an accidental
// dependency bloat (e.g. a full library pulled in for one helper) before
// it ships, without being so tight that legitimate feature growth trips
// it constantly.
//
// Threshold picked from a real measurement, not a round number pulled out
// of the air — but see the round-5 bloat audit note below for why the
// FIRST version of that sentence wasn't enough on its own.
//
// Original Session 8 threshold: the build totaled ~286KB, and 1MB was
// picked for ~3.5x headroom. That headroom is exactly what let `zod`
// triple itself across the content-script/background/options bundles
// (202KB, 51% of the shipped extension) unnoticed for 51 releases — a
// guard with that much slack only catches a MASSIVE regression, not a
// meaningful one. Round-5 bloat audit (beta.52-53) removed `zod` and cut
// idle-frame cost, landing at a real measured ~194KB. New threshold is
// ~1.5x that — enough for legitimate incremental feature growth between
// audits without hiding another multi-hundred-KB dependency for 50+
// releases. If this growth is legitimate, raise MAX_BYTES with a note on
// why (and re-anchor the headroom multiplier to the new measured total,
// not to this comment's now-historical one).

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = '.output/chrome-mv3';
const MAX_BYTES = 300 * 1024; // 300KB — ~1.5x the ~194KB post-round-5 measured total

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
