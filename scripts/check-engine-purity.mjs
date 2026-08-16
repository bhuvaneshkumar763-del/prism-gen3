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
// A FIXED namespace list (storage/tabs/runtime/...) used to be the match
// here — Chrome's extension API surface keeps growing, and nothing
// documented why that particular subset was chosen, so a genuinely
// foreseeable new engine-file dependency (chrome.windows, .notifications,
// .downloads, ...) would silently pass this guard. `chrome`/`browser`
// should never be referenced under src/engine/ or src/shared/ at all per
// the purity boundary, so match ANY property access on either identifier
// rather than trying to keep an allowlist in sync with Chrome's own API
// surface.
//
// Known, accepted gap (not attempted here — needs real static analysis,
// not a regex guard): aliasing (`const c = chrome; c.storage...`), bracket
// access (`chrome['storage']`), and dynamic `import('webextension-polyfill')`
// all evade this. This guard catches the common, accidental case, not
// every deliberate way around it.
const BARE_GLOBAL_PATTERN = /\b(chrome|browser)\.\w+/;

/**
 * Strips `//` and `/* *\/` comments from one line, string-aware — unlike a
 * plain `line.indexOf('/*')`, which treats ANY literal `/*`-looking
 * substring as a comment opener, including one that appears inside a
 * string or regex literal (e.g. a URL, or a regex pattern that happens to
 * contain those two characters in sequence). That desyncs `inBlockComment`
 * for the rest of the file, silently disabling the check entirely from
 * that point on — a real violation later in the same file would never be
 * reported.
 *
 * Known, accepted simplification: `quote` state resets at the start of
 * every line, so a genuine multi-line template literal isn't tracked
 * across lines. Rare in this codebase's style for anything that would
 * contain a chrome/browser reference; full multi-line string tracking
 * would need a real tokenizer, which is disproportionate for this guard.
 */
function stripCommentsFromLine(line, inBlockComment) {
  let result = '';
  let quote = null;
  let i = 0;
  while (i < line.length) {
    if (inBlockComment) {
      const end = line.indexOf('*/', i);
      if (end === -1) return { result, inBlockComment: true };
      i = end + 2;
      inBlockComment = false;
      continue;
    }
    const ch = line[i];
    if (quote) {
      result += ch;
      if (ch === '\\' && i + 1 < line.length) {
        result += line[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      result += ch;
      i++;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') break; // line comment — rest of the line is gone
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) return { result, inBlockComment: true };
      i = end + 2;
      continue;
    }
    result += ch;
    i++;
  }
  return { result, inBlockComment };
}

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
      // use it) must not trip this check. String-aware (see
      // stripCommentsFromLine's own doc comment for why that matters).
      const stripped = stripCommentsFromLine(rawLine, inBlockComment);
      const line = stripped.result; // empty when the whole line was inside a block comment — matches nothing below
      inBlockComment = stripped.inBlockComment;
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
