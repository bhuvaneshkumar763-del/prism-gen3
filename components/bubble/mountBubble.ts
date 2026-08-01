import { render } from 'solid-js/web';
import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import { BUBBLE_STYLES } from './bubbleStyles';
import { FloatingBubble } from './FloatingBubble';

const HOST_ID = 'prism-bubble-host';

export interface BubbleController {
  update(pageState: PageLanguageState, busy: boolean): void;
  unmount(): void;
}

/**
 * Creates the shadow-DOM host and mounts `FloatingBubble` into it. One
 * controller instance per page load — `content.ts` calls `update()` on
 * every `pageTranslator` state change and `unmount()` on restore/close.
 *
 * Re-renders the whole (small, static) component tree on every `update()`
 * rather than wiring a Solid signal through this plain-TS file — this
 * controller is a thin imperative adapter over `content.ts`'s own state
 * (`pageTranslator.getState()`), not a Solid component itself, so a fresh
 * render per update is simpler than threading reactivity through a
 * non-JSX file for a two-field prop set.
 */
export function mountBubble(onRestoreClick: () => void, onClose: () => void): BubbleController {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 'open' (not 'closed'): unlike, say, the selection/hover surfaces this
  // project's history flags as more sensitive, the bubble only ever shows
  // a translate/restore toggle — no user data — so the isolation benefit
  // of a closed root is marginal here, and 'open' keeps this testable via
  // `host.shadowRoot` from outside (see mountBubble.test.ts).
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = BUBBLE_STYLES;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  document.documentElement.appendChild(host);

  let dispose: (() => void) | null = null;

  function renderNow(pageState: PageLanguageState, busy: boolean): void {
    dispose?.();
    dispose = render(
      () =>
        FloatingBubble({
          pageState,
          busy,
          onRestoreClick,
          onClose: () => {
            onClose();
            host.remove();
          },
        }),
      mountPoint,
    );
  }

  renderNow('original', false);

  return {
    update(pageState, busy) {
      renderNow(pageState, busy);
    },
    unmount() {
      dispose?.();
      host.remove();
    },
  };
}
