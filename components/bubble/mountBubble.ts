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
 * Creates the shadow-DOM host and mounts `FloatingBubble` into it once.
 * `update()` only sets the store: re-rendering would recreate the element
 * being dragged, re-add every listener and drop pointer capture mid-drag.
 */
export function mountBubble(options: MountBubbleOptions): BubbleController {
  const { host, mountPoint } = createShadowHost(HOST_ID, BUBBLE_STYLES);

  // A copy, because createStore mutates its target in place: sharing the
  // module-level default would leak one instance's updates into the next.
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
          // Hide must dispose like unmount(): content.ts drops its controller
          // here, so this is the only chance to run FloatingBubble's
          // onCleanup and remove its document/window/config listeners.
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
