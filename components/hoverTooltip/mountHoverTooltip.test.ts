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
    const source: TranslatedNodesSource = { getTranslatedNodes: () => [] };
    mountHoverTooltip(source);

    expect(document.getElementById('prism-hover-tooltip-host')).toBeNull();
  });

  it('shows the original text after hovering a translated element past the debounce delay', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = {
      getTranslatedNodes: () => [{ node: textNode, original: 'Hello' }],
    };
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(349);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();

    vi.advanceTimersByTime(1);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')?.textContent).toBe('Hello');

    controller.destroy();
  });

  it('does not show a tooltip for an element with no translated node', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const source: TranslatedNodesSource = { getTranslatedNodes: () => [] };
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(500);

    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();
    controller.destroy();
  });

  it('hides the tooltip on mouseout', () => {
    const p = document.getElementById('target') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    const source: TranslatedNodesSource = {
      getTranslatedNodes: () => [{ node: textNode, original: 'Hello' }],
    };
    const controller = mountHoverTooltip(source);

    dispatchMouseEvent('mouseover', p);
    vi.advanceTimersByTime(500);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).not.toBeNull();

    dispatchMouseEvent('mouseout', p);
    expect(tooltipShadowRoot()?.querySelector('.tooltip')).toBeNull();

    controller.destroy();
  });

  it('destroy() removes the host and listeners', () => {
    const source: TranslatedNodesSource = { getTranslatedNodes: () => [] };
    const controller = mountHoverTooltip(source);
    expect(document.getElementById('prism-hover-tooltip-host')).not.toBeNull();

    controller.destroy();

    expect(document.getElementById('prism-hover-tooltip-host')).toBeNull();
  });
});
