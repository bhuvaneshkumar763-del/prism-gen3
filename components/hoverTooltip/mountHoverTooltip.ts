import { render } from 'solid-js/web';
import { findOriginalTextForElement } from '../../src/engine/pageTranslator/hoverOriginalText';
import { HoverTooltip } from './HoverTooltip';
import { HOVER_TOOLTIP_STYLES } from './hoverTooltipStyles';

const HOST_ID = 'prism-hover-tooltip-host';
const SHOW_DELAY_MS = 350;
const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i;

export interface HoverTooltipController {
  destroy(): void;
}

/** Only what this module actually needs from a PageTranslator — a narrower dependency than the full interface, and easier to stub in tests. */
export interface TranslatedNodesSource {
  getTranslatedNodes(): ReadonlyArray<{ node: Text; original: string }>;
}

/**
 * Wires up "hover over translated text to see the original." Desktop only
 * (matches the old repo's behavior — hover has no equivalent on touch), a
 * debounce before showing (so moving the mouse across the page doesn't
 * flicker a tooltip per element), and follows the cursor while visible.
 *
 * `pageTranslator` is read live on every hover — no snapshot — so this
 * naturally reflects whatever's currently translated without its own
 * mutation-observer wiring.
 */
export function mountHoverTooltip(pageTranslator: TranslatedNodesSource): HoverTooltipController {
  if (MOBILE_USER_AGENT.test(navigator.userAgent)) {
    return { destroy() {} };
  }

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = HOVER_TOOLTIP_STYLES;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.documentElement.appendChild(host);

  let dispose: (() => void) | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: EventTarget | null = null;

  function renderState(visible: boolean, text: string, top: number, left: number): void {
    dispose?.();
    dispose = render(() => HoverTooltip({ visible, text, top, left }), mountPoint);
  }
  renderState(false, '', 0, 0);

  function hide(): void {
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    currentTarget = null;
    renderState(false, '', 0, 0);
  }

  function onMouseOver(e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof Element) || target === currentTarget) return;
    currentTarget = target;
    if (showTimer) clearTimeout(showTimer);

    const original = findOriginalTextForElement(target, pageTranslator.getTranslatedNodes());
    if (!original) return;

    showTimer = setTimeout(() => {
      renderState(true, original, e.clientY + 16, e.clientX + 8);
    }, SHOW_DELAY_MS);
  }

  function onMouseOut(e: MouseEvent): void {
    if (e.target === currentTarget) hide();
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentTarget && !showTimer) {
      // Tooltip already visible for the current target — follow the cursor.
      const original = findOriginalTextForElement(currentTarget as Element, pageTranslator.getTranslatedNodes());
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
      dispose?.();
      host.remove();
    },
  };
}
