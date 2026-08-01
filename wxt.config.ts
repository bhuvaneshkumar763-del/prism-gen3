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
    // "storage" for provider config (src/platform/providerConfig.ts).
    // Host permissions/broad access is a deliberate later-session decision
    // (Session 7 — see the Gen 3 plan and CLAUDE.md's note on the old
    // repo's storage.sync/permission-model incident history) — not
    // decided yet, so nothing beyond "storage" is requested this session.
    permissions: ['storage'],
  },
});
