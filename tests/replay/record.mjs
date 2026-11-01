// Saves a page as a replay case, or re-records an existing one (fix plan, N-1).
//
//   npm run replay:record -- <name> --url <url> --to <lang> [--note "what went wrong"]
//       Opens the live page, saves its DOM as page.html, then records.
//   npm run replay:record -- <name> --url <url> --html <saved.html> --to <lang>
//       Same, from a page you saved in your own browser ("Save page as",
//       HTML only). Use it for pages behind a login or a bot check.
//   npm run replay:record -- <name>
//       Re-records an existing case: translates its saved page.html against
//       live Google and rewrites google.json and expected.txt. Use this when a
//       code change alters the pieces sent and run.mjs reports misses.
//
// Needs network and a current build (`npm run build`). Read expected.txt
// before committing: it's what CI will hold the extension to, so if the page
// translated badly, fix the bug first or add a check to case.json (see
// run.mjs) that fails until it's fixed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    html: { type: 'string' },
    to: { type: 'string' },
    note: { type: 'string' },
    wait: { type: 'string' },
  },
});
const [name] = positionals;
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error(
    'usage: npm run replay:record -- <name> [--url <url> [--html <file>] --to <lang> --note <text> --wait <ms>]',
  );
  console.error('<name> is lowercase letters, digits and dashes.');
  process.exit(1);
}

const dir = join(pagesDir, name);
if (values.url) {
  if (!values.to) {
    console.error('--to <lang> is required with --url');
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  const source = values.html ? pathToFileURL(resolve(values.html)).href : values.url;
  const html = await snapshot(source, Number(values.wait ?? (values.html ? 500 : 4000)));
  writeFileSync(join(dir, 'page.html'), html);
  const meta = { url: values.url, to: values.to, savedAt: new Date().toISOString().slice(0, 10) };
  if (values.note) meta.note = values.note;
  writeFileSync(join(dir, 'case.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`saved ${values.url} (${Math.round(html.length / 1024)} KB)`);
}

const testCase = readCase(name);
const browser = await launch();
try {
  await hookGoogle(browser.worker, 'record');
  const served = await servePage(browser.context, testCase.html);
  const page = await browser.context.newPage();
  await page.goto(served.url, { waitUntil: 'load' });
  const { error } = await translateAndWait(page, browser.worker, testCase.meta.to);
  const text = await readTextNodes(page);
  const { recording } = await readHook(browser.worker);
  served.close();
  writeFileSync(join(dir, 'google.json'), `${JSON.stringify(recording, null, 1)}\n`);
  writeFileSync(join(dir, 'expected.txt'), text);
  console.log(`recorded ${Object.keys(recording).length} pieces, ${text.split('\n').length - 1} text nodes`);
  if (error) console.warn(`the extension reported an error: ${error}`);
  console.log(`now read ${join(dir, 'expected.txt')} — CI will hold the extension to it`);
} finally {
  await browser.close();
}

/**
 * The live page's DOM as static HTML: scripts, styles and anything that
 * fetches are removed, and open shadow roots are kept as declarative shadow
 * DOM so content like bilibili's comment threads survives. Opened without the
 * extension, so the saved text is the original.
 */
async function snapshot(url, waitMs) {
  const plain = await launch({ withExtension: false });
  try {
    const page = await plain.context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForTimeout(waitMs); // let client-rendered content arrive
    return await page.evaluate(() => {
      const roots = [];
      const collect = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            roots.push(el.shadowRoot);
            collect(el.shadowRoot);
          }
        }
      };
      collect(document);
      const strip = 'script, noscript, style, link, iframe, frame, object, embed, base, meta[http-equiv]';
      for (const root of [document, ...roots]) {
        for (const el of root.querySelectorAll(strip)) el.remove();
      }
      const html = document.documentElement;
      const attrs = [...html.attributes].map((a) => ` ${a.name}="${a.value.replaceAll('"', '&quot;')}"`).join('');
      return `<!doctype html>\n<html${attrs}>${html.getHTML({ shadowRoots: roots })}</html>\n`;
    });
  } finally {
    await plain.close();
  }
}
