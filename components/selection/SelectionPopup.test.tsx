// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionPopup } from './SelectionPopup';

describe('SelectionPopup', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    container?.remove();
    container = undefined;
    dispose = undefined;
  });

  function mount(props: Parameters<typeof SelectionPopup>[0]) {
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(() => SelectionPopup(props), container);
    return container;
  }

  const base = {
    buttonVisible: false,
    buttonTop: 0,
    buttonLeft: 0,
    onTranslateClick: () => {},
    panelOpen: false,
    busy: false,
    translatedText: '',
    errorMessage: null,
    onCloseClick: () => {},
  };

  it('renders nothing when the button is not visible and the panel is closed', () => {
    const el = mount(base);
    expect(el.querySelector('.trigger')).toBeNull();
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('shows the trigger button when a selection is active', () => {
    const el = mount({ ...base, buttonVisible: true, buttonTop: 20, buttonLeft: 30 });
    const trigger = el.querySelector('.trigger') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.style.top).toBe('20px');
    expect(trigger.style.left).toBe('30px');
  });

  it('invokes onTranslateClick when the trigger is clicked', () => {
    const onTranslateClick = vi.fn();
    const el = mount({ ...base, buttonVisible: true, onTranslateClick });
    (el.querySelector('.trigger') as HTMLButtonElement).click();
    expect(onTranslateClick).toHaveBeenCalledTimes(1);
  });

  it('shows a busy status while translating', () => {
    const el = mount({ ...base, panelOpen: true, busy: true });
    expect(el.querySelector('.status')?.textContent).toBe('Translating…');
    expect(el.querySelector('.result')).toBeNull();
  });

  it('shows the translated text once available', () => {
    const el = mount({ ...base, panelOpen: true, busy: false, translatedText: 'Hola mundo' });
    expect(el.querySelector('.result')?.textContent).toBe('Hola mundo');
  });

  it('shows an error message when translation failed', () => {
    const el = mount({ ...base, panelOpen: true, busy: false, errorMessage: 'network error' });
    expect(el.querySelector('.errorText')?.textContent).toBe('network error');
    expect(el.querySelector('.result')).toBeNull();
  });

  it('invokes onCloseClick when the close button is clicked', () => {
    const onCloseClick = vi.fn();
    const el = mount({ ...base, panelOpen: true, translatedText: 'x', onCloseClick });
    (el.querySelector('.close') as HTMLButtonElement).click();
    expect(onCloseClick).toHaveBeenCalledTimes(1);
  });

  it('hides the trigger while the panel is open', () => {
    const el = mount({ ...base, buttonVisible: true, panelOpen: true, translatedText: 'x' });
    expect(el.querySelector('.trigger')).toBeNull();
  });
});
