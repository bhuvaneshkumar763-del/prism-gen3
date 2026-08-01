// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBubble } from './mountBubble';

function bubbleShadowRoot(): ShadowRoot {
  const host = document.getElementById('prism-bubble-host');
  if (!host?.shadowRoot) throw new Error('bubble host/shadow root not found');
  return host.shadowRoot;
}

describe('mountBubble', () => {
  afterEach(() => {
    document.getElementById('prism-bubble-host')?.remove();
  });

  it('renders nothing visible until update() reports a translated state', () => {
    const controller = mountBubble(vi.fn(), vi.fn());
    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.action')).toBeNull();
    controller.unmount();
  });

  it('shows the "Show original" action once translated', () => {
    const controller = mountBubble(vi.fn(), vi.fn());
    controller.update('translated', false);

    const shadow = bubbleShadowRoot();
    const action = shadow.querySelector('.action');
    expect(action?.textContent).toBe('Show original');
    controller.unmount();
  });

  it('shows a busy label and disables the action while restoring', () => {
    const controller = mountBubble(vi.fn(), vi.fn());
    controller.update('translated', true);

    const shadow = bubbleShadowRoot();
    const action = shadow.querySelector('.action') as HTMLButtonElement;
    expect(action.textContent).toBe('Restoring…');
    expect(action.disabled).toBe(true);
    controller.unmount();
  });

  it('calls onRestoreClick when the action button is clicked', () => {
    const onRestoreClick = vi.fn();
    const controller = mountBubble(onRestoreClick, vi.fn());
    controller.update('translated', false);

    const shadow = bubbleShadowRoot();
    const action = shadow.querySelector('.action') as HTMLButtonElement;
    action.click();

    expect(onRestoreClick).toHaveBeenCalledTimes(1);
    controller.unmount();
  });

  it('calls onClose and removes the host when the close button is clicked', () => {
    const onClose = vi.fn();
    const controller = mountBubble(vi.fn(), onClose);
    controller.update('translated', false);

    const shadow = bubbleShadowRoot();
    const closeButton = shadow.querySelector('.close') as HTMLButtonElement;
    closeButton.click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.getElementById('prism-bubble-host')).toBeNull();
  });

  it('unmount() removes the host element', () => {
    const controller = mountBubble(vi.fn(), vi.fn());
    expect(document.getElementById('prism-bubble-host')).not.toBeNull();

    controller.unmount();

    expect(document.getElementById('prism-bubble-host')).toBeNull();
  });

  it('replaces any existing host if called again (no duplicate bubbles)', () => {
    const first = mountBubble(vi.fn(), vi.fn());
    void first;
    mountBubble(vi.fn(), vi.fn());

    expect(document.querySelectorAll('#prism-bubble-host')).toHaveLength(1);
  });

  it('reverts to hidden when update() reports the original state again', () => {
    const controller = mountBubble(vi.fn(), vi.fn());
    controller.update('translated', false);
    controller.update('original', false);

    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.action')).toBeNull();
    controller.unmount();
  });
});
