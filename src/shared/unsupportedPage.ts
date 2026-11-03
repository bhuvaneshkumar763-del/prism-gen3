/**
 * What the popup should say when the current tab has no Prism running in it,
 * instead of the browser's raw "Receiving end does not exist". Two cases:
 * - The browser forbids extensions there (its own pages, other extensions,
 *   the stores, local files): nothing the user can do on that page helps.
 * - An ordinary web page has no content script yet (a tab open before Prism
 *   was installed or updated): reloading fixes it.
 */

export const CANT_TRANSLATE_MESSAGE = "Prism can't translate this page.";
export const RELOAD_MESSAGE = 'Reload this page to use Prism.';

/**
 * `file:` is included deliberately: extensions can't run on local files
 * unless the user has separately allowed file-URL access, and when they
 * haven't, a reload wouldn't change anything.
 */
const RESTRICTED_PROTOCOLS = new Set([
  'chrome:',
  'edge:',
  'about:',
  'chrome-extension:',
  'moz-extension:',
  'safari-web-extension:',
  'view-source:',
  'devtools:',
  'file:',
]);

/** Browsers refuse to run extensions on their own stores, even over https. */
const STORE_PAGES: ReadonlyArray<{ host: string; pathPrefix: string }> = [
  { host: 'chromewebstore.google.com', pathPrefix: '/' },
  { host: 'chrome.google.com', pathPrefix: '/webstore' },
  { host: 'microsoftedge.microsoft.com', pathPrefix: '/addons' },
  { host: 'addons.mozilla.org', pathPrefix: '/' },
];

/** `null` when the page answered — Prism is running there and nothing needs saying. */
export function describeUnsupportedPage(url: string, reachable: boolean): string | null {
  if (reachable) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return CANT_TRANSLATE_MESSAGE;
  }

  if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return CANT_TRANSLATE_MESSAGE;
  if (STORE_PAGES.some((store) => parsed.hostname === store.host && parsed.pathname.startsWith(store.pathPrefix))) {
    return CANT_TRANSLATE_MESSAGE;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return RELOAD_MESSAGE;
  return CANT_TRANSLATE_MESSAGE;
}
