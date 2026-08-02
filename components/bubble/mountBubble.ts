import { render } from 'solid-js/web';
import { type BubbleViewState, createBubbleState, DEFAULT_BUBBLE_VIEW_STATE } from './bubbleState';
import { BUBBLE_STYLES } from './bubbleStyles';
import { FloatingBubble } from './FloatingBubble';

const HOST_ID = 'prism-bubble-host';

export interface BubbleController {
  update(patch: Partial<BubbleViewState>): void;
  unmount(): void;
}

export interface MountBubbleOptions {
  hostname: string;
  onTranslate(targetLanguage: string): void;
  onRestore(): void;
  onClose(): void;
}

/**
 * Creates the shadow-DOM host and mounts `FloatingBubble` into it, exactly
 * once per controller instance. `content.ts` calls `update(patch)` on every
 * page-translator state/error change and `unmount()` when the bubble should
 * disappear (hidden for this host, or the user clicked Hide).
 *
 * Renders **once**, not on every `update()` — a prior version disposed and
 * re-rendered the whole tree per update, which is incompatible with the
 * always-on, draggable bubble this now is: the element drag math writes
 * `style.left`/`top` onto would be destroyed and recreated mid-drag, every
 * `onMount` listener (pointer handlers, config subscriptions) would be torn
 * down and re-added, and pointer capture would be lost. `update()` now just
 * calls the store's setter; `FloatingBubble` reads the store directly in
 * JSX so Solid's fine-grained reactivity handles the redraw.
 */
export function mountBubble(options: MountBubbleOptions): BubbleController {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 'open' (not 'closed'): the bubble only ever shows a translate/restore
  // toggle and language/service pickers — no user data — so the isolation
  // benefit of a closed root is marginal, and 'open' keeps this testable
  // via `host.shadowRoot` from outside (see mountBubble.test.ts).
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = BUBBLE_STYLES;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  document.documentElement.appendChild(host);

  // A fresh object literal, not the shared DEFAULT_BUBBLE_VIEW_STATE
  // reference — Solid's createStore mutates its target object in place, so
  // reusing the same module-level constant across multiple mountBubble()
  // calls (e.g. one per test) would let one instance's update() bleed into
  // another's initial state.
  const [state, setState] = createBubbleState({ ...DEFAULT_BUBBLE_VIEW_STATE });

  const dispose = render(
    () =>
      FloatingBubble({
        state,
        hostname: options.hostname,
        shadowHost: host,
        onTranslate: options.onTranslate,
        onRestore: options.onRestore,
        onClose: () => {
          options.onClose();
          host.remove();
        },
      }),
    mountPoint,
  );

  return {
    update(patch) {
      setState(patch);
    },
    unmount() {
      dispose();
      host.remove();
    },
  };
}
