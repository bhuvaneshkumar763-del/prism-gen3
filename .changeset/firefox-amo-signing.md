---
"prism-gen3": patch
---

Fixed Firefox releases being uninstallable: every past release's Firefox zip triggered Firefox's confusing "this add-on appears to be corrupt" error on install, which is actually just how Firefox reports "unsigned extension" — it was never a real corruption, and no Firefox release build had ever been permanently installable. Releases are now signed through Mozilla's addons.mozilla.org "unlisted" self-distribution channel once repo maintainers configure signing credentials (`docs/decisions/0008-firefox-amo-signing.md` has the setup steps); until then, releases fall back to the previous unsigned zip, installable temporarily via Firefox's `about:debugging` → "Load Temporary Add-on".
