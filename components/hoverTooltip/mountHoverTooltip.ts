import { render } from 'solid-js/web';
import { findOriginalTextForElement } from '../../src/engine/pageTranslator/hoverOriginalText';
import { createShadowHost } from '../../src/shared/ui/shadowHost';
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
  /**
   * Speed fix, found via a round-4 audit: same lookup as
   * `findOriginalTextForElement(target, getTranslatedNodes())` but without
   * materialising an intermediate array first — see this file's own
   * `onMouseMove` for why that matters on a high-frequency event. Used
   * ONLY there; `onMouseOver` below still uses `getTranslatedNodes()`
   * directly, since it fires far less often (once per hovered element).
   */
  findOriginalTextForElement(target: Element): string | null;
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

  const { host, mountPoint } = createShadowHost(HOST_ID, HOVER_TOOLTIP_STYLES);

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
      // Cleared once the debounce actually fires, not just on hide()/a new
      // target — otherwise `showTimer` stays truthy forever after the first
      // show, and onMouseMove's `!showTimer` guard below never passes again
      // for the rest of this hover, silently disabling "follows the cursor
      // while visible" (this module's own header comment) from the very
      // first tooltip shown.
      showTimer = null;
      renderState(true, original, e.clientY + 16, e.clientX + 8);
    }, SHOW_DELAY_MS);
  }

  function onMouseOut(e: MouseEvent): void {
    if (e.target === currentTarget) hide();
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentTarget && !showTimer) {
      // Tooltip already visible for the current target — follow the
      // cursor. Fires on EVERY mousemove while visible, so this uses the
      // allocation-free lookup rather than getTranslatedNodes() — see
      // TranslatedNodesSource's doc comment.
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
      dispose?.();
      host.remove();
    },
  };
}
