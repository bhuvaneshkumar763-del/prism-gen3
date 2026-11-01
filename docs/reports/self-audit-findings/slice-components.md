# Slice: components/ (non-test)

Files read in full: bubble/FloatingBubble.tsx 722, bubble/bubbleStyles.ts 179, bubble/mountBubble.ts 83, bubble/bubbleState.ts 47, selection/mountSelectionPopup.ts 440, selection/selectionPopupStyles.ts 115, selection/SelectionPopup.tsx 100, selection/copyText.ts 36, hoverTooltip/mountHoverTooltip.ts 158, hoverTooltip/HoverTooltip.tsx 24, hoverTooltip/hoverTooltipStyles.ts 19, options/StringListEditor.tsx 102, options/TabSwitcher.tsx 59, options/TabPanel.tsx 21 (2105 total). I also checked src/shared/ui/shadowHost.ts, src/shared/bubble/bubblePosition.ts, src/engine/selection/selectionInfo.ts, src/platform/configMutations.ts, src/shared/ui/tabNavigation.ts, entrypoints/content.ts:140-185, and the matching tests.

## Real bugs

- [high][HIGH] components/bubble/FloatingBubble.tsx:254-257, 279-292: a long-press opens the panel and then also translates (or restores) the page when the finger lifts. Trigger: press and hold the ball for at least 450 ms without moving, then release. Outcome: the long-press timer sets `pinned`, but nothing records that it fired, so `onPointerUp` sees `moved === false` and calls `toggleTranslate()`. Touch users get their page translated or restored every time they open settings. No test covers long-press.
- [high][HIGH] components/selection/mountSelectionPopup.ts:351-362, 419-424: the selection trigger and result panel use `position: fixed`, with coordinates computed once from the selection rect, and nothing listens for scroll or resize. Trigger: select text, then scroll the page with the wheel or the keyboard. Outcome: the button or panel stays put in the viewport while the selected text scrolls away. It hangs over unrelated content until the next mouseup or keyup.
- [med][MED-HIGH] components/bubble/FloatingBubble.tsx:326-360 (and selection/SelectionPopup.tsx buttons): keyboard events inside the shadow root are never stopped, so they reach the host page retargeted to the host `<div>`. Trigger: with a bubble `<select>` focused on YouTube, Gmail or GitHub, type a letter to jump to a language, or press Space/Enter/Escape on the ball. Outcome: the page's single-key shortcuts fire (f = fullscreen, k = pause, j/k = navigate), and Escape also closes page modals. `preventDefault` does not stop page listeners. Fix: `stopPropagation` keydown/keyup/keypress at `.wrap`.
- [med][MED] components/selection/mountSelectionPopup.ts:415 — the Escape dismissal records `selectedText`. After a right-click translation, that holds the browser's `selectionText`, which lines 112-118 of the same file say can differ from `Selection.toString()` for the same selection. Trigger: select multi-line or oddly spaced text, use the right-click "Translate selection", then press Escape. Outcome: when Escape's keyup arrives, `dismissedText !== info.text`, the dismissal is cleared (line 332), and the trigger pops straight back. This is the same bug the `dismissedText` comment says was fixed. Use `shownForSelection ?? selectedText`.
- [med][MED-HIGH] components/bubble/FloatingBubble.tsx:434, 437, 439: `void applyListPatch(...)` has no `.catch`, and `setAlwaysOn` is updated optimistically with no rollback. Trigger: `setMany` rejects (service worker restarting, extension context invalidated). Outcome: an "Uncaught (in promise)" error appears in the host page's console, which is exactly the bug the file's own comment at 442-447 says CI caught for `openSettings`. The chip also stays showing "Always" although nothing was saved.
- [med][MED] components/bubble/FloatingBubble.tsx:241-259: there is no `e.button` check, so right-clicks and middle-clicks start a drag and a "tap". Trigger: right-click the ball (Windows/Linux Chrome fires pointerup before the context menu). Outcome: `toggleTranslate()` runs, so the page translates as the context menu opens.
- [med][MED] components/hoverTooltip/mountHoverTooltip.ts:110-117, 135-141: a visible tooltip is only hidden by a matching `mouseout`. Trigger: (a) the hovered element is removed or replaced by an SPA or infinite-scroll update, so no mouseout fires and the next mouseover hits a node with no original text, which returns early at :117 without calling `hide()`; or (b) the page is restored with a keyboard shortcut while the tooltip shows, after which `findOriginalTextForElement` returns null and :140 just skips the update. Outcome: the original-text tooltip stays stuck on screen. Call `hide()` when the new target has no original or the lookup returns null.
- [med][HIGH] components/hoverTooltip/mountHoverTooltip.ts:127, 140: the tooltip is placed at `clientX+8, clientY+16` with no viewport clamping (it is 320 px wide with no max-height). Trigger: hover translated text near the right or bottom edge. Outcome: the tooltip is clipped off screen.
- [med][MED] components/bubble/bubbleStyles.ts:58, 85 and FloatingBubble.tsx:147: the open-on-hover rules are not gated behind `@media (hover: hover)`. Trigger: tap the ball on a touch browser (mobile browsers apply a sticky `:hover` on tap). Outcome: the panel flashes or stays open on an ordinary tap-to-translate, and `isPanelOpen()` reports it open.
- [med][MED] components/bubble/FloatingBubble.tsx:71-79, 228-229 with bubblePosition.ts `resolveDockedPoint`: positions are computed from `visualViewport` width and height, ignore `offsetLeft`/`offsetTop`, and are applied to a `position: fixed` element (which is laid out against the layout viewport). Trigger: pinch-zoom on mobile. Outcome: a right-docked ball moves toward mid-page or off the visible area. The `visualViewport` scroll listener recomputes an identical point every frame, which is wasted work.
- [low][MED] components/selection/mountSelectionPopup.ts:421-422: only `mouseup` and `keyup` are watched. A touch selection made with mobile selection handles fires neither, so the trigger never appears on touch. Use `selectionchange`. I found no known-gap entry for this.
- [low][HIGH] components/selection/copyText.ts:21-35: the fallback `textarea.select()` replaces the page's own selection, which defeats the copy button's `preventDefault` intent noted at SelectionPopup.tsx:81, so the trigger is then hidden on the next key press. It also fires the page's `copy` listeners, which can rewrite the clipboard. `document.body.append` at :27 sits outside the try, so a null body rejects into `void handleCopy()` at mountSelectionPopup.ts:172 as an unhandled rejection.
- [low][MED] FloatingBubble.tsx:342-343: ArrowDown focuses the first match, which is the `.primary` button, and that button is `disabled` while busy or offline (:637). Outcome: `focus()` silently does nothing, so the panel is pinned but focus stays on the ball.
- [low][MED] FloatingBubble.tsx:214, 637: while `busy` is true on an already translated page (dynamic content translating), neither the ball nor the primary button can restore. On constantly mutating feeds this can block "Show original" for long stretches. Needs checking against translateLoop's `busy` semantics.
- [low][HIGH] FloatingBubble.tsx:230: the `orientationchange` `setTimeout` is not cleared in `onCleanup`, so it can schedule a rAF `applyState` after dispose. It writes to detached nodes and is harmless, but it is a leak-pattern inconsistency. The long-press timer (:254) and the `actionBusy` timer (:216) are not cleared either.

