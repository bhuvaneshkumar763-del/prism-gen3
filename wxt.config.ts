import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';
import { manifestVersionFor } from './src/shared/manifestVersion';

// See manifestVersionFor: betas get a fourth number, and stable releases sort above them.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const manifestVersion = manifestVersionFor(pkg.version);

// Builds Chrome (MV3), Firefox (MV2, `-b firefox`) and Safari (`-b safari`).
// Safari can't load this manifest directly: it is wrapped in the Xcode
// project under safari/, refreshed by `npm run safari:sync`.
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Prism',
    description: 'Prism — AI Page Translator (Gen 3)',
    version: manifestVersion,
    // The full version, beta tag included, shown in about:addons and chrome://extensions.
    version_name: pkg.version,
    // storage: settings and cache. contextMenus: the right-click items.
    // activeTab: lets the menu and shortcut act on the clicked tab. alarms:
    // keeps the MV3 worker awake during a long page translation (background.ts).
    // Page access itself comes from the content script's `*://*/*` match.
    permissions: ['storage', 'contextMenus', 'activeTab', 'alarms'],
    commands: {
      'toggle-translate-page': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Translate or restore the current page',
      },
    },
    // AMO signs updates only under a stable id; Chrome ignores this key.
    browser_specific_settings: {
      gecko: { id: 'prism-gen3@bhuvaneshkumar763-del.github.io' },
    },
  },
});
