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

/** The page's own script lines that mention its chapter list or the Expand toggle. */
async function pageScriptsAbout(page) {
  return page.evaluate(async () => {
    const keys = /chaptercontainer|max-height|maxHeight|Expand|Collapse|Mở rộng|Thu gọn|chapterfetcher|loadchapter/i;
    const found = [];
    const take = (source, text) => {
      const lines = text.split(/[\n;]/);
      lines.forEach((line, i) => {
        if (keys.test(line))
          found.push(
            `${source}: ${lines
              .slice(Math.max(0, i - 1), i + 2)
              .join(' ; ')
              .slice(0, 400)}`,
          );
      });
    };
    for (const s of Array.from(document.scripts)) {
      if (!s.src) take('inline', s.textContent ?? '');
    }
    for (const s of Array.from(document.scripts)) {
      if (!s.src || new URL(s.src).origin !== location.origin) continue;
      try {
        take(s.src, await (await fetch(s.src)).text());
      } catch {}
    }
    return found.slice(0, 120);
  });
}

async function clickExpand(page) {
  const candidates = [
    'text=/^\\s*(Expand|Mở rộng|Xem thêm|展开)/i',
    '#chaptercontainer + *',
    '.blk-body >> text=/Expand|Mở rộng/i',
  ];
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

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'probe-')), {
  headless: false,
  executablePath,
  viewport: { width: 390, height: 844 },
  args: [
    '--headless=new',
    '--no-sandbox',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
if (context.serviceWorkers().length === 0) await context.waitForEvent('serviceworker', { timeout: 15_000 });

const results = [];
for (const [n, url] of urls.entries()) {
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (msg) => {
    if (/prism|google/i.test(msg.text())) consoleLines.push(`${msg.type()}: ${msg.text().slice(0, 300)}`);
  });
  const entry = { url, steps: {} };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // PROBE_EARLY=1 translates before the list arrives, as auto-translate on load does.
    if (!process.env.PROBE_EARLY) {
      await page
        .waitForSelector('#chaptercontainerinner a, #chaptercontainerinner div', { timeout: 30_000 })
        .catch(() => {});
    }
    await wait(3000);
    writeFileSync(join(outDir, `${n}-page.html`), await page.content());
    entry.steps.loaded = await page.evaluate(snapshotList);
    await page.screenshot({ path: join(outDir, `${n}-1-loaded.png`) });

    await page.locator('#prism-bubble-host .ball').click({ timeout: 10_000 });
    await wait(20_000);
    entry.steps.translated = await page.evaluate(snapshotList);
    await page.screenshot({ path: join(outDir, `${n}-2-translated.png`) });

    entry.expandSelector = await clickExpand(page);
    await wait(5000);
    entry.steps.expandedSoon = await page.evaluate(snapshotList);
    await wait(20_000);
    entry.steps.expanded = await page.evaluate(snapshotList);
    await page
      .locator('#chaptercontainer')
      .evaluate((el) => el.scrollIntoView({ block: 'end' }))
      .catch(() => {});
    await page.screenshot({ path: join(outDir, `${n}-3-expanded.png`) });

    entry.pageScripts = await pageScriptsAbout(page);
  } catch (e) {
    entry.error = String(e);
    await page.screenshot({ path: join(outDir, `${n}-error.png`) }).catch(() => {});
  }
  entry.console = consoleLines.slice(0, 80);
  results.push(entry);
  await page.close();
}
await context.close();
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const r of results) {
  console.log(r.url, r.error ?? '');
  for (const [step, s] of Object.entries(r.steps))
    console.log(`  ${step}: rows ${s.rows}`, JSON.stringify(s.count), s.clip ? JSON.stringify(s.clip) : '');
}
