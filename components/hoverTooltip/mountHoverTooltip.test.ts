// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslatedNodesSource } from './mountHoverTooltip';
import { mountHoverTooltip } from './mountHoverTooltip';

function tooltipShadowRoot(): ShadowRoot | null {
  const host = document.getElementById('prism-hover-tooltip-host');
  return host?.shadowRoot ?? null;
}

function dispatchMouseEvent(type: string, target: Element, opts: Partial<MouseEventInit> = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10, ...opts }));
}

/** Mirrors hoverOriginalText.ts's real scan, so findOriginalTextForElement behaves identically to getTranslatedNodes()'s data — both must stay in sync for a mock to be realistic. */
function makeSource(entries: Array<{ node: Text; original: string }>): TranslatedNodesSource {
  return {
    getTranslatedNodes: () => entries,
    findOriginalTextForElement: (target) => {
      for (const { node, original } of entries) {
        if (node.parentElement === target && node.data !== original) return original;
      }
      return null;
    },
  };
}

describe('mountHoverTooltip', () => {
  let originalUserAgent: string;

  beforeEach(() => {
    vi.useFakeTimers();
    originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DesktopBrowser',
      configurable: true,
    });
    document.body.innerHTML = '<p id="target">Hola</p>';
  });

  afterEach(() => {
    document.getElementById('prism-hover-tooltip-host')?.remove();
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    vi.useRealTimers();
  });

  it('is a no-op on a mobile user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 10)',
      configurable: true,
    });
    const source: TranslatedNodesSource = makeSource([]);
    mountHoverTooltip(source);

    expect(document.getElementById('prism-hover-tooltip-host')).toBeNull();
  });

  it('shows the original text after hovering a translated element past the debounce delay', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(349);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();

    vi.advanceTimersByTime(1);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')?.textContent).toBe('Hello');

    controller.destroy();
  });

  it("follows the cursor while visible, matching this module's own documented behavior", () => {
    // Regression: showTimer was only ever cleared by hide()/a new target,
    // never by its own callback firing — so onMouseMove's `!showTimer`
    // guard stayed false forever after the FIRST tooltip shown, silently
    // freezing the tooltip in its initial position for the rest of that hover.
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(350);
    const tooltip = tooltipShadowRoot()?.querySelector('.tooltip') as HTMLElement;
    const initialLeft = tooltip.style.left;

    dispatchMouseEvent('mousemove', p, { clientX: 200, clientY: 200 });

    const movedTooltip = tooltipShadowRoot()?.querySelector('.tooltip') as HTMLElement;
    expect(movedTooltip.style.left).not.toBe(initialLeft);

    controller.destroy();
  });

  it('onMouseMove uses findOriginalTextForElement, not getTranslatedNodes() — speed fix, found via a round-4 audit: getTranslatedNodes() allocates a fresh N-object array on every call, so calling it on every mousemove event while the tooltip is visible was real, measurable jank on a page with thousands of translated nodes', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    let getTranslatedNodesCalls = 0;
    const source: TranslatedNodesSource = {
      // Deliberately returns WRONG data — if onMouseMove regressed to
      // calling this instead of findOriginalTextForElement, the tooltip
      // would fail to move/update and this test would catch it.
      getTranslatedNodes: () => {
        getTranslatedNodesCalls++;
        return [];
      },
      findOriginalTextForElement: (target) => (target === p && textNode.data !== 'Hello' ? 'Hello' : null),
    };
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(350);
    const callsAfterShow = getTranslatedNodesCalls; // onMouseOver legitimately calls it once

    dispatchMouseEvent('mousemove', p, { clientX: 200, clientY: 200 });
    dispatchMouseEvent('mousemove', p, { clientX: 300, clientY: 300 });

    expect(tooltipShadowRoot()?.querySelector('.tooltip')?.textContent).toBe('Hello');
    expect(getTranslatedNodesCalls).toBe(callsAfterShow); // no further calls from onMouseMove

    controller.destroy();
  });

  it('does not show a tooltip for an element with no translated node', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const source: TranslatedNodesSource = makeSource([]);
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(500);

    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();
    controller.destroy();
  });

  it('hides the tooltip on mouseout', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(500);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).not.toBeNull();

    dispatchMouseEvent('mouseout', p);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();

    controller.destroy();
  });

  it('destroy() removes the host and listeners', () => {
    const source: TranslatedNodesSource = makeSource([]);
    const controller = mountHoverTooltip(source);
    expect(document.getElementById('prism-hover-tooltip-host')).not.toBeNull();

    controller.destroy();

    expect(document.getElementById('prism-hover-tooltip-host')).toBeNull();
  });
});
