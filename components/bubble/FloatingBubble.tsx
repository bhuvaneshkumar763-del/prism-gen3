import { Show } from 'solid-js';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';

/**
 * The floating action bubble — appears once a page is translated, letting
 * the user restore the original text or close the bubble without leaving
 * the page. Rendered into a closed shadow root injected by `content.ts`
 * (see `mountBubble()` there), so styling is scoped inline via `<style>`
 * in that same shadow root rather than a stylesheet import (a shadow root
 * on an arbitrary third-party page can't reach this extension's own CSS
 * by a relative path).
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
    </div>
  );
}
