// Real-Chrome smoke test for the built extension (Gen 3 plan, Session 9).
//
// This is the first *committed* E2E harness in this repo — every prior
// session's real-browser verification was an ad hoc scratch script,
// written fresh each time and deleted after. That worked, but it means
// nothing catches a regression automatically; this harness is the
// permanent version, wired into CI below.
//
// Loads the real unpacked build from .output/chrome-mv3, opens each
// entrypoint HTML file as a tab, and asserts each renders without a page
// error. Also queries the live service worker directly for two positive
// facts a build could silently break: the manifest's alarms permission
// actually resulted in a registered keepalive alarm (Session 8), and the
// content script actually attached to a real page (proves injection
// works, not just that the build produced files).
//
// Requires `npm run build` to have been run first.
//
// Known limitation (same one the old repo's harness documents): opening
// an entrypoint HTML file as a plain tab, not as a real toolbar popup,
// means chrome.tabs.query({active:true}) resolves to that tab itself.
// Fine for structural checks; a true popup-driven round trip would need
// simulating the toolbar-icon click, which Playwright can't do headlessly
// (see CLAUDE.md's known-gaps history in the old repo for why).

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const extensionPath = join(repoRoot, '.output/chrome-mv3');

if (!existsSync(extensionPath)) {
  console.error(`No build found at ${extensionPath} — run "npm run build" first.`);
  process.exit(1);
}

const candidateEntrypoints = [
  {
    file: 'popup.html',
    async check(page) {
      const hasQuickField = (await page.locator('.quickField').count()) > 0;
      if (!hasQuickField) return "expected popup's .quickField language pickers to be present";
    },
  },
  {
    file: 'options.html',
    async check(page) {
      const hasDiagnostics = (await page.locator('button', { hasText: 'Run diagnostics' }).count()) > 0;
      if (!hasDiagnostics) return 'expected the "Run diagnostics" button to be present';
    },
  },
];

// A tiny local static page to prove the content script really injects
// into a real navigated page — not just that entrypoint HTML files load.
function startTestPageServer() {
  const html = '<!doctype html><html><head><title>E2E test page</title></head><body><p>Hello world</p></body></html>';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'prism-gen3-e2e-'));
let failures = 0;

try {
  // headless:true launches chrome-headless-shell, which has zero extension
  // support (--load-extension silently no-ops, no service worker ever
  // registers). The fix: headless:false + '--headless=new' gets the full
  // Chrome binary while Chrome itself still runs headless. This is a
  // documented old-repo gotcha (see CLAUDE.md's Session 8 writeup) —
  // the positive assertions below (service worker present, content script
  // attaches) are what would fail if this regressed back to headless:true.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--headless=new',
      '--no-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
  const extId = worker.url().split('/')[2];
  console.log(`Loaded extension ${extId} — service worker registered (proves full Chrome, not chrome-headless-shell)`);

  for (const { file: entry, check } of candidateEntrypoints) {
    if (!existsSync(join(extensionPath, entry))) {
      console.log(`skip ${entry} (not present in this build)`);
      continue;
    }
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // Expected noise, not a real failure: opening an entrypoint HTML file
      // as a plain tab (not a real toolbar popup) means any
      // chrome.tabs.query({active:true})-based message send in that page's
      // own onMount resolves to no real content script — see the "Known
      // limitation" note at the top of this file.
      if (/Could not establish connection|Receiving end does not exist/.test(msg.text())) return;
      pageErrors.push(msg.text());
    });

    try {
      await page.goto(`chrome-extension://${extId}/${entry}`, { waitUntil: 'load', timeout: 10_000 });
      await page.waitForTimeout(300);
      const bodyText = await page.locator('body').innerText();
      if (!bodyText.trim()) pageErrors.push('body rendered empty');
      if (check) {
        const checkError = await check(page);
        if (checkError) pageErrors.push(checkError);
      }
    } catch (err) {
      pageErrors.push(String(err));
    }

    if (pageErrors.length > 0) {
      console.error(`FAIL ${entry}:\n  ${pageErrors.join('\n  ')}`);
      failures++;
    } else {
      console.log(`pass ${entry}`);
    }
    await page.close();
  }

  // Session 8's keepalive alarm — confirm the manifest permission actually
  // resulted in a registered alarm, not just that the manifest key exists.
  const alarms = await worker.evaluate(() => chrome.alarms.getAll());
  const hasKeepalive = alarms.some((a) => a.name === 'prism-keepalive');
  if (!hasKeepalive) {
    console.error(`FAIL keepalive alarm: expected "prism-keepalive" registered, found ${JSON.stringify(alarms)}`);
    failures++;
  } else {
    console.log('pass keepalive alarm registered');
  }

  // Content-script injection: navigate a real page and confirm the
  // extension's content script actually attached — via a real
  // getPageState round trip through the typed messaging protocol, not a
  // synthetic test-only DOM marker. The wire format below
  // ({id, type, data, timestamp} in, {res} or {err} out) is
  // @webext-core/messaging's actual on-the-wire shape (read directly from
  // node_modules/@webext-core/messaging/dist/{index,generic-*}.mjs, not
  // guessed) — this is the same call src/platform/messaging/protocol.ts's
  // sendMessage() makes internally, just issued directly since a fresh
  // service-worker evaluate() context can't import that module's bundled
  // closure state.
  const server = await startTestPageServer();
  const { port } = server.address();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 10_000 });
    await page.bringToFront(); // see CLAUDE.md's "self-referential active tab" Playwright gotcha
    await page.waitForTimeout(300); // let the content script's main() finish running

    // No "tabs" permission and no host_permissions means chrome.tabs.query's
    // url filter can't see this tab's URL at all (silently no match) — use
    // {active:true} instead, which always resolves the tab id regardless of
    // that permission gap, same as the popup's own real getActiveTabId().
    const response = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) return { error: 'no active tab found via chrome.tabs.query' };
      const message = { id: 1, type: 'getPageState', data: undefined, timestamp: Date.now() };
      return await chrome.tabs.sendMessage(tab.id, message);
    });

    if (response?.res !== 'original') {
      console.error(
        `FAIL content-script injection: expected getPageState round trip to return {res:"original"}, got ${JSON.stringify(response)}`,
      );
      failures++;
    } else {
      console.log('pass content-script injection — real getPageState round trip on a navigated page');
    }
    await page.close();
  } finally {
    server.close();
  }

  await context.close();
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
