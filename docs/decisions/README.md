# Architecture decision records

Compiled Session 10, per the Gen 3 plan's design principle #5: every
"keep the old approach" or "diverge" call gets written down as a
one-paragraph ADR so the reasoning survives past the session that made it.
This index is the map; read the linked file for the full context/decision/
consequences of any one entry.

| # | Decision | Session | Status |
|---|---|---|---|
| [0001](0001-framework.md) | Framework choice: WXT | 1 | Accepted — re-evaluated against Plasmo/hand-rolled-Vite/CRXJS, not assumed from the old repo |
| [0002](0002-ui-library.md) | UI library choice: Solid | 1 | Accepted — re-evaluated against React/Vue/Svelte/vanilla |
| [0003](0003-settings-sync-deferred.md) | Settings sync: deferred, not rejected | 3 | Accepted — local-storage only at launch; a concrete cross-context consistency test gates ever reconsidering `chrome.storage.sync`, given the old repo's real WebKit split-brain incident |
| [0004](0004-provider-scope.md) | Provider scope for Session 4, and how Google's provider was built | 4 | Accepted — Google/Google Cloud Translate/LLM/Builtin ported; documents the real Chrome-native-translate-vs-Arc quality investigation that shaped the provider set |
| [0005](0005-deepl-live-tab-bridge.md) | DeepL: not ported this session | 4 | Accepted — deferred, not dropped; DeepL Free API is a plausible cheap follow-up, the live-tab-bridge variant needs its own dedicated session |
| [0006](0006-permission-model.md) | Permission model: broad access by default, confirmed working | 7 | Accepted — starts from the old repo's final, reverted-to unconditional-access state; explicitly not re-attempting the scoped-down activeTab+optional-grant experiment that broke on Orion/WebKit |
| [0007](0007-i18n-corpus-deferred.md) | i18n: no UI-string translation corpus yet, deliberately | 7 | Accepted — every surface is hardcoded English; the old repo's 43-locale translated *values* are a legitimate future bootstrap corpus, porting them is real scoped-out work |

## Not yet written as ADRs, but worth flagging if picked up later

- **Custom dictionary**: never started (see Session 6 in `CLAUDE.md`) —
  the old repo shipped a non-functional placeholder for this and the plan
  explicitly said not to repeat that; Gen 3 correctly has neither the UI
  nor the config for it. Worth an ADR only if/when actually built.
- **DeepL live-tab bridge** specifically (as opposed to the Free API) is
  covered by 0005 already, no separate record needed unless a session
  actually attempts it.
