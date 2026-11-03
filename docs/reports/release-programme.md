# Release programme: Releases 2–7

_Approved by the owner on 2026-11-03, from [senior-engineer-audit.md](senior-engineer-audit.md). Status lives in [fix-plan.md](fix-plan.md); this file holds the detail._


## Context
The outside senior-engineer audit (`docs/reports/senior-engineer-audit.md`) found four bugs on the owner's reading path and two release risks that can't be "hit" until they hurt. The owner can't find test cases themselves and said "just fix it if you feel it's right", so this batch fixes all of them in one release.

Scope rules: no refactors, no comment clean-up, no new features, nothing else from the audit lists. Every fix ships with a test that fails before it.

## Changes

### Reading-path bugs
1. **Doubled brackets** (`src/engine/pageTranslator/boundaryText.ts:6`). Add opening brackets to `NOT_CARRIED`: `（ 【 ( [ { 〔 〖 ［ ｛`. Then `（本章完）` + `(End of this chapter)` gives `(End of this chapter)`.
   - Tests in `boundaryText.test.ts`: the `（`, `【`, `(` and `[` cases, plus the existing `¿` / `. ` cases unchanged.
2. **Short Vietnamese echoes pass as translated** (`src/engine/providers/outputSanityCheck.ts`, before the `MIN_SUSPICIOUS_IDENTICAL_LENGTH` gate). When a short identical result has a `detectedLanguage` whose base tag differs from the target, flag it only if it has **4 or more words**. Names like "Đường Sanh" or "Nguyễn Văn An" (1–3 words) still pass; dialogue lines like "Ngươi muốn chết sao?" get caught.
   - Tests in `outputSanityCheck.test.ts`: a 4-word line flagged; a 2-word name not flagged; `detectedLanguage` equal to the target not flagged; `detectedLanguage: null` unchanged (keeps the test at :74 valid).
3. **sangtacviet chapters cut every 300 word nodes** (`translateLoop.ts`, tick selection around :701–733). In the starvation-guard case, where the whole batch is one block bigger than `MAX_PIECES_PER_TICK`, take the rest of that block's queue nodes too (the leading run that shares the same `nearestBlockAncestor`), up to a hard cap of 5,000 nodes. That way the block reaches `groupNodesForBatching` whole, and grouping (with its sentence-aware cutting) decides where to split, not an arbitrary node count.
   - Test in `translateLoop.test.ts`, extending the word-per-element test at :48: a 1,500-word paragraph is sent in one tick and fully translated, with no slot split mid-run.
4. **False "N% came back untranslated" on sangtacviet** (`translateLoop.ts` `writeSlot`, around :865–890). Add each tail word's own text length to `translatedChars` before the tail is emptied, skipping nodes already counted (`completedNodes`).
   - Test: a fully translated word-run paragraph plus about 220 characters the fake translator echoes back shows no warning. Before the fix it shows the warning.
5. **Bubble tap flips the page while its panel is pinned open** (`components/bubble/FloatingBubble.tsx:298`). In `onPointerUp`: when `pinned()`, close the panel instead of calling `toggleTranslate()`.
   - Test in `FloatingBubble.test.tsx`: long-press opens the panel, the next tap closes it, and `onTranslate` is not called.

### iPhone and misleading UI (small)
6. **iOS zooms on the bubble's pickers** (`components/bubble/bubbleStyles.ts:157`). Add `@media (hover: none) { .sel { font-size: 16px; } }`; desktop is unchanged.
   - Test: a CSS regex assertion, the same style as `FloatingBubble.test.tsx:550`.
7. **Picking an unconfigured provider breaks every page.** In the bubble (`FloatingBubble.tsx:520–537`) and the popup (`entrypoints/popup/App.tsx:232–247`): when `providerGaps(id)`, don't save and don't change the selection. Just open Settings at the Translation service section, where the provider and its key are set together.
   - Bubble test: choosing Google Cloud with no key leaves `pageTranslatorProvider` unchanged and calls `openSettings`.
   - The popup has no test setup (`entrypoints/` is excluded). It mirrors the bubble's logic and gets checked by hand in the built extension.
