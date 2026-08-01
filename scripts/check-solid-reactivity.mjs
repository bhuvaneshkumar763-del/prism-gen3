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
const JSX_UNREACTIVE_READ_PATTERN = /[=>]\{[^}]*\bconfigStore\.get\(/;

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
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (JSX_UNREACTIVE_READ_PATTERN.test(line)) {
        violations.push(`${file}:${i + 1}: reads configStore.get() directly inside JSX — ${line.trim()}`);
      }
    });
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
