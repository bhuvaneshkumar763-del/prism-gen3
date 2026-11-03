// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { HoverTooltip } from './HoverTooltip';
import type { HoverTooltipPlacement } from './hoverTooltipPlacement';

const PLACEMENT: HoverTooltipPlacement = {
  top: null,
  bottom: 42,
  left: 17,
  right: null,
  maxWidth: 320,
  maxHeight: 200,
};

describe('HoverTooltip', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    container?.remove();
    container = undefined;
    dispose = undefined;
  });

  function mount(props: Parameters<typeof HoverTooltip>[0]) {
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(() => HoverTooltip(props), container);
    return container;
  }

  it('renders nothing when not visible', () => {
    const el = mount({ visible: false, text: 'Hello', placement: PLACEMENT });
    expect(el.querySelector('.tooltip')).toBeNull();
  });

  it('renders the text and position when visible', () => {
    const el = mount({ visible: true, text: 'Hello world', placement: PLACEMENT });
    const tooltip = el.querySelector('.tooltip') as HTMLDivElement;
    expect(tooltip.textContent).toBe('Hello world');
    expect(tooltip.style.bottom).toBe('42px');
    expect(tooltip.style.left).toBe('17px');
    expect(tooltip.style.top).toBe('');
    expect(tooltip.style.right).toBe('');
    expect(tooltip.style.maxWidth).toBe('320px');
    expect(tooltip.style.maxHeight).toBe('200px');
  });
});