## Security / privacy

- No HTML injection: every page, translated and error string is rendered as a Solid text node (FloatingBubble:641, SelectionPopup:77/90, HoverTooltip:20). Verified.
- `isTrusted` checks guard every spend path: ball pointer and key handlers, every panel control, selection mouseup/keyup/translate. The hover tooltip has none, which is harmless because it only displays text.
- [low][MED] shadowHost.ts uses `mode: 'open'`, so a host page can read the selection-translation result and the chosen provider from `host.shadowRoot`. The rationale "nothing beyond what's visible" mostly holds, but the translated output is new data. This is acceptable, but should be noted.
- Clipboard: see copyText above, where page `copy` handlers can intercept the fallback.

## Accessibility

- [med][HIGH] bubbleStyles.ts:44, 97, 116, 136: white text on the green accent `#16a34a` is 3.30:1, and on indigo `#6366f1` it is 4.47:1. Both are below AA 4.5:1 for the 13.5–14 px bold `.htitle` and `.primary` text and the 11.5 px `.chip.on` text. `.hsub` at 0.85 opacity is worse. The darker gradient stop does not rescue the start of the gradient.
- [med][HIGH] StringListEditor.tsx:44-60, 67: the label is a bare `<span>`, so the `<input>` has no accessible name (placeholder only) and the `<select>` takes its name from the disabled option. Use `<label>` or `aria-labelledby`.
- [med][MED] SelectionPopup.tsx:41-52, 55-96: the trigger and panel are appended to the end of `<html>`, focus is never moved to them, and there is no shortcut. A keyboard user who selects with Shift+Arrows sees a trigger they can only reach by tabbing through the whole page.
- [low][MED] SelectionPopup.tsx:67-68, 89: `role="alert"` is nested inside a `role="status"` live region, so screen readers may announce it twice. The live region also wraps the buttons ("Copy", "×").
- [low][MED] FloatingBubble.tsx:593-594: `aria-haspopup="true"` means a menu, but the panel has no `role="menu"` or `dialog` and there is no `aria-controls`. Also, the static `title` at :595 says "Click to translate" even when a click restores the page, which contradicts `ballLabel()`.
- [low][MED] SelectionPopup and HoverTooltip have no `dir="auto"` and no `white-space: pre-wrap` (selectionPopupStyles.ts:36-49, hoverTooltipStyles.ts:5-18). RTL results render with an LTR base, and the line breaks of multi-paragraph translations collapse.

