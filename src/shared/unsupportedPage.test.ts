import { describe, expect, it } from 'vitest';
import { CANT_TRANSLATE_MESSAGE, describeUnsupportedPage, RELOAD_MESSAGE } from './unsupportedPage';

describe('describeUnsupportedPage', () => {
  it('says nothing when the page answered — Prism is running there', () => {
    expect(describeUnsupportedPage('https://example.com/', true)).toBeNull();
  });

  it.each([
    'chrome://extensions/',
    'edge://settings/',
    'about:blank',
    'chrome-extension://abc/options.html',
    'moz-extension://abc/options.html',
    'safari-web-extension://abc/popup.html',
    'view-source:https://example.com/',
    'file:///Users/me/notes.html',
  ])('reports %s as a page Prism can never run on', (url) => {
    expect(describeUnsupportedPage(url, false)).toBe(CANT_TRANSLATE_MESSAGE);
  });

  it.each([
    'https://chromewebstore.google.com/detail/abc',
    'https://chrome.google.com/webstore/detail/abc',
    'https://microsoftedge.microsoft.com/addons/detail/abc',
    'https://addons.mozilla.org/en-US/firefox/addon/abc/',
  ])(
    'reports the extension store %s as unsupported — browsers block extensions there even though it is https',
    (url) => {
      expect(describeUnsupportedPage(url, false)).toBe(CANT_TRANSLATE_MESSAGE);
    },
  );

  it('asks for a reload on an ordinary web page that did not answer — the usual cause is a tab opened before Prism was installed or updated', () => {
    expect(describeUnsupportedPage('https://sangtacviet.vip/truyen/1/', false)).toBe(RELOAD_MESSAGE);
  });

  it('does not mistake a normal Google page for the extension store', () => {
    expect(describeUnsupportedPage('https://www.google.com/search?q=webstore', false)).toBe(RELOAD_MESSAGE);
  });

  it('treats a missing or unparseable URL as unsupported rather than promising a reload will help', () => {
    expect(describeUnsupportedPage('', false)).toBe(CANT_TRANSLATE_MESSAGE);
    expect(describeUnsupportedPage('not a url', false)).toBe(CANT_TRANSLATE_MESSAGE);
  });
});
