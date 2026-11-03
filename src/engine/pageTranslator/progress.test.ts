// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../shared/result';
import type { PieceOutcome, Translator } from '../translator';
import { createProgress } from './progress';
import { createPageTranslator } from './translateLoop';

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createProgress', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function textNodes(...texts: string[]): Text[] {
    return texts.map((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      document.body.append(p);
      return p.firstChild as Text;
    });
  }

  it('counts each node once into the total and once into done, in one notification per drain', async () => {
    const seen: Array<[number, number]> = [];
    const progress = createProgress((done, total) => seen.push([done, total]));
    const [a, b] = textNodes('alpha', 'beta') as [Text, Text];
    progress.track(a);
    progress.track(a);
    progress.track(b);
    progress.translated(a, 5);
    progress.translated(a, 5);
    await Promise.resolve();
    expect(seen).toEqual([[1, 2]]);
  });

  it('a node written without being tracked first still counts into the total, so done never passes it', async () => {
    const seen: Array<[number, number]> = [];
    const progress = createProgress((done, total) => seen.push([done, total]));
    const [a] = textNodes('alpha') as [Text];
    progress.translated(a, 5);
    await Promise.resolve();
    expect(seen.at(-1)).toEqual([1, 1]);
  });

  it('reset starts a new cycle at 0 of 0', async () => {
    const seen: Array<[number, number]> = [];
    const progress = createProgress((done, total) => seen.push([done, total]));
    const [a] = textNodes('alpha') as [Text];
    progress.translated(a, 5);
    progress.reset();
    await Promise.resolve();
    expect(seen.at(-1)).toEqual([0, 0]);
    progress.translated(a, 5);
    await Promise.resolve();
    expect(seen.at(-1)).toEqual([1, 1]);
  });

  it('warns from the given-up nodes still on the page, measured against the translated characters', () => {
    const progress = createProgress(() => {});
    const [done, stuck, gone] = textNodes('x'.repeat(300), 'y'.repeat(300), 'z'.repeat(300)) as [Text, Text, Text];
    progress.translated(done, 300);
    progress.gaveUp(stuck);
    progress.gaveUp(gone);
    gone.parentElement?.remove();
    expect(progress.untranslatedWarning()).toMatch(/^About 50% /);
    // A given-up node that later translates no longer counts as untranslated.
    progress.translated(stuck, 300);
    expect(progress.untranslatedWarning()).toBeNull();
  });
});

describe('progress on a page that loads more text after the translate starts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('counts text found later into the total, so the bar stays below 1 while that text is still translating', async () => {
    document.body.innerHTML = '<p>one</p><p>two</p>';
    let release: (() => void) | undefined;
    let calls = 0;
    const translator: Translator = {
      async translateBatch(request) {
        calls++;
        if (calls > 1) await new Promise<void>((resolve) => (release = resolve));
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    const seen: Array<[number, number]> = [];
    pageTranslator.onProgressChange((done, total) => seen.push([done, total]));

    try {
      await pageTranslator.translatePage('es');
      await waitFor(() => document.body.textContent === 'ONETWO');

      // The site loads the next chapter's text into the page.
      const chapter = document.createElement('div');
      chapter.innerHTML = '<p>three</p><p>four</p><p>five</p>';
      document.body.append(chapter);
      await waitFor(() => release !== undefined);
      await Promise.resolve();

      expect(pageTranslator.isWorking()).toBe(true);
      expect(seen.at(-1)).toEqual([2, 5]);

      release?.();
      await waitFor(() => document.body.textContent === 'ONETWOTHREEFOURFIVE');
      await Promise.resolve();
      await Promise.resolve();

      expect(seen.every(([done, total]) => done <= total)).toBe(true);
      expect(seen.at(-1)).toEqual([5, 5]);
    } finally {
      pageTranslator.restorePage();
    }
  });
});
