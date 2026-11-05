#!/usr/bin/env node
// Copies the UI test's named screenshots and element-tree dumps out of an
// `xcresulttool export attachments` folder, named as the test named them.
//   node tests/ios-sim/collect-shots.mjs <export-dir> <out-dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [from, to] = process.argv.slice(2);
mkdirSync(to, { recursive: true });
const manifest = join(from, 'manifest.json');
if (!existsSync(manifest)) {
  console.log('No manifest.json: no attachments were exported.');
  process.exit(0);
}

const found = [];
(function walk(value) {
  if (Array.isArray(value)) return value.forEach(walk);
  if (value && typeof value === 'object') {
    if (typeof value.exportedFileName === 'string' && typeof value.suggestedHumanReadableName === 'string') {
      found.push(value);
    }
    Object.values(value).forEach(walk);
  }
})(JSON.parse(readFileSync(manifest, 'utf8')));

let index = 0;
for (const { exportedFileName, suggestedHumanReadableName } of found) {
  // "chinese-translated_0_<uuid>.png" -> "chinese-translated.png"
  const name = suggestedHumanReadableName.replace(/_\d+_[0-9A-F-]{36}(?=\.\w+$|$)/i, '');
  const keep = (name.endsWith('.png') && !name.startsWith('UI Snapshot')) || name.startsWith('tree-');
  if (!keep) continue;
  index++;
  const target = `${String(index).padStart(2, '0')}-${name.endsWith('.txt') || name.endsWith('.png') ? name : `${name}.txt`}`;
  copyFileSync(join(from, exportedFileName), join(to, target));
  console.log(target);
}
