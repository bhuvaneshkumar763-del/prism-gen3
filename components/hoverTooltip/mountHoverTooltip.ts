import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { HoverTooltip } from './HoverTooltip';
import { HOVER_TOOLTIP_STYLES } from './hoverTooltipStyles';

const HOST_ID = 'prism-hover-tooltip-host';
const SHOW_DELAY_MS = 350;
const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i;

export interface HoverTooltipController {
  destroy(): void;
}

/** The slice of PageTranslator this module needs; easy to stub in tests. */
export interface TranslatedNodesSource {
  /**
   * The original text of the translated node directly inside `target`, or null.
   * The only lookup on purpose: mouseover/mousemove fire constantly, so no
   * API here may allocate a list of every translated node.
   */
  findOriginalTextForElement(target: Element): string | null;
}

/**
 * The node the pointer is really over. Events from an open shadow tree are
 * retargeted to the host, but page translation walks open shadow roots, so
 * use the un-retargeted `composedPath()[0]`. Over and out must both use this,
 * or `onMouseOut` won't match `currentTarget` and the tooltip gets stranded.
 */
function resolveEventTarget(e: Event): EventTarget | null {
  return e.composedPath()[0] ?? e.target;
}

/**
 * Hover over translated text to see the original. Desktop only (touch has no
 * hover); debounced so sweeping the mouse doesn't flicker, then follows the
 * cursor. `pageTranslator` is queried live, so no observer is needed.
 */
export function mountHoverTooltip(pageTranslator: TranslatedNodesSource): HoverTooltipController {
  if (MOBILE_USER_AGENT.test(navigator.userAgent)) {
    return { destroy() {} };
  }

  const { host, mountPoint } = createShadowHost(HOST_ID, HOVER_TOOLTIP_STYLES);

  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: EventTarget | null = null;

  // Rendered once; props are getters over a signal, so the per-mousemove
  // `setState` updates the existing node instead of rebuilding the root.
  const [state, setState] = createSignal({ visible: false, text: '', top: 0, left: 0 });
  const dispose = render(
    () =>
      HoverTooltip({
        get visible() {
          return state().visible;
        },
        get text() {
          return state().text;
        },
        get top() {
          return state().top;
        },
        get left() {
          return state().left;
        },
      }),
    mountPoint,
  );

  function renderState(visible: boolean, text: string, top: number, left: number): void {
    setState({ visible, text, top, left });
  }

  function hide(): void {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    currentTarget = null;
    renderState(false, '', 0, 0);
  }

  function onMouseOver(e: MouseEvent): void {
    const target = resolveEventTarget(e);
    if (!(target instanceof Element) || target === currentTarget) return;
    currentTarget = target;
    if (showTimer) clearTimeout(showTimer);

    const original = pageTranslator.findOriginalTextForElement(target);
    if (!original) return;

    showTimer = setTimeout(() => {
      // Cleared on fire so onMouseMove's `!showTimer` check can start
      // following the cursor.
      showTimer = null;
      renderState(true, original, e.clientY + 16, e.clientX + 8);
    }, SHOW_DELAY_MS);
  }

  function onMouseOut(e: MouseEvent): void {
    if (resolveEventTarget(e) === currentTarget) hide();
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentTarget && !showTimer) {
      // Visible for the current target: follow the cursor.
      const original = pageTranslator.findOriginalTextForElement(currentTarget as Element);
      if (original) renderState(true, original, e.clientY + 16, e.clientX + 8);
    }
  }

  document.addEventListener('mouseover', onMouseOver, { passive: true });
  document.addEventListener('mouseout', onMouseOut, { passive: true });
  document.addEventListener('mousemove', onMouseMove, { passive: true });

  return {
    destroy() {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousemove', onMouseMove);
      if (showTimer) clearTimeout(showTimer);
      dispose();
      host.remove();
    },
  };
}
