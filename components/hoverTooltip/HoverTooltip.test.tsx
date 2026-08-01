// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { HoverTooltip } from './HoverTooltip';

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
    const el = mount({ visible: false, text: 'Hello', top: 10, left: 10 });
    expect(el.querySelector('.tooltip')).toBeNull();
  });

  it('renders the text and position when visible', () => {
    const el = mount({ visible: true, text: 'Hello world', top: 42, left: 17 });
    const tooltip = el.querySelector('.tooltip') as HTMLDivElement;
    expect(tooltip.textContent).toBe('Hello world');
    expect(tooltip.style.top).toBe('42px');
    expect(tooltip.style.left).toBe('17px');
  });
});