## Comment/code drift, dead code, complexity

- [low][HIGH] FloatingBubble.tsx:574: `translated() && busy` can never be true, because `translated()` already requires `!busy` (:542). The "Restoring…" label is dead code.
- [low][HIGH] SelectionPopup.tsx:13-14: the header says "no listen/copy actions", but a Copy action exists (:78-86, mountSelectionPopup.ts:194-205).
- [low][HIGH] bubbleStyles.ts:8: the comment says "red/amber error accent", but only red exists, and offline also turns red. The `offline` class (FloatingBubble.tsx:586) has no CSS rule, so it is dead.
- [low][MED] mountSelectionPopup.ts:72-73: the header says detection runs "on mouseup", but keyup is also wired (:383-405).
- [low] Duplication: the viewport helpers (FloatingBubble:71-79, mountSelectionPopup:207-212), the font stack (three style files), and the spinner CSS.
- [low] FloatingBubble.tsx is 722 lines, and its `onMount` block (:222-421) mixes drag, keyboard, fullscreen and config-sync. A `useBubbleDrag` and a `useConfigSignals` extraction would shrink it.

## Test gaps

- Long-press then release (the bug above), right-click on the ball, drag-then-cancel, an `applyListPatch` rejection in `onAlwaysClick`, `bubblePosition` onChanged sync.
- Selection: scroll after the trigger is shown, Escape after a right-click translate when `selectionText` differs from `toString()`, the copy fallback path.
- Hover tooltip: node removed while visible, restore while visible, edge clamping.
- No tests for TabSwitcher or TabPanel (the keyboard math is tested in tabNavigation).

## Strengths worth keeping

- Each surface renders once from a store or signal instead of dispose and re-render, with documented reasons.
- Bubble cleanup is thorough, and Hide now calls `dispose()` (mountBubble.ts:54-69).
- `pointercancel` recovery, rollback on failed `configStore.set` (target, source, service, position), and stale-result guards via `requestId` in the selection popup.
- The status live region sits outside the visibility-hidden panel, and the ball's accessible name changes with what a click will do.
- CSS rationale lives in comments the minifier strips, not inside the shipped strings.
- Shadow-root selection lookup through `composedPath()`, and hover-target resolution through `composedPath()[0]`.