8. **Two Settings labels** (`entrypoints/options/App.tsx`):
   - Rename "Source language" to "Source language for selected text", with a hint: page translation detects the language itself, and the bubble's From picker fixes it for a site.
   - Reword the paragraph-switch label so it says turning it off also turns off the word-by-word joining that sangtacviet chapters rely on.

### Release safety
9. **Version scheme** (one shared rule instead of two copies). New pure module `src/shared/manifestVersion.ts` with `manifestVersionFor(pkgVersion)`:
   - `X.Y.Z-<tag>.N` (beta, rc, …) becomes `X.Y.Z.N`, with N below 9999.
   - Stable `X.Y.Z` after 0.3.1 becomes `X.Y.Z.9999`, so it always sorts above its own betas.
   - `0.3.1` and earlier stay as they are, since AMO already holds them and fetch-signed-xpi must still find them.
   - Anything else throws at build time.

   Wiring: `wxt.config.ts:15–16` and `scripts/fetch-signed-xpi.mjs:29–31` (`amoVersionFor`) both import it. Node 22.18+ strips TypeScript types natively; CI uses Node 22, and local Node is 22.23.
   - Tests in `src/shared/manifestVersion.test.ts`: the mappings, plus ordering (0.3.1 < 0.3.2.0 < 0.3.2.5 < 0.3.2.9999 < 0.3.3.0).
10. **Early warning when free Google breaks.**
    - New `tests/live/google.live.test.ts`: the real `createGoogleProvider()` translates one Vietnamese sentence to English, and the test asserts an `ok` outcome, text that differs from the input, and Latin output.
    - New `vitest.live.config.ts` and `npm run test:live`, kept out of the normal `npm test`.
    - New `.github/workflows/google-canary.yml`: daily schedule plus manual run, Node 22, `npm ci`, `npm run test:live`. A failure shows up as a red run, and GitHub emails you about failed scheduled runs.
11. **Session guardrails in `CLAUDE.md`.** A short "Rules for every session" section near the top:
    - No history or incident comments (history goes in the changeset).
    - A failing test before every fix, as a replay case when it's page-specific.
    - Work through a PR, never straight to `main`.
    - One release per batch.
    - Don't reopen the audit lists unless the owner reports a bug.

### Release
- A changeset (patch) describing the batch in plain words.
- Release as **0.3.2-beta.0** first, then stable **0.3.2** after your iPhone check. This exercises the new version scheme in exactly the case that broke 0.3.0.
  - The beta gets `Checked on:` from my desktop Chromium run of the built extension (e2e + replay).
  - Stable gets your iPhone line.
- `fix-plan.md`: add a short "Release 2" section listing these items.

## Order of the whole programme
Every audit item is now in a release, from safest to riskiest. Each release is its own PR, has its own beta, gets your iPhone check, and only then goes stable. The next release doesn't start before that.

**Stop rule:** if a release breaks reading, revert it to the last good release (GitHub Releases) and fix that before anything else.

| Release | Content | Risk |
|---|---|---|
| 2 (0.3.2) | Reading bugs and release safety | Small |
| 3 (0.3.3) | Diary comments cut (proven identical build); copied rules made into shared helpers | None / small |
| 4 (0.3.4) | Release, CI and tooling hardening | None for reading |
| 5 (0.3.5) | Structural refactors, behind locked-down tests | Medium |
| 6 (0.3.6) | UI and iPhone redesign | Medium (visible) |
| 7 (0.3.7) | The remaining audit findings | Small each |

---

# Release 3 (0.3.3): fix the causes of the B−

Only after 0.3.2 has been checked on your iPhone. A separate PR and release, so if something breaks you know which batch did it.

