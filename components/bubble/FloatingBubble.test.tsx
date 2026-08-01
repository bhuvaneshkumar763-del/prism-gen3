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

  const base = {
    pageState: 'original' as const,
    busy: false,
    showTranslatePrompt: false,
    onTranslateClick: vi.fn(),
    onRestoreClick: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders nothing when the page is original and no translate prompt is requested', () => {
    const el = mount(base);
    expect(el.querySelector('.action')).toBeNull();
    expect(el.querySelector('.label')).toBeNull();
  });

  it('shows the "Translated" label and action button once translated', () => {
    const el = mount({ ...base, pageState: 'translated' });
    expect(el.querySelector('.label')?.textContent).toBe('Translated');
    expect(el.querySelector('.action')?.textContent).toBe('Show original');
  });

  it('disables the action and shows a busy label while restoring', () => {
    const el = mount({ ...base, pageState: 'translated', busy: true });
    const action = el.querySelector('.action') as HTMLButtonElement;
    expect(action.textContent).toBe('Restoring…');
    expect(action.disabled).toBe(true);
  });

  it('invokes onRestoreClick when the action button is clicked', () => {
    const onRestoreClick = vi.fn();
    const el = mount({ ...base, pageState: 'translated', onRestoreClick });
    (el.querySelector('.action') as HTMLButtonElement).click();
    expect(onRestoreClick).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the close button is clicked (translated state)', () => {
    const onClose = vi.fn();
    const el = mount({ ...base, pageState: 'translated', onClose });
    (el.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the "Translate this page" prompt on a narrow viewport before translation', () => {
    const el = mount({ ...base, showTranslatePrompt: true });
    expect(el.querySelector('.action')?.textContent).toBe('Translate this page');
  });

  it('does not show the translate prompt once already translated', () => {
    const el = mount({ ...base, pageState: 'translated', showTranslatePrompt: true });
    expect(el.querySelector('.action')?.textContent).toBe('Show original');
  });

  it('invokes onTranslateClick when the translate-prompt button is clicked', () => {
    const onTranslateClick = vi.fn();
    const el = mount({ ...base, showTranslatePrompt: true, onTranslateClick });
    (el.querySelector('.action') as HTMLButtonElement).click();
    expect(onTranslateClick).toHaveBeenCalledTimes(1);
  });

  it('disables the translate-prompt button and shows a busy label while translating', () => {
    const el = mount({ ...base, showTranslatePrompt: true, busy: true });
    const action = el.querySelector('.action') as HTMLButtonElement;
    expect(action.textContent).toBe('Translating…');
    expect(action.disabled).toBe(true);
  });

  it('invokes onClose when the close button is clicked (translate-prompt state)', () => {
    const onClose = vi.fn();
    const el = mount({ ...base, showTranslatePrompt: true, onClose });
    (el.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
