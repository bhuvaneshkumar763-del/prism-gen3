import { Show } from 'solid-js';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';

/**
 * The floating action bubble. Two roles, both real content-script UI
 * entry points, not just one:
 *
 * 1. **Post-translate control** — appears once a page is translated,
 *    letting the user restore the original text or close the bubble.
 * 2. **Mobile in-page trigger** (`showTranslatePrompt`) — on a narrow
 *    viewport, before translation, offers "Translate this page" directly
 *    on the page. Scope decision (Session 6): rather than port the old
 *    repo's separate ~326-line `MobilePopup.tsx` (a distinct menu with
 *    its own always/never-translate-from-language shortcuts), this folds
 *    "give mobile users an in-page way to start translating, since the
 *    toolbar icon may be hard to reach" into the bubble that already
 *    exists for the post-translate case — one component serving the need
 *    instead of two overlapping ones. `content.ts` decides `showTranslatePrompt`
 *    via a `matchMedia` narrow-viewport check; the always/never-translate
 *    shortcuts a full mobile popup would add are not built here.
 *
 * Rendered into a shadow root injected by `content.ts` (see
 * `mountBubble.ts`), so styling is scoped inline via `<style>` in that
 * same shadow root rather than a stylesheet import (a shadow root on an
 * arbitrary third-party page can't reach this extension's own CSS by a
 * relative path).
 *
 * Scope decision (Session 6): this is a fresh, deliberately simpler
 * design than the old repo's `FloatingBubble.tsx` — fixed bottom-right
 * position, no drag-to-reposition or edge-docking math, no per-host
 * remembered position. That old behavior was real, working, hard-won
 * engineering (documented at length in the old repo's history) — porting
 * it properly deserves its own focused pass, not a rushed tail-end
 * addition to a session already covering messaging + options + this
 * component. What's here is real and functional (not a placeholder): it
 * shows, it toggles translate/restore, it closes, and it's covered by
 * tests. Drag/positioning polish is a documented follow-up, not silently
 * dropped.
 */
export interface FloatingBubbleProps {
  pageState: PageLanguageState;
  busy: boolean;
  showTranslatePrompt: boolean;
  onTranslateClick: () => void;
  onRestoreClick: () => void;
  onClose: () => void;
}

export function FloatingBubble(props: FloatingBubbleProps) {
  return (
    <div class="bubble">
      <Show when={props.pageState === 'translated'}>
        <span class="label">Translated</span>
        <button type="button" class="action" disabled={props.busy} onClick={props.onRestoreClick}>
          {props.busy ? 'Restoring…' : 'Show original'}
        </button>
        <button type="button" class="close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </Show>
      <Show when={props.pageState === 'original' && props.showTranslatePrompt}>
        <button type="button" class="action" disabled={props.busy} onClick={props.onTranslateClick}>
          {props.busy ? 'Translating…' : 'Translate this page'}
        </button>
        <button type="button" class="close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </Show>
    </div>
  );
}
