#!/usr/bin/env node
// Writes the pages' reports as a Markdown table for the job summary.
//   node tests/ios-sim/summary.mjs <results.json>

import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.log('No page reports were written: Prism never ran on a test page.');
  process.exit(0);
}
const results = JSON.parse(readFileSync(file, 'utf8'));
console.log('| Page | Bubble | Translated | All at once | Restored | Doubled bracket | Error |');
console.log('|---|---|---|---|---|---|---|');
for (const [page, r] of Object.entries(results)) {
  const yes = (v) => (v ? 'yes' : 'no');
  console.log(
    `| ${page} | ${yes(r.bubblePresent)} | ${r.translated}/${r.total} | ${yes(r.everAllTranslated)} | ${yes(r.restoredExact)} | ${yes(r.doubledBracket)} | ${r.bubbleError ?? ''} |`,
  );
}