## A. Cut the diary comments (no change in behaviour, proven)
- **What:** every non-test source file in `src/`, `entrypoints/` and `components/` (about 5,300 comment lines).
  - Remove incident and history narration ("Real bug, found via round-6 audit…", beta numbers, "previously this…").
  - Keep each invariant or non-obvious "why" as 1–3 lines.
  - Fix or delete comments the audit found stale. Examples: `runWithConcurrencyLimit`, the Yandex/LLM mentions, the "line ~464 below" references, `tagText.ts:65` → CLAUDE.md, the contradictory keepalive notes in `background.ts`.
  - History already lives in git and `CHANGELOG.md`.
- **How:** one slice at a time (the same five slices as the audit), each its own commit.
- **Proof that nothing changed, both required for every commit:**
  1. `tsc --removeComments` output for the whole tree is identical before and after (diff of two emit folders).
  2. The Chrome and Firefox builds in `.output/` are byte-for-byte identical before and after. First check that two builds of unchanged code are themselves identical; if they aren't, rely on proof 1 alone.
- **Test files are left alone.** Their long names document the regressions they guard.

## B. Turn the copied rules into shared helpers (behaviour changes, test first)
Each item: write the failing test, add or reuse the one shared helper, and move every copy onto it.
1. **Staleness check** (`sentText`): `attributeTranslator.ts` uses the same "don't write over text the page changed while it was in flight" check as `translateLoop.ts`. Also fix the other three known attribute bugs while in there: first-wins restore, the unhandled rejection that stops its observer, and the wrong textarea skip.
2. **Generation guard:** `titleTranslator.ts` uses the generation pattern already in `attributeTranslator.ts`, so a late Chapter 1 title can't overwrite Chapter 2's.
3. **Reopen after failure:** `translationCache.ts` `getDb()` clears a rejected open promise, like `configStore.onReady` (`configStore.ts:144–153`), so one WebKit hiccup doesn't turn the cache off until restart.
4. **Backup migration:** `backup.ts` `parseBackup` runs `applyConfigMigrations` instead of its own copy of the provider-removal remap (`migrations.ts:262–291` vs `backup.ts:51–64`).
5. **`.catch` on fire-and-forget saves:** `applyListPatch` callers in `FloatingBubble.tsx:437–442` and the popup roll back the chip on failure, using the existing `openSettings` pattern.
6. **Hover detection:** the hover tooltip uses the bubble's `canHover()` (`(hover: hover)`) instead of its user-agent regex (`mountHoverTooltip.ts:9`), so it stops sticking on iPad and desktop-mode iPhone.
7. **Trusted-sender check:** the 13 hand-pasted `isTrustedSender` checks become one `onTrustedMessage` wrapper in `src/platform/messaging/`, with no change in behaviour, and the comment's overstated threat is corrected.
8. **Small duplicates:** `HAS_LETTER` (defined 3×) and the viewport helpers (`FloatingBubble.tsx:71–79` vs `mountSelectionPopup.ts:207–212`) each get one definition.

Update the "Copied rules" table in `fix-plan.md` as items close.

