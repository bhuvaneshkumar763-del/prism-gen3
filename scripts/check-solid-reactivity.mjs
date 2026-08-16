#!/usr/bin/env node
// Solid-reactivity guard (Gen 3 plan, Session 8 hardening pass): fails the
// build if any .tsx file reads `configStore.get(...)` directly inside a
// JSX expression. This is the exact class of bug the old repo's Session 5
// CLAUDE.md documents shipping THREE separate times before a guard
// existed: `configStore.get(key)` is a plain mutable-object read, not a
// Solid signal call — Solid's fine-grained reactivity only re-renders a
// JSX expression when a tracked signal/store accessor it read last time
// changes value, and a plain method call on a non-reactive object is
// invisible to that tracking. The symptom in every one of those old
// incidents was identical: a checkbox/select/label rendered the *initial*
// value correctly, then silently never updated again after the user (or
// another part of the extension) changed the underlying setting.
//
// The fix, applied consistently in this codebase's popup/options
// components (see their own header comments): mirror `configStore` into a
// local `createSignal`/`createStore` on mount, update it via
// `configStore.onChanged()`, and read *that* inside JSX — never
// `configStore.get()` directly. This script is the mechanical enforcement
// that keeps that convention from silently drifting, the same role
// `check-engine-purity.mjs` plays for the engine/platform boundary.
//
// Deliberately narrow (matches only `configStore.get(` inside a JSX
// interpolation prefix) rather than a general "no direct property reads
// in JSX" rule — `configStore` is the one non-reactive store this
// codebase has; a broader rule would need a real JSX/TSX parser to avoid
// false positives on legitimately-reactive Solid signal calls.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GUARDED_DIRS = ['entrypoints', 'components'];
// Matches `={configStore.get(` or `>{configStore.get(` — the two JSX
// contexts a value gets interpolated in (an attribute/prop, or as a
// child) — but not e.g. `onMount(() => { ...configStore.get(...) })`,
// which runs once imperatively and isn't a reactivity bug.
//
// `\s*` between the `=`/`>` and the `{` (not the original bare `[=>]\{`):
// a JSX child expression routinely sits on its OWN line —
//   <span>
//     {configStore.get('theme')}
//   </span>
// — with the closing `>` and the opening `{` on separate lines. The
// original pattern required them adjacent on one line, so it only ever
// caught the (rarer) same-line attribute form and silently missed this
// multi-line child form, which is this codebase's actually-dominant JSX
// style — exactly the bug class this guard exists to catch.
//
// `(?<!=)>` instead of a bare `>`: this codebase writes `createMemo(() =>`
// / `onMount(async () =>` constantly, and an arrow function's `=>` is a
// `>` too — spanning multiple lines to find the `{` (a JSX guard needs to,
// per the above) means an arrow immediately followed by its own `{ ... }`
// body just a couple of lines above an unrelated, legitimately-imperative
// `configStore.get(` call (inside that same onMount, say) would otherwise
// match. Excluding `=>` specifically keeps real JSX closing tags matching
// while ruling out the single most common false-positive source.
//
// Matched against the whole file (not line-by-line) so the gap can span
// real newlines — but bounded to `{0,80}` characters of arbitrary content,
// NOT the unbounded `[^}]*` a naive fix would reach for. A regex can't
// track nested-brace depth, so an unbounded `[^}]*` doesn't stop at the
// end of the JSX expression that opened it — it keeps matching through
// any number of intervening `{`/other-non-`}` characters until the FIRST
// `}` anywhere later in the file, which can bridge clean across a large,
// entirely unrelated function body to a `configStore.get(` inside a
// totally different context and misreport it as a JSX read. 80 chars
// comfortably covers a short prefix expression on the same or next line
// without being able to reach that far.
const JSX_UNREACTIVE_READ_PATTERN = /(?:(?<!=)>|=)\s*\{[^}]{0,80}\bconfigStore\.get\(/g;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.tsx$/.test(entry) && !entry.endsWith('.test.tsx')) {
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
    continue;
  }
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const pattern = new RegExp(JSX_UNREACTIVE_READ_PATTERN);
    let match = pattern.exec(content);
    while (match !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      violations.push(
        `${file}:${lineNum}: reads configStore.get() directly inside JSX — ${lines[lineNum - 1]?.trim() ?? ''}`,
      );
      match = pattern.exec(content);
    }
  }
}

if (violations.length > 0) {
  console.error('Solid-reactivity check FAILED:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nconfigStore.get() is a plain (non-reactive) read — Solid will not re-render this JSX when the setting changes.' +
      ' Mirror the value into a createSignal/createStore on mount + configStore.onChanged(), and read that in JSX instead.',
  );
  process.exit(1);
}

console.log('Solid-reactivity check passed — no direct configStore.get() reads found inside JSX.');
