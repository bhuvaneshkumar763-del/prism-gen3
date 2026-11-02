// Shared plumbing for the page-replay tests (fix plan, N-1).
//
// A replay case is a real page that once translated badly, saved so CI can
// translate it again with no network at all:
//
//   tests/replay/pages/<name>/
//     case.json     where it came from, the target language, optional checks
//     page.html     the page's DOM at save time (scripts and styles removed,
//                   open shadow roots kept as declarative shadow DOM)
//     google.json   Google's recorded answers, one list per piece sent
//     expected.txt  every text node after translation, one per line
//
// The page is served from 127.0.0.1 with every outside request blocked, and
// the extension's service-worker fetch is swapped for one that records
// (record.mjs) or answers from google.json (run.mjs). Answers are matched per
// piece, not per request, so a change to how pieces are batched into
// requests doesn't break a recording; a change to the pieces themselves does,
// and shows up as a miss.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const pagesDir = join(repoRoot, 'tests/replay/pages');
const extensionPath = join(repoRoot, '.output/chrome-mv3');

// 39 characters, the shape google.ts's auth scrape looks for.
const REPLAY_KEY = 'REPLAY-REPLAY-REPLAY-REPLAY-REPLAY-1234';

export function readCase(name) {
  const dir = join(pagesDir, name);
  const read = (file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : null);
  return {
    name,
    dir,
    meta: JSON.parse(read('case.json')),
    html: read('page.html'),
    google: JSON.parse(read('google.json') ?? '{}'),
    expected: read('expected.txt'),
  };
}

export async function launch({ withExtension = true } = {}) {
  if (withExtension && !existsSync(extensionPath)) {
    throw new Error(`No build found at ${extensionPath} — run "npm run build" first.`);
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'prism-replay-'));
  // Full Chrome with --headless=new, not chrome-headless-shell, which can't
  // load extensions (see tests/e2e/run.mjs).
  const args = ['--headless=new', '--no-sandbox'];
  if (withExtension) args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  const context = await chromium.launchPersistentContext(userDataDir, { headless: false, locale: 'en-US', args });
  const worker = withExtension
    ? (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 })))
    : null;
  return {
    context,
    worker,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Replaces the worker's fetch. In record mode Google is called for real and
 * every piece's answer is kept; in replay mode nothing leaves the worker.
 */
export async function hookGoogle(worker, mode, recording = {}) {
  await worker.evaluate(
    ({ mode, recording, key }) => {
      const realFetch = globalThis.fetch;
      const state = { recording, served: {}, misses: [] };
      globalThis.__prismReplay = state;
      const pieceKey = (src, tgt, text) => JSON.stringify([src, tgt, text]);
      globalThis.fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('translate.googleapis.com/_/translate_http/')) {
          if (mode === 'record') return realFetch(input, init);
          return new Response(`{"X-goog-api-key":"${key}"}`, { status: 200 });
        }
        if (!url.includes('translate-pa.googleapis.com/v1/translateHtml')) {
          if (mode === 'record') return realFetch(input, init);
          throw new TypeError(`replay: unexpected fetch to ${url}`);
        }
        const [[texts, src, tgt]] = JSON.parse(init.body);
        if (mode === 'record') {
          const response = await realFetch(input, init);
          if (!response.ok) return response;
          const body = await response.clone().json();
          texts.forEach((text, i) => {
            const k = pieceKey(src, tgt, text);
            if (!state.recording[k]) state.recording[k] = [];
            state.recording[k].push([body[0][i], body[1]?.[i] ?? null]);
          });
          return response;
        }
        const out = [[], []];
        for (const text of texts) {
          const k = pieceKey(src, tgt, text);
          const answers = state.recording[k];
          if (!answers) {
            state.misses.push(k);
            out[0].push(text);
            out[1].push(null);
            continue;
          }
          // Repeats of a piece get Google's later answers in order, then the last one again.
          const n = state.served[k] ?? 0;
          state.served[k] = n + 1;
          const [translated, detected] = answers[Math.min(n, answers.length - 1)];
          out[0].push(translated);
          out[1].push(detected);
        }
        return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    { mode, recording, key: REPLAY_KEY },
  );
}

export async function readHook(worker) {
  return worker.evaluate(() => {
    const state = globalThis.__prismReplay;
    return state ? { recording: state.recording, misses: state.misses } : null;
  });
}

/** Serves one HTML string at http://127.0.0.1:<port>/ and blocks every other request the page makes. */
export async function servePage(context, html) {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Playwright routes the service worker's requests too; those are hookGoogle's business.
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();
    const allowed = request.serviceWorker() || !/^https?:/.test(url) || url.startsWith(origin);
    return allowed ? route.continue() : route.abort();
  });
  return { url: `${origin}/`, close: () => server.close() };
}

function sendToActiveTab(worker, type, data) {
  return worker.evaluate(
    async ({ type, data }) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.tabs.sendMessage(tab.id, { id: Date.now(), type, data, timestamp: Date.now() });
    },
    { type, data },
  );
}

/** Translates the open page and waits until the extension has been idle for a while. */
export async function translateAndWait(page, worker, targetLanguage, { timeoutMs = 90_000 } = {}) {
  await page.bringToFront();
  await page.waitForTimeout(500); // let the content script finish starting
  await sendToActiveTab(worker, 'pageTranslate', { targetLanguage });
  const deadline = Date.now() + timeoutMs;
  let idleSince = null;
  while (Date.now() < deadline) {
    const working = (await sendToActiveTab(worker, 'getPageWorking'))?.res;
    if (working) idleSince = null;
    else idleSince ??= Date.now();
    if (idleSince && Date.now() - idleSince > 2_000) {
      const error = (await sendToActiveTab(worker, 'getPageError'))?.res;
      return { error: error?.message ?? null };
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`translation still working after ${timeoutMs / 1000}s`);
}

/**
 * Every visible text node on the page, open shadow roots included, one per
 * line. Line-per-node (not innerText) on purpose: Google moving words across
 * node boundaries is the bug class these tests exist for.
 */
export function readTextNodes(page) {
  return page.evaluate(() => {
    const lines = [];
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const walk = (root) => {
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.nodeValue.replace(/\s+/g, ' ').trim();
          if (text) lines.push(text);
        } else if (node.nodeType === Node.ELEMENT_NODE && !skip.has(node.tagName)) {
          if (node.getAttribute('id')?.startsWith('prism-')) continue; // not .id: a form's id can be an <input name="id">
          if (node.shadowRoot) walk(node.shadowRoot);
          walk(node);
        }
      }
    };
    walk(document.body);
    return `${lines.join('\n')}\n`;
  });
}
