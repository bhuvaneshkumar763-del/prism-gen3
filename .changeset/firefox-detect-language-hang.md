---
"prism-gen3": patch
---

Fixed translation not working at all in Firefox — auto/"always" translate, manual translate, and a manually-pinned site language were all affected. Root cause: Firefox's `i18n.detectLanguage` has a long-standing upstream reliability bug (Mozilla bug 1712214) where it can simply never resolve or reject, rather than failing cleanly. Two places in this codebase awaited it with no timeout — the page-load language detector (breaking auto/always-translate) and the new "is this already in the target language?" check added for the source-language-override fix (breaking every translate path, since it runs before every translate). Both now give up after 3 seconds and fall back to their existing safe defaults instead of hanging forever. Chrome was never affected — this is why it went unnoticed until Firefox releases became actually installable.
