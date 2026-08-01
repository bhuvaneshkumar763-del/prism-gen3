import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { ok } from '../shared/result';
import { createRemoteTranslator, isTranslatePiecesMessage } from './remoteTranslator';

describe('createRemoteTranslator', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('sends a translatePieces message and returns the response as-is', async () => {
    let received: unknown;
    // fake-browser mimics the classic sendResponse+`return true` async
    // messaging pattern (same as entrypoints/background.ts's real
    // listener), not a directly-returned Promise — see runtime.sendMessage
    // in @webext-core/fake-browser: it only awaits the response if a
    // listener's return value is literally `true`.
    fakeBrowser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isTranslatePiecesMessage(message)) return undefined;
      received = message;
      sendResponse([ok(['hola'])]);
      return true;
    });

    const translator = createRemoteTranslator();
    const result = await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(result).toEqual([{ ok: true, value: ['hola'] }]);
    expect(received).toMatchObject({
      type: 'translatePieces',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });
  });

  it('forwards dontSortResults through to the message', async () => {
    let received: unknown;
    fakeBrowser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      received = message;
      sendResponse([]);
      return true;
    });

    const translator = createRemoteTranslator();
    await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [],
      dontSortResults: true,
    });

    expect(received).toMatchObject({ type: 'translatePieces', dontSortResults: true });
  });
});

describe('isTranslatePiecesMessage', () => {
  it('is true only for a translatePieces-typed object', () => {
    expect(isTranslatePiecesMessage({ type: 'translatePieces' })).toBe(true);
    expect(isTranslatePiecesMessage({ type: 'somethingElse' })).toBe(false);
    expect(isTranslatePiecesMessage(null)).toBe(false);
    expect(isTranslatePiecesMessage('translatePieces')).toBe(false);
  });
});
