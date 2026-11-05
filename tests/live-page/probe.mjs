#!/usr/bin/env node
// Opens a live page with the built extension in Chromium, translates it with
// the bubble, presses the page's own Expand control, and records what stayed
// untranslated at each step. For reproducing a reader's report on a site this
// machine's tests can't save offline.
//
//   node tests/live-page/probe.mjs <out-dir> <url> [<url> ...]
//
// Requires `npm run build` first. Writes <out-dir>/<n>-<step>.png, results.json,
// a page snapshot per URL, and the page's own script lines about its chapter list.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || urls.length === 0) {
  console.error('usage: node tests/live-page/probe.mjs <out-dir> <url> [<url> ...]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const extensionPath = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));
const executablePath = process.env.PROBE_CHROMIUM || undefined;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts the chapter-list rows by language, and notes how the list is clipped. */
function snapshotList() {
  const vietnamese = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
  const han = /[一-鿿]/;
  const container = document.getElementById('chaptercontainer');
  const inner = document.getElementById('chaptercontainerinner') ?? container;
  const rows = inner
    ? Array.from(inner.querySelectorAll('a, li, .listchapitem, div')).filter((el) => !el.querySelector('a, li, div'))
    : [];
  const texts = rows.map((el) => (el.textContent ?? '').trim()).filter(Boolean);
  const count = { vi: 0, zh: 0, other: 0 };
  for (const t of texts) {
    if (vietnamese.test(t)) count.vi++;
    else if (han.test(t)) count.zh++;
    else count.other++;
  }
  const style = container ? getComputedStyle(container) : null;
  const bubble = document.getElementById('prism-bubble-host')?.shadowRoot;
  return {
    rows: texts.length,
    count,
    firstRows: texts.slice(0, 4),
    lastRows: texts.slice(-4),
    untranslatedSamples: texts.filter((t) => vietnamese.test(t) || han.test(t)).slice(0, 6),
    clip: style ? { maxHeight: style.maxHeight, overflow: style.overflow, height: container.clientHeight } : null,
    containerHtml: container ? container.outerHTML.slice(0, 4000) : null,
    bubbleLabel: bubble?.querySelector('.ball')?.getAttribute('aria-label') ?? null,
    bubbleError: bubble?.querySelector('.errorText')?.textContent ?? null,
    translatedAttr: document.documentElement.lang,
  };
}

/** Saves the page's own same-origin script files, so its list and Expand code can be read. */
async function savePageScripts(page, prefix) {
  const scripts = await page.evaluate(async () => {
    const out = [];
    for (const s of Array.from(document.scripts)) {
      if (!s.src || new URL(s.src).origin !== location.origin) continue;
      try {
        out.push({ name: new URL(s.src).pathname.split('/').pop(), text: await (await fetch(s.src)).text() });
      } catch {}
    }
    return out;
  });
  for (const { name, text } of scripts) writeFileSync(join(outDir, `${prefix}-script-${name}`), text);
  return scripts.map((x) => x.name);
}

async function clickExpand(page) {
  const candidates = ['#clicktoexp', 'text=/^\\s*(Expand|Mở rộng|Xem thêm|展开)\\s*$/i'];
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 5000 }).catch(() => {});
      return selector;
    }
  }
  return null;
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
/** iPhone: translate right after the page starts, as auto-translate on load does. Desktop: once the list is in. */
const MODES = [
  { name: 'iphone-early', userAgent: IPHONE_UA, early: true },
  { name: 'desktop', userAgent: undefined, early: false },
];

const results = [];
for (const mode of MODES) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'probe-')), {
    headless: false,
    executablePath,
    viewport: { width: 390, height: 844 },
    userAgent: mode.userAgent,
    args: [
      '--headless=new',
      '--no-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker', { timeout: 15_000 });

  for (const [n, url] of urls.entries()) {
    const prefix = `${n}-${mode.name}`;
    const page = await context.newPage();
    const consoleLines = [];
    page.on('console', (msg) => {
      if (/prism|google/i.test(msg.text())) consoleLines.push(`${msg.type()}: ${msg.text().slice(0, 300)}`);
    });
    const entry = { url, mode: mode.name, steps: {} };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (!mode.early) {
        await page
          .waitForSelector('#chaptercontainerinner a, #chaptercontainerinner div', { timeout: 30_000 })
          .catch(() => {});
        await wait(3000);
      }
      entry.steps.loaded = await page.evaluate(snapshotList);
      await page.locator('#prism-bubble-host .ball').click({ timeout: 15_000 });
      await wait(25_000);
      writeFileSync(join(outDir, `${prefix}-page.html`), await page.content());
      entry.steps.translated = await page.evaluate(snapshotList);
      await page.screenshot({ path: join(outDir, `${prefix}-2-translated.png`) });

      entry.expandSelector = await clickExpand(page);
      await wait(5000);
      entry.steps.expandedSoon = await page.evaluate(snapshotList);
      await wait(20_000);
      entry.steps.expanded = await page.evaluate(snapshotList);
      await page
        .locator('#chaptercontainer')
        .evaluate((el) => el.scrollIntoView({ block: 'end' }))
        .catch(() => {});
      await page.screenshot({ path: join(outDir, `${prefix}-3-expanded.png`) });
      if (n === 0 && mode.name === 'desktop') entry.scripts = await savePageScripts(page, prefix);
    } catch (e) {
      entry.error = String(e);
      await page.screenshot({ path: join(outDir, `${prefix}-error.png`) }).catch(() => {});
    }
    entry.console = consoleLines.slice(0, 80);
    results.push(entry);
    await page.close();
  }
  await context.close();
}
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const r of results) {
  console.log(r.mode, r.url, r.error ?? '');
  for (const [step, s] of Object.entries(r.steps))
    console.log(`  ${step}: rows ${s.rows}`, JSON.stringify(s.count), s.clip ? JSON.stringify(s.clip) : '');
}
