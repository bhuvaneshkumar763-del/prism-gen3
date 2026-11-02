// Replays every saved page with no network and checks the result (fix plan, N-1).
//
//   npm run test:replay              check every case
//   npm run test:replay -- <name>    check one case
//   npm run test:replay -- --update  rewrite expected.txt from this build's output
//
// A case fails when:
// - the extension asks Google for a piece the recording doesn't have (a
//   "miss": the pieces sent changed, so re-record with replay:record), or
// - the translated text nodes differ from expected.txt, or
// - one of case.json's optional checks fails:
//     "mustContain":    strings the translated page must contain
//     "mustNotContain": strings it must not (e.g. source text that should
//                       have been translated)
//
// Requires `npm run build` first. See harness.mjs for the case format and
// record.mjs for adding a page.

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  hookGoogle,
  launch,
  pagesDir,
  readCase,
  readHook,
  readTextNodes,
  servePage,
  translateAndWait,
} from './harness.mjs';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { update: { type: 'boolean' } } });
const names = positionals.length > 0 ? positionals : readdirSync(pagesDir).sort();
let failures = 0;

for (const name of names) {
  const testCase = readCase(name);
  const problems = await replay(testCase);
  if (problems.length === 0) {
    console.log(`pass ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`);
    for (const problem of problems) console.error(`  ${problem.replaceAll('\n', '\n  ')}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${names.length} replay case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${names.length} replay case(s) passed.`);

async function replay(testCase) {
  const browser = await launch();
  try {
    await hookGoogle(browser.worker, 'replay', testCase.google);
    const served = await servePage(browser.context, testCase.html);
    const page = await browser.context.newPage();
    await page.goto(served.url, { waitUntil: 'load' });
    const { error } = await translateAndWait(page, browser.worker, testCase.meta.to);
    const text = await readTextNodes(page);
    served.close();

    // The worker restarting would drop the hook and let requests reach the real network.
    const hook = await readHook(browser.context.serviceWorkers()[0]);
    if (!hook) return ['the service worker restarted mid-run, so the replay hook was lost'];

    const problems = [];
    if (hook.misses.length > 0) {
      const sample = hook.misses.slice(0, 3).map((k) => JSON.parse(k)[2].slice(0, 120));
      problems.push(
        `${hook.misses.length} piece(s) not in the recording — re-record with: npm run replay:record -- ${testCase.name}\n` +
          sample.map((s) => `  e.g. ${JSON.stringify(s)}`).join('\n'),
      );
    }
    if (error) problems.push(`the extension reported an error: ${error}`);
    for (const s of testCase.meta.mustContain ?? []) {
      if (!text.includes(s)) problems.push(`missing ${JSON.stringify(s)}`);
    }
    for (const s of testCase.meta.mustNotContain ?? []) {
      if (text.includes(s)) problems.push(`still contains ${JSON.stringify(s)}`);
    }
    if (values.update && hook.misses.length === 0) {
      writeFileSync(join(testCase.dir, 'expected.txt'), text);
    } else if (text !== testCase.expected) {
      problems.push(describeDiff(testCase.expected ?? '', text));
    }
    return problems;
  } finally {
    await browser.close();
  }
}

function describeDiff(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const lines = [`text differs from expected.txt (${a.length - 1} lines expected, ${b.length - 1} actual):`];
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 8; i++) {
    if (a[i] === b[i]) continue;
    lines.push(
      `  line ${i + 1}: expected ${JSON.stringify(a[i] ?? null)}`,
      `  ${' '.repeat(String(i + 1).length + 6)}got ${JSON.stringify(b[i] ?? null)}`,
    );
    shown++;
  }
  return lines.join('\n');
}
