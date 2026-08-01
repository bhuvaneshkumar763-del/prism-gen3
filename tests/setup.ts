// Vitest setup — runs as a setupFile, guaranteed to execute before any
// test file's own static imports resolve. That ordering matters here:
// src/platform/configStore.ts calls browser.storage.onChanged.addListener
// at module-evaluation time (not lazily inside onReady()), so `browser`
// must already be a working global before configStore.ts is ever
// imported — a vi.stubGlobal() inside a test body runs too late for that.
// @webext-core/fake-browser/auto sets globalThis.browser/chrome to a real
// in-memory WebExtension API implementation.
import '@webext-core/fake-browser/auto';
// fake-indexeddb/auto polyfills indexedDB for the whole suite (Node has no
// native IndexedDB) — needed by src/platform/cache/translationCache.ts and
// anything that imports it transitively.
import 'fake-indexeddb/auto';
