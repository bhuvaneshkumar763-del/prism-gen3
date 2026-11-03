// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoogleFake, type GoogleFakeOptions, type GoogleRecording } from '../testing/googleFake';
import { createPageTranslator } from './translateLoop';

// The real write-back path (boundary text, early writes) against a fake that
// answers the way Google does, not an idealised translator.

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function translateBody(html: string, sourceLanguage: string, fakeOptions: GoogleFakeOptions): Promise<string[]> {
  document.body.innerHTML = html;
  const fake = createGoogleFake(fakeOptions);
  const pageTranslator = createPageTranslator({
    translator: fake,
    getSourceLanguage: () => sourceLanguage,
    getBatchingHint: () => undefined,
  });
  const nodeCount = document.body.querySelectorAll('p, span, button').length;
  await pageTranslator.translatePage('en');
  await waitFor(() => fake.answers.length >= nodeCount && pageTranslator.getState() === 'translated');
  const texts = [...document.body.querySelectorAll('p, span, button')].map((el) => el.textContent ?? '');
  // A translator left running would also translate the next test's page.
  pageTranslator.restorePage();
  return texts;
}

describe('write-back with the realistic Google fake', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes a full-width bracketed line once in ASCII brackets, never doubled', async () => {
    const texts = await translateBody('<p>（本章完）</p><p>【第一章】</p>', 'zh', {
      dictionary: { 本章完: 'End of this chapter', 第一章: 'Chapter 1' },
    });
    expect(texts).toEqual(['(End of this chapter)', '[Chapter 1]']);
  });

  it('keeps one leading ". " whether Google drops it or echoes it', async () => {
    const texts = await translateBody('<p>. el programa</p><p>. la escuela</p>', 'es', {
      dropLeadingPeriod: 'alternate',
    });
    expect(texts).toEqual(['. EL PROGRAMA', '. LA ESCUELA']);
  });

  it('writes recorded sangtacviet answers and leaves a recorded legitimate echo as it was', async () => {
    const recording = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/replay/pages/sangtacviet-search/google.json'), 'utf8'),
    ) as GoogleRecording;
    const texts = await translateBody('<span>Nút tìm kiếm</span><button>Kỳ Môn Bí Thuật(359)</button>', 'vi', {
      recordings: recording,
    });
    expect(texts).toEqual(['Search button', 'Kỳ Môn Bí Thuật(359)']);
  });

  it('re-asks with the page language for a short line Google echoed under auto, and writes the translation', async () => {
    const line = 'Ngươi muốn chết sao?';
    const texts = await translateBody(`<p>${line}</p>`, 'vi', {
      echo: (text, source) => (source === 'auto' && text === line ? 'vi' : null),
      dictionary: { [line]: 'Do you want to die?' },
    });
    expect(texts).toEqual(['Do you want to die?']);
  });
});
