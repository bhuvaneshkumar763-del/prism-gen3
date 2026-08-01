#!/usr/bin/env node
// Engine-purity guard (Gen 3 plan, design principle #3): fails the build if
// src/engine/** or src/shared/** import chrome/browser extension APIs or
// any WXT/framework-specific module. This is the mechanical enforcement
// that makes "the engine can be extracted into its own package later"
// actually true, rather than a convention that quietly drifts — see
// src/engine/README.md and src/shared/README.md.
//
// Checks two things per file:
//   1. Static imports from a disallowed module (wxt, @wxt-dev/*,
//      webextension-polyfill, or any other browser-extension-API package).
//   2. Bare `chrome.`/`browser.` identifier usage — these are ambient
//      globals in a WXT extension context (no import needed), so an
//      import-only check would miss real violations.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GUARDED_DIRS = ['src/engine', 'src/shared'];
const DISALLOWED_IMPORT_PATTERN = /from\s+['"](wxt|@wxt-dev\/|webextension-polyfill)/;
const BARE_GLOBAL_PATTERN =
  /\b(chrome|browser)\.(runtime|storage|tabs|scripting|action|commands|contextMenus|i18n|permissions|alarms|offscreen|extension)\b/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      files.push(full);
    }
  }
  return files;
}

const violations = [];

for (const dir of GUARDED_DIRS) {
  let files;
  try {
    files = walk(dir);
  } catch {
    continue; // directory doesn't exist yet — fine, nothing to check
  }
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let inBlockComment = false;
    lines.forEach((rawLine, i) => {
      // Strip comments before matching — a doc comment mentioning
      // "browser.storage" as prose (e.g. explaining why a module DOESN'T
      // use it) must not trip this check. Simple line-based stripping:
      // good enough for this codebase's style (no comment syntax inside
      // string literals containing "chrome."/"browser." expressions,
      // which would be unusual and easy to spot in review anyway).
      let line = rawLine;
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end === -1) return; // whole line is inside the block comment
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const blockStart = line.indexOf('/*');
      if (blockStart !== -1) {
        const blockEnd = line.indexOf('*/', blockStart);
        if (blockEnd === -1) {
          line = line.slice(0, blockStart);
          inBlockComment = true;
        } else {
          line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
        }
      }
      const lineCommentStart = line.indexOf('//');
      if (lineCommentStart !== -1) line = line.slice(0, lineCommentStart);
      // Also skip lines that are purely a jsdoc-style " * ..." continuation.
      if (/^\s*\*/.test(rawLine) && !/^\s*\*\//.test(rawLine)) return;

      if (DISALLOWED_IMPORT_PATTERN.test(line)) {
        violations.push(`${file}:${i + 1}: imports a browser-extension/framework module — ${rawLine.trim()}`);
      }
      if (BARE_GLOBAL_PATTERN.test(line)) {
        violations.push(`${file}:${i + 1}: uses the ambient chrome/browser extension API global — ${rawLine.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Engine-purity check FAILED:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nsrc/engine/ and src/shared/ must have zero browser-extension-API dependencies — inject them via a port implemented in src/platform/ instead. See src/engine/README.md.',
  );
  process.exit(1);
}

console.log('Engine-purity check passed — no chrome/browser/WXT imports found under src/engine/ or src/shared/.');
