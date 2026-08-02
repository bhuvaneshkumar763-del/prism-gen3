// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configStore } from '../../src/platform/configStore';
import { mountBubble } from './mountBubble';

function bubbleShadowRoot(): ShadowRoot {
  const host = document.getElementById('prism-bubble-host');
  if (!host?.shadowRoot) throw new Error('bubble host/shadow root not found');
  return host.shadowRoot;
}

function options(overrides: Partial<Parameters<typeof mountBubble>[0]> = {}) {
  return {
    hostname: 'example.com',
    onTranslate: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('mountBubble', () => {
  beforeEach(async () => {
    await configStore.onReady();
  });

  afterEach(() => {
    document.getElementById('prism-bubble-host')?.remove();
  });

  it('renders the ball and panel immediately (always visible, not gated on translated state)', () => {
    const controller = mountBubble(options());
    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.ball')).not.toBeNull();
    expect(shadow.querySelector('.panel .primary')).not.toBeNull();
    controller.unmount();
  });

  it('shows "Translate page" before translation', () => {
    const controller = mountBubble(options());
    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.primary')?.textContent).toBe('Translate page');
    controller.unmount();
  });

  it('shows "Show original" once update() reports the translated state', () => {
    const controller = mountBubble(options());
    controller.update({ pageState: 'translated' });

    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.primary')?.textContent).toBe('Show original');
    controller.unmount();
  });

  it('shows a busy label and disables the primary button while busy', () => {
    const controller = mountBubble(options());
    controller.update({ pageState: 'translated', busy: true });

    const shadow = bubbleShadowRoot();
    const primary = shadow.querySelector('.primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('Restoring…');
    expect(primary.disabled).toBe(true);
    controller.unmount();
  });

  it('calls onRestore when the primary button is clicked while translated', () => {
    const onRestore = vi.fn();
    const controller = mountBubble(options({ onRestore }));
    controller.update({ pageState: 'translated' });

    const shadow = bubbleShadowRoot();
    (shadow.querySelector('.primary') as HTMLButtonElement).click();

    expect(onRestore).toHaveBeenCalledTimes(1);
    controller.unmount();
  });

  it('calls onClose and removes the host when the Hide chip is clicked', () => {
    const onClose = vi.fn();
    mountBubble(options({ onClose }));

    const shadow = bubbleShadowRoot();
    const hideChip = Array.from(shadow.querySelectorAll('.chip')).find((el) => el.textContent?.includes('Hide'));
    (hideChip as HTMLElement).click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.getElementById('prism-bubble-host')).toBeNull();
  });

  it('unmount() removes the host element', () => {
    const controller = mountBubble(options());
    expect(document.getElementById('prism-bubble-host')).not.toBeNull();

    controller.unmount();

    expect(document.getElementById('prism-bubble-host')).toBeNull();
  });

  it('replaces any existing host if called again (no duplicate bubbles)', () => {
    const first = mountBubble(options());
    void first;
    mountBubble(options());

    expect(document.querySelectorAll('#prism-bubble-host')).toHaveLength(1);
  });

  it('shows a real error instead of the normal "Translated" success once errorMessage is set', () => {
    const controller = mountBubble(options());
    controller.update({ pageState: 'translated', errorMessage: 'HTTP 429' });

    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.htitle')?.textContent).toBe('Translation failed');
    expect(shadow.querySelector('.errorText')?.textContent).toBe('HTTP 429');
    // Never claims success while an error is active — the whole bug this guards against.
    expect(shadow.querySelector('.primary')?.textContent).not.toBe('Show original');
    controller.unmount();
  });

  it('the error state offers a Retry action that calls onTranslate', () => {
    const onTranslate = vi.fn();
    const controller = mountBubble(options({ onTranslate }));
    controller.update({ pageState: 'translated', errorMessage: 'HTTP 429' });

    const shadow = bubbleShadowRoot();
    expect(shadow.querySelector('.primary')?.textContent).toBe('Retry');
    (shadow.querySelector('.primary') as HTMLButtonElement).click();

    expect(onTranslate).toHaveBeenCalledTimes(1);
    controller.unmount();
  });
});
