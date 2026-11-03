import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { canHover } from '../../src/shared/ui/pointer';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { viewportSize } from '../../src/shared/ui/viewport';
import { HoverTooltip } from './HoverTooltip';
import { type HoverTooltipPlacement, placeHoverTooltip } from './hoverTooltipPlacement';
import { HOVER_TOOLTIP_STYLES } from './hoverTooltipStyles';

const HOST_ID = 'prism-hover-tooltip-host';
const SHOW_DELAY_MS = 350;
const HIDDEN_PLACEMENT: HoverTooltipPlacement = {
  top: 0,
  bottom: null,
  left: 0,
  right: null,
  maxWidth: 0,
  maxHeight: 0,
};

/** The hovered text's line height, which the tooltip keeps clear of; `normal` is about 1.2em. */
function lineHeightOf(element: Element): number {
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 20;
}

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
 * Hover over translated text to see the original. Only where the primary
 * pointer hovers (touch has no hover); debounced so sweeping the mouse
 * doesn't flicker, then follows the cursor. `pageTranslator` is queried live,
 * so no observer is needed.
 */
export function mountHoverTooltip(pageTranslator: TranslatedNodesSource): HoverTooltipController {
  if (!canHover()) {
    return { destroy() {} };
  }

  const { host, mountPoint } = createShadowHost(HOST_ID, HOVER_TOOLTIP_STYLES);

  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: EventTarget | null = null;
  // Read once per target: getComputedStyle on every mousemove would be wasted work.
  let currentLineHeight = 20;

  // Rendered once; props are getters over a signal, so the per-mousemove
  // `setState` updates the existing node instead of rebuilding the root.
  const [state, setState] = createSignal({ visible: false, text: '', placement: HIDDEN_PLACEMENT });
  const dispose = render(
    () =>
      HoverTooltip({
        get visible() {
          return state().visible;
        },
        get text() {
          return state().text;
        },
        get placement() {
          return state().placement;
        },
      }),
    mountPoint,
  );

  function showAt(text: string, x: number, y: number): void {
    setState({ visible: true, text, placement: placeHoverTooltip({ x, y }, currentLineHeight, viewportSize()) });
  }

  function hide(): void {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    currentTarget = null;
    if (state().visible) setState({ visible: false, text: '', placement: HIDDEN_PLACEMENT });
  }

  function onMouseOver(e: MouseEvent): void {
    const target = resolveEventTarget(e);
    if (!(target instanceof Element) || target === currentTarget) return;
    const original = pageTranslator.findOriginalTextForElement(target);
    // A target with no original never keeps the previous target's tooltip up.
    hide();
    currentTarget = target;
    if (!original) return;
    currentLineHeight = lineHeightOf(target);

    showTimer = setTimeout(() => {
      // Cleared on fire so onMouseMove's `!showTimer` check can start
      // following the cursor.
      showTimer = null;
      showAt(original, e.clientX, e.clientY);
    }, SHOW_DELAY_MS);
  }

  function onMouseOut(e: MouseEvent): void {
    if (resolveEventTarget(e) === currentTarget) hide();
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentTarget && !showTimer) {
      // Visible for the current target: follow the cursor.
      const original = pageTranslator.findOriginalTextForElement(currentTarget as Element);
      if (original) showAt(original, e.clientX, e.clientY);
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
