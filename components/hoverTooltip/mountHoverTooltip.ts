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

/** Only what this module actually needs from a PageTranslator — a narrower dependency than the full interface, and easier to stub in tests. */
export interface TranslatedNodesSource {
  /**
   * The original text of the translated node directly inside `target`, or
   * null — without materialising a list of every translated node first.
   *
   * Deliberately the ONLY lookup this interface offers. It used to also
   * expose `getTranslatedNodes()` (a fresh array, one object per translated
   * node), which `onMouseMove` stopped using in a round-4 audit and
   * `onMouseOver` stopped using in a UI audit — the latter had been kept on
   * the reasoning that mouseover fires "once per hovered element", when it
   * actually fires on every element boundary the pointer crosses. Removing it
   * from this interface makes the allocating path impossible to reintroduce
   * here without a type error, rather than relying on a test to notice.
   */
  findOriginalTextForElement(target: Element): string | null;
}

/**
 * The node the pointer is really over.
 *
 * For an event that originated inside an OPEN shadow tree the browser
 * retargets `event.target` to the shadow HOST, so reading `target` directly
 * can never identify a shadow-internal element — and page translation
 * deliberately walks open shadow roots (`collectTextNodes`), so those nodes
 * really are translated and really should show their original on hover.
 * `composedPath()[0]` is the un-retargeted node.
 *
 * Both `onMouseOver` and `onMouseOut` must go through this, not just the
 * former: `onMouseOut` compares against `currentTarget`, and once that
 * holds a shadow-internal node a retargeted `mouseout` would no longer
 * match it, leaving the tooltip stranded on screen.
 */
function resolveEventTarget(e: Event): EventTarget | null {
  return e.composedPath()[0] ?? e.target;
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

  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: EventTarget | null = null;

  // Speed fix, found via a round-7 audit: this used to `dispose()` the Solid
  // root and `render()` a fresh one on every call — and `onMouseMove` below
  // calls it on EVERY mousemove while the tooltip is visible, so following
  // the cursor across one element rebuilt the whole root dozens of times.
  // `FloatingBubble` was deliberately moved off this same pattern because
  // the teardown broke drag. Rendered once now, with the component reading
  // through getters so a `setState` just updates the existing DOM node.
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
    if (resolveEventTarget(e) === currentTarget) hide();
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentTarget && !showTimer) {
      // Tooltip already visible for the current target — follow the
      // cursor. Fires on EVERY mousemove while visible.
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
