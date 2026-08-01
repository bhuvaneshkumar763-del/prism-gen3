import { defineConfig } from 'wxt';

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
  },
});
