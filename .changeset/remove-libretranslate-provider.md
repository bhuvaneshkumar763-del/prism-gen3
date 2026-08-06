---
"prism-gen3": patch
---

Removed the LibreTranslate translation provider entirely (per user request, right after removing the on-device Built-in AI provider). It had already been demoted from the default provider earlier due to the public libretranslate.com instance rate-limiting unauthenticated requests to the point of being unusable, and wasn't worth keeping as a selectable option. Anyone with it previously selected is migrated back to the default (Google) provider automatically.
