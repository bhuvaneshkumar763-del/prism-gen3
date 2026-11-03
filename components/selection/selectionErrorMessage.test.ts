import { describe, expect, it } from 'vitest';
import type { TranslateError, TranslateErrorKind } from '../../src/engine/translator';
import { TimeoutError } from '../../src/shared/withTimeout';
import { describeSelectionError, describeSelectionRejection } from './selectionErrorMessage';

const KINDS: TranslateErrorKind[] = [
  'network',
  'timeout',
  'rateLimited',
  'http',
  'auth',
  'badResponse',
  'suspicious',
  'untranslated',
  'notConfigured',
];

describe('describeSelectionError', () => {
  it.each(KINDS)("%s: plain words, never the provider's raw diagnostic, never an automatic-retry promise", (kind) => {
    for (const status of [undefined, 429, 503]) {
      const error: TranslateError = { kind, status, message: '[google] raw diagnostic' };
      const message = describeSelectionError(error);
      expect(message).not.toContain('[google]');
      expect(message).not.toMatch(/retr(y|ying) automatically|keeps retrying;/i);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});

describe('describeSelectionRejection', () => {
  it('says the service is slow for a timeout', () => {
    expect(describeSelectionRejection(new TimeoutError('timed out after 90000ms'))).toBe(
      'The translation service is taking too long to answer.',
    );
  });

  it('says to reload the page when the background could not be reached', () => {
    const message = describeSelectionRejection(new Error('Extension context invalidated.'));
    expect(message).toMatch(/reload the page/i);
    expect(message).not.toMatch(/invalidated/);
  });
});
