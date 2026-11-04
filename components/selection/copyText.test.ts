// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the async clipboard API where it exists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await expect(copyText('Buenos días')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Buenos días');
  });

  it("falls back to the copy command on a plain-http page, where navigator.clipboard doesn't exist at all", async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });

    await expect(copyText('Buenos días')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // The temporary field it copies from must not be left behind in the page.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back too when the clipboard API refuses (e.g. permission denied)', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true });

    await expect(copyText('x')).resolves.toBe(true);
  });

  it('reports failure honestly when neither route works, rather than claiming "Copied"', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });

    await expect(copyText('x')).resolves.toBe(false);
  });

  describe('the copy-command fallback', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    function copyCommandThatFiresCopy() {
      // What a browser does for execCommand('copy'): a `copy` event from the focused field.
      return vi.fn(() => {
        const event = new Event('copy', { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
        (document.activeElement ?? document.body).dispatchEvent(event);
        return true;
      });
    }

    it("keeps the page's own copy handlers from seeing or rewriting the copy", async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      Object.defineProperty(document, 'execCommand', { value: copyCommandThatFiresCopy(), configurable: true });
      const pageCopy = vi.fn();
      document.addEventListener('copy', pageCopy);

      await expect(copyText('Buenos días')).resolves.toBe(true);

      document.removeEventListener('copy', pageCopy);
      expect(pageCopy).not.toHaveBeenCalled();
    });

    it("puts the page's own text selection back afterwards", async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      Object.defineProperty(document, 'execCommand', { value: copyCommandThatFiresCopy(), configurable: true });
      document.body.innerHTML = '<p id="picked">Hola mundo</p>';
      const selection = window.getSelection() as Selection;
      selection.selectAllChildren(document.getElementById('picked') as HTMLElement);
      const removeAllRanges = vi.spyOn(selection, 'removeAllRanges');
      const addRange = vi.spyOn(selection, 'addRange');

      await copyText('Hello world');

      // Put back after the field's select() replaced it.
      expect(removeAllRanges).toHaveBeenCalled();
      expect(addRange.mock.calls.at(-1)?.[0].toString()).toBe('Hola mundo');
    });

    it('reports failure instead of throwing on a page with no body', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true });
      Object.defineProperty(document, 'body', { get: () => null, configurable: true });
      try {
        await expect(copyText('x')).resolves.toBeTypeOf('boolean');
      } finally {
        delete (document as { body?: unknown }).body;
      }
    });
  });
});
