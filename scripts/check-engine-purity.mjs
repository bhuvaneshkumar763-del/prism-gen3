#!/usr/bin/env node
// Engine-purity guard: src/engine/ and src/shared/ must not depend on the
// browser extension, so the engine can run anywhere (tests, other surfaces).
// Parses each file with the TypeScript compiler and fails on:
//   1. an import (static, dynamic, `export … from`, `import x = require`) of a
//      browser-extension or WXT module, or of src/platform/, entrypoints/ or
//      components/;
//   2. a use of an ambient extension global (`chrome`, `browser`) or of a WXT
//      auto-import (`storage`, `defineBackground`, …) that the file doesn't
//      declare or import itself.
//
// Usage: node scripts/check-engine-purity.mjs [dir ...]   (default: src/engine src/shared)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_DIRS = ['src/engine', 'src/shared'];
const DISALLOWED_MODULES = [/^wxt($|\/)/, /^@wxt-dev\//, /^webextension-polyfill$/, /^#imports$/, /^@webext-core\//];
const DISALLOWED_LAYERS = ['src/platform', 'entrypoints', 'components'].map((p) => join(REPO_ROOT, p));
const AMBIENT_GLOBALS = new Set([
  'chrome',
  'browser',
  'storage',
  'defineBackground',
  'defineContentScript',
  'defineUnlistedScript',
  'createShadowRootUi',
  'createIntegratedUi',
  'createIframeUi',
  'injectScript',
  'useAppConfig',
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

/** Every module specifier the file imports or re-exports, with its position. */
function moduleSpecifiers(sourceFile) {
  const found = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) found.push(expr);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) found.push(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Names the file declares or imports anywhere (an approximation of scope that is enough for this guard). */
function declaredNames(sourceFile) {
  const names = new Set();
  const addBinding = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) names.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) if (!ts.isOmittedExpression(el)) addBinding(el.name);
    }
  };
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportClause(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      addBinding(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** True when `node` is an identifier used as a value or type reference (not a property name or a declaration's own name). */
function isReference(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent)) &&
    parent.name === node
  )
    return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if ('name' in parent && parent.name === node) return false;
  return true;
}

export function checkFiles(files) {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx(\.txt)?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const at = (node) =>
      `${relative(REPO_ROOT, file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    for (const spec of moduleSpecifiers(sourceFile)) {
      const name = spec.text;
      if (DISALLOWED_MODULES.some((re) => re.test(name))) {
        violations.push(`${at(spec)}: imports the extension/framework module '${name}'`);
      } else if (name.startsWith('.')) {
        const target = resolve(dirname(file), name);
        const layer = DISALLOWED_LAYERS.find((dir) => target === dir || target.startsWith(dir + sep));
        if (layer) violations.push(`${at(spec)}: imports '${name}' from ${relative(REPO_ROOT, layer)}/`);
      }
    }

    const declared = declaredNames(sourceFile);
    const visit = (node) => {
      if (ts.isIdentifier(node) && AMBIENT_GLOBALS.has(node.text) && !declared.has(node.text) && isReference(node)) {
        violations.push(`${at(node)}: uses the ambient extension/WXT global '${node.text}'`);
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
    console.error('Engine-purity check FAILED:\n');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      '\nsrc/engine/ and src/shared/ must not depend on the browser extension — inject it through a port implemented in src/platform/ instead. See src/engine/README.md.',
    );
    process.exit(1);
  }
  console.log(`Engine-purity check passed — ${files.length} files in ${dirs.join(', ')}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
