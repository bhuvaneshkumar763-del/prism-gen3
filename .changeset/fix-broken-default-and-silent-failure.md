---
"prism-gen3": patch
---

Fix two real bugs reported by a user testing the beta: translation never worked out of the box because the shipped default provider (libretranslate.com, unauthenticated) is rate-limited to the point of being unusable — the default is now 'google' (free, no signup, confirmed working live). Separately, a totally failing provider used to report a false "Translated" success with zero visible error in the popup/bubble; the page translator now tracks consecutive batch failures and surfaces a real "Translation failed" state in the floating bubble instead of silently retrying forever.
