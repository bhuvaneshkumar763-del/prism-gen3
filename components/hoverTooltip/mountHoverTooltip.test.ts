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

/**
 * Dispatches `type` the way a REAL browser delivers an event that
 * originated inside an open shadow tree: `event.target` is retargeted to
 * the shadow HOST, while `composedPath()[0]` is the actual inner node.
 *
 * This has to be constructed by hand because happy-dom does NOT implement
 * retargeting — it reports the inner node as `target` too (verified
 * directly), so simply dispatching on an inner node would test a shape no
 * browser ever produces and would pass even against the pre-fix code. The
 * `composedPath` stub must include document/window or happy-dom's own
 * propagation stops before a document-level listener is reached.
 */
function dispatchRetargetedMouseEvent(
  type: string,
  host: Element,
  innerTarget: Element,
  opts: Partial<MouseEventInit> = {},
): void {
  const event = new MouseEvent(type, { bubbles: true, composed: true, clientX: 10, clientY: 10, ...opts });
  const path: EventTarget[] = [
    innerTarget,
    innerTarget.getRootNode(),
    host,
    document.body,
    document.documentElement,
    document,
    window,
  ];
  Object.defineProperty(event, 'composedPath', { value: () => path, configurable: true });
  host.dispatchEvent(event);
}

/** Mirrors the page translator's real lookup (translateLoop.ts's findOriginalTextForElement) so the mock behaves like the real thing. */
function stubCanHover(canHover: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: hover)' && canHover, media: query }));
}

