#!/usr/bin/env node
// Solid-reactivity guard: `configStore.get()` is a plain, non-reactive read, so
// JSX that renders it never updates when the setting changes. Parses each .tsx
// file under entrypoints/ and components/ with the TypeScript compiler and fails on:
//   1. `configStore.get(...)` evaluated directly inside a JSX expression;
//   2. a call, inside a JSX expression, to a local function whose body reads
//      `configStore.get(...)` (e.g. `const label = () => configStore.get('x')` then `{label()}`);
//   3. `createMemo(...)` whose function reads `configStore.get(...)` — the memo can never update.
// Event handlers (`onClick={() => configStore.get(...)}`) read at event time and are fine.
//
// Usage: node scripts/check-solid-reactivity.mjs [dir ...]   (default: entrypoints components)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_DIRS = ['entrypoints', 'components'];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx$/.test(entry) && !entry.endsWith('.test.tsx')) files.push(full);
  }
  return files;
}

const isFunctionLike = (node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node);

function isConfigStoreGet(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'get' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'configStore'
  );
}

function containsConfigStoreGet(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (isConfigStoreGet(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** True when `node` sits in a JSX expression with no function boundary in between (so it runs during render). */
function isEvaluatedInJsx(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isFunctionLike(p)) return false;
    if (ts.isJsxExpression(p)) return true;
  }
  return false;
}

export function checkFiles(files) {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (node) =>
      `${relative(REPO_ROOT, file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    // Local functions (const x = () => …, function x() {…}) whose body reads configStore.get().
    const nonReactiveFns = new Set();
    const collect = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        isFunctionLike(node.initializer)
      ) {
        if (containsConfigStoreGet(node.initializer.body)) nonReactiveFns.add(node.name.text);
      } else if (ts.isFunctionDeclaration(node) && node.name && node.body && containsConfigStoreGet(node.body)) {
        nonReactiveFns.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);

    const visit = (node) => {
      if (isConfigStoreGet(node) && isEvaluatedInJsx(node)) {
        violations.push(`${at(node)}: reads configStore.get() directly inside JSX`);
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        nonReactiveFns.has(node.expression.text) &&
        isEvaluatedInJsx(node)
      ) {
        violations.push(`${at(node)}: renders ${node.expression.text}(), which reads configStore.get()`);
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'createMemo' &&
        node.arguments[0] &&
        containsConfigStoreGet(node.arguments[0])
      ) {
        violations.push(`${at(node)}: createMemo() reads configStore.get(), so it never updates`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

function main(args) {
  const dirs = args.length > 0 ? args : DEFAULT_DIRS;
  const files = dirs.flatMap((dir) => walk(resolve(REPO_ROOT, dir)));
  const violations = checkFiles(files);
  if (violations.length > 0) {
    console.error('Solid-reactivity check FAILED:\n');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      '\nconfigStore.get() is a plain (non-reactive) read — Solid will not re-render when the setting changes.' +
        ' Mirror the value into a createSignal/createStore on mount + configStore.onChanged(), and read that in JSX instead.',
    );
    process.exit(1);
  }
  console.log(`Solid-reactivity check passed — ${files.length} .tsx files in ${dirs.join(', ')}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
