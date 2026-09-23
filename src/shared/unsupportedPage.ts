/**
 * What the popup should say when the current tab has no Prism running in it.
 *
 * Found via a UI audit: on such a page the popup's Translate button used to
 * surface the browser's own raw error — "Could not establish connection.
 * Receiving end does not exist." — which tells a user nothing about what to
 * do. There are two genuinely different situations behind that one error,
 * and they need different advice:
 *
 * - The browser forbids extensions there (its own settings pages, other
 *   extensions' pages, the extension stores, local files). Nothing the user
 *   can do on that page will help.
 * - An ordinary web page simply has no content script yet — almost always a
 *   tab that was open before Prism was installed or updated. Reloading fixes
 *   it.
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
