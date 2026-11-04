// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionPopup } from './SelectionPopup';
import { SELECTION_POPUP_STYLES } from './selectionPopupStyles';

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
    panel: { left: 10, top: 40, bottom: null, maxWidth: 280, maxHeight: 400 },
    busy: false,
    translatedText: '',
    errorMessage: null,
    onCloseClick: () => {},
    onCopyClick: () => {},
    copyStatus: 'idle' as const,
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

  it('reads an error out once: its alert is not inside the status region', () => {
    const el = mount({ ...base, panelOpen: true, errorMessage: 'The service is slow' });
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('The service is slow');
    expect(el.querySelector('[role="status"] [role="alert"]')).toBeNull();
  });

  it('keeps the status region to the message, without the buttons', () => {
    const el = mount({ ...base, panelOpen: true, translatedText: 'Hola' });
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Hola');
    expect(el.querySelector('[role="status"] button')).toBeNull();
  });

  it('lets a right-to-left result read right to left', () => {
    const el = mount({ ...base, panelOpen: true, translatedText: 'مرحبا بالعالم' });
    expect(el.querySelector('.result')?.getAttribute('dir')).toBe('auto');
  });

  describe('styles', () => {
    /** The declarations of the first rule for `selector`, within `css`. */
    function rule(selector: string, css = SELECTION_POPUP_STYLES): string {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
      return css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    }
    const coarse = () => SELECTION_POPUP_STYLES.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';

    it('keeps the paragraphs of a result apart', () => {
      expect(rule('.result')).toContain('white-space: pre-wrap');
    });

    it('gives the translate button a touch area of at least 44px', () => {
      const hitArea = rule('.trigger::before');
      expect(hitArea).toContain('width: 44px');
      expect(hitArea).toContain('height: 44px');
    });

    it('makes Close and Copy at least 44px tall on a touch screen', () => {
      expect(rule('.close', coarse())).toContain('width: 44px');
      expect(rule('.close', coarse())).toContain('height: 44px');
      expect(rule('.copy', coarse())).toContain('min-height: 44px');
    });
  });
});
