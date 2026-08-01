// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingBubble } from './FloatingBubble';

describe('FloatingBubble', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    container?.remove();
    container = undefined;
    dispose = undefined;
  });

  function mount(props: Parameters<typeof FloatingBubble>[0]) {
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(() => FloatingBubble(props), container);
    return container;
  }

  it('renders nothing when the page is in its original state', () => {
    const el = mount({ pageState: 'original', busy: false, onRestoreClick: vi.fn(), onClose: vi.fn() });
    expect(el.querySelector('.action')).toBeNull();
    expect(el.querySelector('.label')).toBeNull();
  });

  it('shows the "Translated" label and action button once translated', () => {
    const el = mount({ pageState: 'translated', busy: false, onRestoreClick: vi.fn(), onClose: vi.fn() });
    expect(el.querySelector('.label')?.textContent).toBe('Translated');
    expect(el.querySelector('.action')?.textContent).toBe('Show original');
  });

  it('disables the action and shows a busy label while restoring', () => {
    const el = mount({ pageState: 'translated', busy: true, onRestoreClick: vi.fn(), onClose: vi.fn() });
    const action = el.querySelector('.action') as HTMLButtonElement;
    expect(action.textContent).toBe('Restoring…');
    expect(action.disabled).toBe(true);
  });

  it('invokes onRestoreClick when the action button is clicked', () => {
    const onRestoreClick = vi.fn();
    const el = mount({ pageState: 'translated', busy: false, onRestoreClick, onClose: vi.fn() });
    (el.querySelector('.action') as HTMLButtonElement).click();
    expect(onRestoreClick).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const el = mount({ pageState: 'translated', busy: false, onRestoreClick: vi.fn(), onClose });
    (el.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
