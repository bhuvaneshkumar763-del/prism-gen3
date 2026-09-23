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
});
