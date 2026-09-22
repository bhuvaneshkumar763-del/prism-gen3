---
"prism-gen3": patch
---

**Stop forcing one guessed source language onto every piece of a mixed-language page.** Reported live on sangtacviet.vip: that site serves Vietnamese content under an already-English UI, and the English labels were being destroyed — `History` became `Association`, `Ongoing` became `On damage`, `Major Category` became `Major Directory`.

Root cause, confirmed by probing the endpoint directly rather than inferred. A page gets ONE detected source language, and every piece is sent with it. Here the page is Vietnamese, so the site's own English labels were sent as "translate this Vietnamese into English". Measured, `vi -> en`:

| sent as | `History` | `Ongoing` |
|---|---|---|
| forced `vi` | `Association` | `On damage` |
| `auto` | `History` | `Ongoing` |

No page-level guess can be right for a page that genuinely contains two languages. Google's endpoint is sent `auto` now, so it decides per piece, and the site's Vietnamese chips still translate exactly as before — verified side by side.

**Why this is safe, given beta.29 removed `auto` for silently echoing text back untranslated.** That change was correct at the time: "output identical to input" was unresolvable, because genuinely-already-in-the-target-language looks exactly like a failed echo. The endpoint resolves it — it returns a **per-piece detected language**, but only when the source is `auto`; with a forced source it returns no detection data at all. `outputSanityCheck.ts` was already written around precisely that signal and has been sitting inert for this provider ever since, so sending `auto` activates a safety net that already existed rather than removing one.

Three further guards, each checked rather than assumed:

- Its `hasScriptMismatch` check runs first and independently of the detector, which is the specific defence against beta.29's own failure shape (real CJK echoed back while detection claims English). Re-probed live on Chinese prose and on bare CJK characters: `auto` and an explicit `zh-CN` returned byte-identical output, with `auto` correctly reporting `zh-CN`.
- A piece the sanity check does flag now retries with the page's guessed language. Previously a flagged piece retried with `auto`; now that `auto` is what was sent first, retrying it again would reissue the identical request and get the identical echo.
- An **explicit** source picked in the bubble's From menu is still sent exactly as chosen. That control exists because the guess was wrong, so letting detection override it would break the only lever a user has on a misdetected page.
