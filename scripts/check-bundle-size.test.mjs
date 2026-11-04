import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILDS, checkBuilds } from './check-bundle-size.mjs';

const limits = { totalBytes: 1000, fileBytes: 600 };
let root;

/** A fake build folder: `files` maps a relative path to its size in bytes. */
function build(name, files) {
  for (const [path, size] of Object.entries(files)) {
    const full = join(root, name, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'x'.repeat(size));
  }
  return join(root, name);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bundle-size-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('bundle-size guard', () => {
  it('checks the Chrome and the Firefox build by default', () => {
    expect(Object.keys(BUILDS)).toEqual(['chrome', 'firefox']);
  });

  it('passes builds under both limits', () => {
    const dir = build('ok', { 'a.js': 400, 'chunks/b.js': 400 });
    const { problems, lines } = checkBuilds({ chrome: dir }, limits);
    expect(problems).toEqual([]);
    expect(lines[0]).toMatch(/chrome/);
  });

  it('fails a build whose total is over the limit, counting nested folders', () => {
    const dir = build('big', { 'a.js': 500, 'chunks/b.js': 300, 'chunks/deep/c.js': 300 });
    const { problems } = checkBuilds({ chrome: dir }, limits);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/chrome.*total/);
  });

  it('fails one file over the per-file limit even when the total fits', () => {
    const dir = build('onefile', { 'content-scripts/content.js': 700 });
    const { problems } = checkBuilds({ firefox: dir }, limits);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/firefox.*content-scripts\/content\.js/);
  });

  it('fails a Firefox-only bloat while Chrome is fine', () => {
    const chrome = build('c', { 'a.js': 400 });
    const firefox = build('f', { 'a.js': 400, 'b.js': 500, 'c.js': 500 });
    const { problems } = checkBuilds({ chrome, firefox }, limits);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/firefox/);
  });

  it('fails a missing build instead of skipping it', () => {
    const { problems } = checkBuilds({ firefox: join(root, 'nope') }, limits);
    expect(problems[0]).toMatch(/no build found/);
  });
});
