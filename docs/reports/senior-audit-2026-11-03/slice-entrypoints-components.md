# Slice: entrypoints (background, content, popup, Settings) — Grade B−

## Top findings
- **Med NEW** options/App.tsx:349-358; content.ts:132-135, 261: Settings → General → "Source language" only feeds the selection popup; page translation never reads it. Setting Chinese after a mis-detection silently does nothing. (read-verified)
- **Med NEW** options/App.tsx:535-545: the "Translate each paragraph as a whole" label tells you to turn it off when words come out jumbled. Doing that disables beta.73's sangtacviet word-per-word fix. (read-verified)
- **Low-Med NEW** popup/App.tsx:232-247; background.ts:203-205, 311, 337: picking an unconfigured provider in the popup saves it before Settings opens. Close Settings without a key and every page fails with raw "[googleCloudTranslate] not configured or unavailable". Directly relevant to plan step 3. (read-verified)
- **Low-Med NEW** content.ts:166: the bubble's "Show original" restores only the top frame (the beta.48 sub-frame fix covers the message path only). An auto-translated same-origin iframe stays translated.
- **Low-Med KNOWN** content.ts:420-426: `pageTranslate` is top-frame only.
- **Low NEW** background.ts:443-465: any `ok` outcome is cached forever. An echo missed by the sanity check stays untranslated on every reload until "Clear translation cache". (reasoned)
- **Low NEW** Diagnostics shows the unused `scripting` permission as a red "no" (options/App.tsx:702-703).
- **Low NEW** each Settings deep-link opens a new tab (background.ts:519-520): tabs pile up on the iPhone.
- **Low NEW** the list hint says "one per line", but the inputs are single-line or dropdowns (options:488-490).
- KNOWN still present: popup "Restoring…" never shows; `frameLanguageDecisions` lives in memory only; unguarded sub-frame poll; API key saves on blur, so a test can use the old key; Firefox context menus only in `onInstalled`; global failure badge timers; dead `SKIP_UI_PROTOCOLS`; App.css imported twice; contradictory keepalive comments.
- **Fixed since beta.70:** Google key prefetch is gated; `alwaysLangOn` uses the base tag (the visibility check at :484 still uses `!==`); the never/always text matches the code; LLM items are gone.

## UI/UX
- The popup has about 16 controls, but you need about 3 (button, target language, bubble toggle).
- Language pills reorder under your finger; on an untranslated page a tap only saves; the main button doesn't name the target language.
- Paired controls don't match: "Always translate this site" is a checkbox but "Never" is a menu button; "More settings" and "More options…" sit side by side.
- Errors show internal text ("timed out after 5000ms", "[googleCloudTranslate] not configured…"); on unsupported pages the pill reads "Original · …" forever.
- iPhone fit: 11–12.5px text, about 30px rows, a 14px × glyph, about 2.6:1 contrast on empty and remove items.
- Source-language overrides are explained under "Selection & hover"; lists show raw codes ("zh-CN").
- Developer wording in user text: "i18n.detectLanguage available", "scripting API", raw bytes.
- Accessibility basics are right (labels, roles, ARIA tablist).

## Design
- **Praise:** best-effort cache (batched, non-blocking, incognito skipped); memoized provider so all tabs share one rate limiter; `withTimeout` on popup calls; optimistic save with rollback.
- About 43% of background.ts/content.ts is changelog comments, and several are wrong.
- `isTrustedSender` is pasted 13 times against a threat this path can't deliver (other extensions arrive on `onMessageExternal`). Wrap it once or drop it, and fix the comment.
- "Top frame vs every frame" is decided by hand in each handler, and the bubble bypasses messaging. That causes the frame bugs. One page controller that broadcasts to every frame would fix the whole class.
- options/App.tsx is one 720-line component; the popup hand-copies about 12 settings.
- No tests, and this folder is excluded from coverage. The cache merge (`translatePiecesWithCache`) should move to `src/platform` as a pure, testable function.

---

# Slice: components (bubble, hover tooltip, selection popup) — Grade B−

## Top findings
- **Med NEW** FloatingBubble.tsx:278-301, 330-332: a tap on the ball while the panel is pinned open toggles translation (back to original) and the panel stays open. Closing it needs a page tap, which on reader sites turns the page. (read-verified)
- **Med NEW** bubbleStyles.ts:157: the panel's `<select>` is 12.5px, so iOS zooms the page when it's focused, which then triggers the pinch-zoom bug. (reasoned)
- **Med KNOWN** FloatingBubble.tsx:71-79, 152-156: position uses visual-viewport size against the layout viewport, so pinch-zoom moves the ball off screen.
- **Med NEW** mountSelectionPopup.ts:240-256: a `translateOne` rejection (e.g. after an extension update) is uncaught, and "Translating…" spins forever. (read-verified)
- **Med KNOWN, raise from Low** mountSelectionPopup.ts:419-424: listens to `mouseup`/`keyup` only, so select-to-translate does nothing on iPhone. (reasoned)
- **Med KNOWN:** the selection trigger doesn't follow scroll; bubble keystrokes leak to the page (desktop).
- **Low NEW:** the 4px drag threshold is tight for a finger (bubblePosition.ts:18); the hover tooltip detects mobile by user-agent, so it sticks on iPad or desktop mode; a single hanzi can't be selected (selectionInfo.ts:64).
- **Low KNOWN:** busy blocks restore silently; `applyListPatch` lacks `.catch` (the Always chip shows saved when it wasn't); the tooltip isn't hidden or clamped; copy fallback side effects.
- **Fixed since beta.70:** long-press no longer toggles; right-click no longer toggles or drags; the panel no longer stays open after a touch tap (hover CSS behind `@media (hover: hover)`). All tested.

## UI/UX
- The 40px ball, 6px from the edge at 55% opacity, covers the last word of lines on a 375px screen. A peek dock or fading while scrolling would help.
- Tap targets under 44pt: ball 40px, selection trigger 30px, × about 23px, Copy about 24px.
- "Hide" is permanent for the site with no undo, and sits next to "Always".
- Tap-outside closes the panel but passes the tap to the page.
- White on #16a34a is 3.3:1.
- The tooltip and selection trigger sit below and cover the next line.
- No feedback when a tap lands while busy.
- No `-webkit-touch-callout:none` / `user-select:none` on the ball.

## Design
- **Praise:** render once, then update through stores (consistent across all three); trusted-event checks everywhere; optimistic update with rollback (except the Always chip).
- About 15 add/remove listener pairs are kept by hand; one `AbortController` per mount would replace them and the uncleared timers.
- A 200-line `onMount` mixes drag, keyboard, viewport, fullscreen and config sync. Extract `createBallGesture`.
- Duplicated viewport helpers and two different hover checks.
- About 40% of lines are history comments.

## Tests (120 pass)
- No real shadow root in tests; no full pointer down→move→up path.
- Geometry tested well as pure functions; regression tests named after real bugs; `isTrusted` tests.
- Missing: pinned-tap, selection-translator rejection, scroll, touch selection, Always save failure.

## Verdict
Careful, defensive, better than most hobby extensions. It was designed mouse-first with touch bolted on, and on the owner's actual device the rough edges are all touch ones. The pinned-tap and select-zoom issues are about an hour's work and worth confirming on the phone.
