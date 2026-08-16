import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// Real bug (0.3.0-beta.20 -> beta.21): WXT derives the manifest's `version`
// from package.json but strips prerelease suffixes ("0.3.0-beta.20" ->
// "0.3.0") — every beta build produces the exact same manifest version.
// Harmless for the Chrome zip (nothing checks it), but AMO signing keys off
// this field to tell releases apart: the very first beta signed fine, and
// every beta after it hit "Version 0.3.0 already exists" and failed. Fixed
// by overriding `manifest.version` below to a 4-segment numeric version
// (both Chrome's and Firefox's manifest schemas support up to 4 dot-
// separated integers, no letters/hyphens needed) that actually changes
// every beta — "0.3.0-beta.20" -> "0.3.0.20".
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const betaMatch = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(pkg.version);
const manifestVersion = betaMatch ? `${betaMatch[1]}.${betaMatch[2]}` : pkg.version;

// See https://wxt.dev/api/config.html
//
// Chrome-only at launch (see the Gen 3 plan, Session 1) — but browser
// target is kept as a build-time parameter (`wxt build -b firefox` already
// works via the build:firefox/zip:firefox npm scripts) rather than
// hardcoded, so re-adding Firefox later is a config change, not a second
// migration. See docs/decisions/0001-framework.md for why WXT itself was
// chosen (partly for this dual-target story).
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Prism',
    description: 'Prism — AI Page Translator (Gen 3)',
    version: manifestVersion,
    // The full original version string (with the beta tag WXT would
    // otherwise silently drop) — shown to users in about:addons/
    // chrome://extensions instead of the bare numeric `version` above.
    version_name: pkg.version,
    // "storage" for provider/settings config. "contextMenus" and
    // "activeTab" back Session 6's right-click translate/restore menu
    // items and getActiveTabId()-based tab targeting — activeTab grants
    // this without needing a broad host permission. Full <all_urls>-style
    // access (for automatic/always-translate to work without a user
    // gesture first) is still a deliberate later-session decision — see
    // the Gen 3 plan and CLAUDE.md's note on the old repo's
    // storage.sync/permission-model incident history.
    // "alarms" (Session 8 hardening pass): the MV3 service worker this
    // background entrypoint runs in is aggressively suspended by Chrome
    // after ~30s of inactivity — a recurring chrome.alarms alarm is the
    // documented way to keep it from being torn down mid-batch during a
    // long page-translation run. See entrypoints/background.ts's keepalive
    // setup for the full rationale.
    permissions: ['storage', 'contextMenus', 'activeTab', 'alarms'],
    commands: {
      'toggle-translate-page': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Translate or restore the current page',
      },
    },
    // AMO (addons.mozilla.org) requires a stable extension id for signing —
    // without one, a new random id would get minted on every sign, and each
    // "version" would look like a brand-new, unrelated add-on to AMO/Firefox
    // instead of an update to the same one. Harmless on the Chrome build:
    // Chrome ignores browser_specific_settings entirely.
    browser_specific_settings: {
      gecko: { id: 'prism-gen3@bhuvaneshkumar763-del.github.io' },
    },
  },
});
