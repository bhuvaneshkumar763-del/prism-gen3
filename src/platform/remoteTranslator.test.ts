import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok } from '../shared/result';
import { onMessage } from './messaging/protocol';
import { createRemoteTranslator } from './remoteTranslator';

describe('createRemoteTranslator', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    // @webext-core/messaging only allows one listener per message type per
    // JS context — the module-level messenger instance persists across
    // tests in this file, so each test's onMessage() registration must be
    // torn down or the next one throws "only one listener can be setup".
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it('sends a translatePieces message and returns the response as-is', async () => {
    let received: unknown;
    unsubscribe = onMessage('translatePieces', (message) => {
      received = message.data;
      return [ok(['hola'])];
    });

    const translator = createRemoteTranslator();
    const result = await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(result).toEqual([{ ok: true, value: ['hola'] }]);
    expect(received).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });
  });

  it('forwards dontSortResults through to the message', async () => {
    let received: unknown;
    unsubscribe = onMessage('translatePieces', (message) => {
      received = message.data;
      return [];
    });

    const translator = createRemoteTranslator();
    await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [],
      dontSortResults: true,
    });

    expect(received).toMatchObject({ dontSortResults: true });
  });
});
