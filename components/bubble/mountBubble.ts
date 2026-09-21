import { render } from 'solid-js/web';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
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
  onTranslate(targetLanguage: string, sourceLanguage?: string): void;
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
  const { host, mountPoint } = createShadowHost(HOST_ID, BUBBLE_STYLES);

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
          // Reliability fix, found via a round-6 audit: this used to just
          // remove the host, never calling `dispose()` — so Solid's
          // `onCleanup` (FloatingBubble.tsx) never ran and every listener
          // it registers (document pointerdown/fullscreenchange, window
          // resize/orientationchange/visualViewport, the configStore.onChanged
          // subscription) survived for the page's lifetime, per Hide click.
          // `content.ts`'s own `onClose` nulls its `bubble` reference right
          // after this fires, so `dispose` became permanently unreachable —
          // not a slow leak, a guaranteed one. Same cleanup `unmount()`
          // already does below; Hide and unmount are both "stop showing
          // this bubble," they just differ in who initiated it.
          options.onClose();
          dispose();
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