function makeSource(entries: Array<{ node: Text; original: string }>): TranslatedNodesSource {
  return {
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
    stubCanHover(true);
    document.body.innerHTML = '<p id="target">Hola</p>';
  });

  afterEach(() => {
    document.getElementById('prism-hover-tooltip-host')?.remove();
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is a no-op where the primary pointer cannot hover, even with a desktop user agent (an iPad or iPhone in desktop mode)', () => {
    stubCanHover(false);
    const p = document.getElementById('target') as HTMLParagraphElement;
    const text = p.firstChild as Text;
    text.data = 'Hello';
    mountHoverTooltip(makeSource([{ node: text, original: 'Hola' }]));

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(1000);

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

  it('looks up the original through the allocation-free path on both mouseover and mousemove — the allocating getTranslatedNodes() is no longer part of TranslatedNodesSource at all, so reintroducing it here is a type error rather than something this test has to catch', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const lookup = vi.fn((target: Element) => (target === p && textNode.data !== 'Hello' ? 'Hello' : null));
    const controller = mountHoverTooltip({ findOriginalTextForElement: lookup });

    dispatchMouseEvent('mouseover', p, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(350);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')?.textContent).toBe('Hello');
    const callsAfterShow = lookup.mock.calls.length;
    expect(callsAfterShow).toBeGreaterThan(0); // mouseover used it

    dispatchMouseEvent('mousemove', p, { clientX: 200, clientY: 200 });
    expect(lookup.mock.calls.length).toBeGreaterThan(callsAfterShow); // mousemove used it too

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

  it('resolves the original for text inside an OPEN SHADOW ROOT, where the browser retargets event.target to the shadow host — real user-visible miss this closed: page translation deliberately walks open shadow roots (collectTextNodes), so the exact widgets shadow support was added for (a Bilibili-style comment list) translated fine and then showed nothing on hover, because event.target is the host and findOriginalTextForElement matches on node.parentElement', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('p');
    inner.textContent = 'Hola';
    shadow.appendChild(inner);
    const textNode = inner.firstChild as Text;

    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchRetargetedMouseEvent('mouseover', host, inner);
    vi.advanceTimersByTime(350);

    expect(tooltipShadowRoot()?.querySelector('.tooltip')?.textContent).toBe('Hello');

    controller.destroy();
    host.remove();
  });

  it('hides a shadow-DOM tooltip on mouseout — guards the specific NEW bug that fixing only onMouseOver would introduce: once currentTarget holds the shadow-internal node, a retargeted mouseout (target = host) no longer equals it, so hide() never fires and the tooltip stays stranded on screen', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('p');
    inner.textContent = 'Hola';
    shadow.appendChild(inner);
    const textNode = inner.firstChild as Text;

    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchRetargetedMouseEvent('mouseover', host, inner);
    vi.advanceTimersByTime(350);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).not.toBeNull();

    dispatchRetargetedMouseEvent('mouseout', host, inner);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();

    controller.destroy();
    host.remove();
  });

  it('updates the SAME tooltip element while following the cursor instead of tearing down and recreating its Solid root on every mousemove — real perf bug this closed: renderState() did dispose() + a fresh render() per call, and onMouseMove calls it on every single mousemove while visible; FloatingBubble was deliberately moved off this exact pattern because the teardown broke drag', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = makeSource([{ node: textNode, original: 'Hello' }]);
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p, { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(350);
    const firstElement = tooltipShadowRoot()?.querySelector('.tooltip') as HTMLElement;
    expect(firstElement).not.toBeNull();
    const initialLeft = firstElement.style.left;

    dispatchMouseEvent('mousemove', p, { clientX: 200, clientY: 200 });
    dispatchMouseEvent('mousemove', p, { clientX: 300, clientY: 300 });
    dispatchMouseEvent('mousemove', p, { clientX: 400, clientY: 400 });

    const afterMoves = tooltipShadowRoot()?.querySelector('.tooltip') as HTMLElement;
    // Same DOM node, mutated in place — a re-render would have replaced it.
    expect(afterMoves).toBe(firstElement);
    // ...and it genuinely followed the cursor, so this isn't passing by
    // virtue of the tooltip having stopped updating at all.
    expect(afterMoves.style.left).not.toBe(initialLeft);

    controller.destroy();
  });

  /** The tooltip's box in viewport coordinates, from whichever edges it is anchored by. */
  function tooltipBox(): { top: number | null; bottom: number | null; left: number; right: number } {
    const el = tooltipShadowRoot()?.querySelector('.tooltip') as HTMLElement;
    const vw = window.visualViewport?.width || window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    const maxWidth = Number.parseFloat(el.style.maxWidth);
    const left = el.style.left ? Number.parseFloat(el.style.left) : vw - Number.parseFloat(el.style.right) - maxWidth;
    return {
      top: el.style.top ? Number.parseFloat(el.style.top) : null,
      bottom: el.style.bottom ? vh - Number.parseFloat(el.style.bottom) : null,
      left,
      right: left + maxWidth,
    };
  }

  it('sits above the hovered line when there is room, instead of covering the next line', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    p.style.lineHeight = '20px';
    const textNode = p.firstChild as Text;
    const controller = mountHoverTooltip(makeSource([{ node: textNode, original: 'Hello' }]));

    dispatchMouseEvent('mouseover', p, { clientX: 100, clientY: 300 });
    vi.advanceTimersByTime(350);

    const box = tooltipBox();
    expect(box.top).toBeNull();
    // Its bottom edge is clear of the line the cursor is on (at most one line tall above the cursor).
    expect(box.bottom).not.toBeNull();
    expect(box.bottom as number).toBeLessThanOrEqual(300 - 20);
    controller.destroy();
  });

  it('goes below the hovered line when the line is at the very top of the screen', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    p.style.lineHeight = '20px';
    const textNode = p.firstChild as Text;
    const controller = mountHoverTooltip(makeSource([{ node: textNode, original: 'Hello' }]));

    dispatchMouseEvent('mouseover', p, { clientX: 100, clientY: 20 });
    vi.advanceTimersByTime(350);

    const box = tooltipBox();
    expect(box.bottom).toBeNull();
    expect(box.top as number).toBeGreaterThanOrEqual(20 + 20);
    controller.destroy();
  });

  it('stays inside the viewport when the cursor is at the right edge', () => {
    const vw = window.visualViewport?.width || window.innerWidth;
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const controller = mountHoverTooltip(makeSource([{ node: textNode, original: 'Hello' }]));

    dispatchMouseEvent('mouseover', p, { clientX: vw - 4, clientY: 300 });
    vi.advanceTimersByTime(350);

    const box = tooltipBox();
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(vw - 8);
    controller.destroy();
  });

  it('hides when the pointer moves onto an element with no original text, even without a mouseout for the old one', () => {
    document.body.innerHTML = '<p id="target">Hola</p><p id="plain">Plain</p>';
    const p = document.getElementById('target') as HTMLParagraphElement;
    const plain = document.getElementById('plain') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const controller = mountHoverTooltip(makeSource([{ node: textNode, original: 'Hello' }]));

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(350);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).not.toBeNull();

    dispatchMouseEvent('mouseover', plain);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();
    controller.destroy();
  });

  it('hides when the page is shown in the original while the tooltip is up', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const controller = mountHoverTooltip(makeSource([{ node: textNode, original: 'Hello' }]));
    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(350);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).not.toBeNull();

    textNode.data = 'Hello';
    dispatchMouseEvent('mousemove', p, { clientX: 12, clientY: 12 });

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
