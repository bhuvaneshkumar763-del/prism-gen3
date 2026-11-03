import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { unescapeHTML } from '../providers/htmlEscape';
import { createGoogleFake, type GoogleRecording } from './googleFake';

function loadRecording(page: string): GoogleRecording {
  const url = new URL(`../../../tests/replay/pages/${page}/google.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as GoogleRecording;
}

const sangtacviet = loadRecording('sangtacviet-search');
const pixiv = loadRecording('pixiv-novel');
const wikipedia = loadRecording('wikipedia-es-faq');

function translate(fake: ReturnType<typeof createGoogleFake>, pieces: string[][], sourceLanguage = 'vi') {
  return fake.translateBatch({ sourceLanguage, targetLanguage: 'en', pieces });
}

describe('createGoogleFake: recordings', () => {
  it('answers a single item from a real recording, sending auto like google.ts', async () => {
    const fake = createGoogleFake({ recordings: sangtacviet });
    expect(await translate(fake, [['Nút tìm kiếm']])).toEqual([{ ok: true, value: ['Search button'] }]);
    expect(fake.answers[0]).toMatchObject({ sourceLanguage: 'auto', detectedLanguage: 'vi' });
  });

  it("keeps a recorded legitimate echo, with Google's detected language", async () => {
    const fake = createGoogleFake({ recordings: [sangtacviet, pixiv] });
    const outcomes = await translate(fake, [['Kỳ Môn Bí Thuật(359)'], ['iPad drawing app Pastela']]);
    expect(outcomes).toEqual([
      { ok: true, value: ['Kỳ Môn Bí Thuật(359)'] },
      { ok: true, value: ['iPad drawing app Pastela'] },
    ]);
    expect(fake.answers.map((a) => a.detectedLanguage)).toEqual(['vi', 'tl']);
  });

  it('looks a grouped piece up item by item when the group itself was never recorded', async () => {
    const fake = createGoogleFake({ recordings: sangtacviet });
    expect(await translate(fake, [['Nút tìm kiếm', 'Nút tải lại']])).toEqual([
      { ok: true, value: ['Search button', 'Reload button'] },
    ]);
  });

  it('answers every recorded single-item piece of all three pages with the recorded text', async () => {
    for (const recording of [sangtacviet, pixiv, wikipedia]) {
      for (const [key, answers] of Object.entries(recording)) {
        const [, target, wire] = JSON.parse(key) as [string, string, string];
        const single = wire.match(/^<pre><a i=0>([^<]*)<\/a><a i=1> <\/a><\/pre>$/);
        const [recordedWire] = answers[0] ?? [''];
        const recordedText = recordedWire.match(/^<pre><a i=0>([^<]*)<\/a>/);
        if (!single?.[1] || !recordedText?.[1] || answers.length > 1) continue;
        const source = unescapeHTML(single[1]);
        const fake = createGoogleFake({ recordings: recording, sanityCheck: false });
        const [outcome] = await fake.translateBatch({
          sourceLanguage: 'en',
          targetLanguage: target,
          pieces: [[source]],
        });
        expect(outcome).toEqual({ ok: true, value: [unescapeHTML(recordedText[1])] });
      }
    }
  });

  it('serves repeated requests with later recorded answers, then the last one again', async () => {
    const key = JSON.stringify(['auto', 'en', '<pre><a i=0>uno</a><a i=1> </a></pre>']);
    const recording: GoogleRecording = {
      [key]: [
        ['<pre><a i=0>one</a><a i=1> </a></pre>', 'es'],
        ['<pre><a i=0>One</a><a i=1> </a></pre>', 'es'],
      ],
    };
    const fake = createGoogleFake({ recordings: recording });
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await translate(fake, [['uno']], 'es'));
    expect(results.map((r) => (r[0]?.ok ? r[0].value[0] : null))).toEqual(['one', 'One', 'One']);
  });

  it('decodes a recorded grouped answer by marker index, joining a repeated index', async () => {
    const key = JSON.stringify(['auto', 'en', '<pre><a i=0>a</a><a i=1>b</a></pre>']);
    const recording: GoogleRecording = { [key]: [['<pre><a i=0>A</a><a i=0>more</a><a i=1>B</a></pre>', 'es']] };
    const fake = createGoogleFake({ recordings: recording, repairReflow: false });
    expect(await translate(fake, [['a', 'b']], 'es')).toEqual([{ ok: true, value: ['A more', 'B'] }]);
  });

  it('uses an explicit source on the wire, so an auto recording does not match it', async () => {
    const fake = createGoogleFake({ recordings: sangtacviet });
    const outcomes = await fake.translateBatch({
      sourceLanguage: 'vi',
      sourceLanguageIsExplicit: true,
      targetLanguage: 'en',
      pieces: [['Nút tìm kiếm']],
    });
    expect(outcomes).toEqual([{ ok: true, value: ['NÚT TÌM KIẾM'] }]);
    expect(fake.answers[0]?.sourceLanguage).toBe('vi');
  });
});

describe("createGoogleFake: Google's quirks", () => {
  it('writes full-width brackets and CJK sentence marks as ASCII', async () => {
    const fake = createGoogleFake({ dictionary: { 本章完: 'End of this chapter' } });
    expect(await translate(fake, [['（本章完）'], ['【第一章】'], ['好。']], 'zh')).toEqual([
      { ok: true, value: ['(End of this chapter)'] },
      { ok: true, value: ['[⟨第一章⟩]'] },
      { ok: true, value: ['⟨好⟩.'] },
    ]);
  });

  it('keeps full-width marks when that quirk is turned off', async () => {
    const fake = createGoogleFake({ asciiPunctuation: false });
    expect(await translate(fake, [['（本章完）']], 'zh')).toEqual([{ ok: true, value: ['（⟨本章完⟩）'] }]);
  });

  it('drops a leading ". " on every other item by default', async () => {
    const fake = createGoogleFake();
    expect(await translate(fake, [['. uno'], ['. dos'], ['. tres']], 'es')).toEqual([
      { ok: true, value: ['UNO'] },
      { ok: true, value: ['. DOS'] },
      { ok: true, value: ['TRES'] },
    ]);
  });

  it('drops a leading ". " always or never when asked', async () => {
    expect(await translate(createGoogleFake({ dropLeadingPeriod: 'always' }), [['. a'], ['. b']], 'es')).toEqual([
      { ok: true, value: ['A'] },
      { ok: true, value: ['B'] },
    ]);
    expect(await translate(createGoogleFake({ dropLeadingPeriod: 'never' }), [['. a']], 'es')).toEqual([
      { ok: true, value: ['. A'] },
    ]);
  });

  it('trims the whitespace around a translated item, as Google does', async () => {
    expect(await translate(createGoogleFake(), [['  hola  ']], 'es')).toEqual([{ ok: true, value: ['HOLA'] }]);
  });

  it('uses a whole-item dictionary entry before translating word by word', async () => {
    const fake = createGoogleFake({ dictionary: { 'Ngươi là ai?': 'Who are you?' } });
    expect(await translate(fake, [['Ngươi là ai?']])).toEqual([{ ok: true, value: ['Who are you?'] }]);
  });

  it('echoes an item back unchanged with the language it reports', async () => {
    const fake = createGoogleFake({ echo: { 'Wikipedia ': 'en' } });
    expect(await translate(fake, [['Wikipedia ']], 'es')).toEqual([{ ok: true, value: ['Wikipedia '] }]);
    expect(fake.answers[0]?.detectedLanguage).toBe('en');
  });

  it('runs the real sanity check: a long echo in the wrong language fails as suspicious after one retry', async () => {
    const line = 'Đây là một câu tiếng Việt khá dài mà Google đã gửi lại nguyên văn.';
    const echo = vi.fn((text: string, _source: string) => (text === line ? 'vi' : null));
    const fake = createGoogleFake({ echo });
    const [outcome] = await translate(fake, [[line]]);
    expect(outcome).toEqual({ ok: false, error: { kind: 'suspicious', message: expect.any(String) } });
    expect(echo.mock.calls.map(([, source]) => source)).toEqual(['auto', 'vi']);
  });

  it('returns the retry translation when the echo only happens under auto', async () => {
    const line = 'Đây là một câu tiếng Việt khá dài mà Google đã gửi lại nguyên văn.';
    const fake = createGoogleFake({
      echo: (text, source) => (source === 'auto' && text === line ? 'vi' : null),
      dictionary: { [line]: 'This is a long Vietnamese sentence.' },
    });
    expect(await translate(fake, [[line]])).toEqual([{ ok: true, value: ['This is a long Vietnamese sentence.'] }]);
    expect(fake.answers[0]?.sourceLanguage).toBe('vi');
  });

  it('passes an echo straight through when the sanity check is off', async () => {
    const line = 'Đây là một câu tiếng Việt khá dài mà Google đã gửi lại nguyên văn.';
    const fake = createGoogleFake({ echo: { [line]: 'vi' }, sanityCheck: false });
    expect(await translate(fake, [[line]])).toEqual([{ ok: true, value: [line] }]);
  });

  it('reflows a grouped piece across its markers; a words-only reflow gets past the provider check', async () => {
    const fake = createGoogleFake({ reflow: true });
    expect(await translate(fake, [['uno dos', 'tres']], 'es')).toEqual([{ ok: true, value: ['UNO', 'DOS TRES'] }]);
  });

  it('repairs a reflow the provider can see (a number moved to the next item) item by item', async () => {
    const fake = createGoogleFake({ reflow: (piece) => piece.length === 2 });
    expect(await translate(fake, [['Hệ Thống (192673)', 'Huyền Huyễn (189348)']])).toEqual([
      { ok: true, value: ['HỆ THỐNG (192673)', 'HUYỀN HUYỄN (189348)'] },
    ]);
  });

  it('leaves a visible reflow in place when repair is off', async () => {
    const fake = createGoogleFake({ reflow: true, repairReflow: false });
    expect(await translate(fake, [['Hệ (192673)', 'Huyền (189348)']])).toEqual([
      { ok: true, value: ['HỆ', '(192673) HUYỀN (189348)'] },
    ]);
  });

  it('never reflows a single-item piece', async () => {
    expect(await translate(createGoogleFake({ reflow: true }), [['uno dos']], 'es')).toEqual([
      { ok: true, value: ['UNO DOS'] },
    ]);
  });

  it('reports each piece through onPieceComplete and keeps every request', async () => {
    const fake = createGoogleFake();
    const onPieceComplete = vi.fn();
    await fake.translateBatch({ sourceLanguage: 'es', targetLanguage: 'en', pieces: [['a'], ['b']], onPieceComplete });
    expect(onPieceComplete.mock.calls).toEqual([
      [0, { ok: true, value: ['A'] }],
      [1, { ok: true, value: ['B'] }],
    ]);
    expect(fake.requests).toHaveLength(1);
  });

  it('reports the declared source as the detected language of a translated item unless told otherwise', async () => {
    const fake = createGoogleFake();
    await translate(fake, [['a']], 'es');
    const other = createGoogleFake({ detectedLanguage: 'pt' });
    await translate(other, [['a']], 'es');
    expect([fake.answers[0]?.detectedLanguage, other.answers[0]?.detectedLanguage]).toEqual(['es', 'pt']);
  });
});