(Releases 4–7 follow after Release 3's verification section below.)

## Verification (Release 3)
- **Part A:** both proofs above, per commit, plus the full test suite.
- **Part B:** each new test fails before and passes after; the full suite, builds, e2e and replay all pass; `npm run test:live` passes.
- **Ask a fresh senior-engineer reviewer to re-grade** only the files touched, against the original slice notes. The goal is a written before/after grade, not a new findings list.
- **Release:** 0.3.3-beta.0, then your iPhone check, then 0.3.3.

---

# Release 4 (0.3.4): release, CI and tooling hardening
Nothing here touches the extension's own code, so reading can't break.
1. **Release logic becomes a tested script.** Move the inline YAML bash (changelog extract, `Checked on` gate, notes trim, asset choice) into `scripts/release-notes.mjs`, with unit tests.
2. **AMO "already exists" no longer falls back to the unsigned zip.** When signing reports a duplicate version, the release step runs the fetch-signed-xpi path itself.
3. **Fix both guard scripts.** `check-engine-purity.mjs` must reject `#imports`, `@webext-core/messaging`, `../platform/*` and WXT `storage`. `check-solid-reactivity.mjs` must catch `const x = () => configStore.get(...)` and reads inside `createMemo`. Add a `scripts/fixtures/bad/` folder that CI expects both guards to fail on.
4. **CI hygiene.**
   - Pin actions to commit SHAs.
   - Add `permissions:` blocks.
   - Run `web-ext` from the lockfile instead of `npx`.
   - Add Dependabot for npm and actions.
   - Run `fetch-signed-xpi` with `persist-credentials: false`, and show "not approved yet" as a neutral result rather than a failure.
5. **Safari/Xcode.** Run `safari:sync` during release, bump `MARKETING_VERSION` with the package version, and add a `macos-latest` CI job that builds the Xcode project. If it can't build there without your Apple account, delete the stale bundle and document `npm run safari:sync` as the way to rebuild.
6. **Coverage scope.**
   - Per-folder thresholds.
   - New files can't land at 0%.
   - `entrypoints/` comes into coverage once Release 5 makes it testable.

# Release 5 (0.3.5): structural refactors, behind locked-down tests
**Safety first, before any refactor:**
- **Realistic Google fake.** Replace the uppercase fake translator in the engine tests with one built from recorded Google responses (the replay recordings), including its known quirks (`（`→`(`, dropped leading `. `, reflow across markers).
- **More replay cases.** Add your sites: Wikipedia already exists. **sangtacviet chapter and novel543 need one page each that you save from your browser** (`npm run replay:record -- <name> --html <file>`); I'll give exact steps.
- **No edits to existing tests.** During the refactor, existing tests may change only their imports. If a test has to change, the refactor changed behaviour and stops there.

**Refactors:**
1. **Split `createPageTranslator`** (`translateLoop.ts`) into:
   - a scheduler that owns every timer, with one `schedule(delay)` that always clears and backoff as a floor (also fixes the backoff-cancel bug);
   - write-back (`writeSlot`/`writeTranslatedNode`);
   - a pure error-state machine replacing the six error variables;
   - progress tracking (also fixes `totalPieces` overshoot).
1a. **Short echoed lines (moved from Release 2).** A short sentence Google sends back unchanged should count as untranslated. The Release 2 attempt (flag when four or more words and the detected language isn't the target) failed on saved real pages: sangtacviet's four-word genre label "Kỳ Môn Bí Thuật" is legitimately unchanged, and Google detected pixiv's English "iPad drawing app Pastela" as Tagalog. Design it against the realistic Google fake and a saved sangtacviet chapter, not word counts.
2. **Structured errors.** `{ kind, status, reason, cause }` from provider to bubble, replacing string re-parsing in `google.ts:118`, `translateLoop.ts:1175–1185` and the `failureMessages` WeakMap. This fixes the wrong "Couldn't reach the translation service" messages, and stops JSON-parse errors being retried as if the network failed.
3. **One frame model.** A single page controller in `content.ts` that every control (bubble, popup, menu, shortcut) calls, and that broadcasts to all same-origin frames. Fixes the bubble restore and the manual translate missing iframes (`content.ts:166, 420–426`).
4. **Testable background.** Move `translatePiecesWithCache` and the provider/cache wiring out of `background.ts` into `src/platform/` as pure functions with tests.
5. **Cache size accounting.**
   - Recompute the total inside the eviction transaction instead of the per-instance counter. This fixes Clear cache across contexts, lost updates and double eviction.
   - Add `onabort`, `onversionchange` and `onblocked`.
   - Add a 30-day maximum entry age.
6. **Settings and popup structure.** `options/App.tsx` becomes one component per tab. The popup uses a shared config-signal helper instead of hand-copying about 12 settings.
7. **Delete dead code.**
   - providers: `dontSortResults`, `getQueryString` and the GET branch, `ProviderDescriptor.isAvailable`, the `'http'` kind, `ProviderConfig.google`
   - platform: `unwrapOr`, `configStore.isReady`/`export`
   - `content.ts`: `SKIP_UI_PROTOCOLS`
   - `translateLoop.ts`: `getTranslatedNodes`, `suppressNextObserverTick`

# Release 6 (0.3.6): UI and iPhone redesign
1. **Popup.**
   - The main button names the target language ("Translate to English").
   - About 3 primary controls (button, target language, bubble on/off); everything else under "More".
   - Language pills don't reorder while you tap.
   - "Always" and "Never" translate this site become matching controls.
   - One "Settings" entry.
   - Plain-language errors instead of internal text.
   - 44pt touch targets and ≥14px text.
2. **Bubble.**
   - A tap outside closes the panel without passing the tap to the page.
   - "Hide" gets an undo toast.
   - 44pt ball; a "peek" dock or fade while scrolling so it doesn't cover text.
   - Drag threshold 10px.
   - `-webkit-touch-callout:none` / `user-select:none`.
   - Visible feedback when tapped while busy.
   - Pinch-zoom positioning uses `visualViewport` offsets.
   - Accessible-contrast green (≥4.5:1).
3. **Selection popup.**
   - Works on iPhone (trigger on `selectionchange` after the selection settles).
   - Single hanzi allowed.
   - Follows scroll.
   - Stops its keystrokes reaching the page.
   - A translator rejection clears the spinner with a message.
   - Trigger and tooltip placed above the line, not over the next one.
4. **Settings.**
   - Language names instead of codes.
   - Plain diagnostics wording; the unused `scripting` check removed.
   - Deep links reuse an open Settings tab.
   - "Reset position" confirms.
   - List hints match the inputs.
   - Larger × buttons and readable contrast.

# Release 7 (0.3.7): every remaining audit finding
Go through every row in the four `docs/reports/senior-audit-2026-11-03/` files and the beta.70 slice files that isn't closed by Releases 2–6. Each row is either fixed with a failing test first, or marked "not a bug" or "won't fix", with the reason in a tracking table in `fix-plan.md`. Rows are batched by file so each file is touched once.

At the end of Release 7, a fresh senior-engineer review re-grades the whole codebase against the original B−, as a written before/after comparison.

## CLAUDE.md wording, adjusted
The Release 2 guardrail "don't reopen the audit lists" becomes "work only from the current release in fix-plan.md; nothing outside it unless the owner reports a bug".

## Verification
1. `npx tsc --noEmit`, `npx biome check .`, both guards, and `npm test` with coverage: all pass, with each new test shown failing before its fix (run the test, then the fix).
2. `npx wxt build` and `npx wxt build -b firefox`; check the manifest versions:
   - with `0.3.2-beta.0`: `0.3.2.0`
   - with `0.3.2`: `0.3.2.9999`

   Also `node scripts/check-bundle-size.mjs`.
3. `node scripts/fetch-signed-xpi.mjs`-style check: `amoVersionFor('0.3.1') === '0.3.1'`, `amoVersionFor('0.3.2-beta.0') === '0.3.2.0'`.
4. E2E (9 checks) and replay (3 pages) against the preinstalled Chromium, via throwaway copies as before.
5. `npm run test:live` here: Google's key script and endpoint are reachable from this machine.
6. Release-gate steps run locally on the new changelog entry.
7. Open a PR, wait for green CI, and merge only when you say so. The beta release follows; then you check it on the iPhone (a chapter ending in `（…）`, a long Vietnamese-mode chapter, a tap on the pinned bubble), and then stable 0.3.2.
