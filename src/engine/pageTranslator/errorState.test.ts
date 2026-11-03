import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  batchFailed,
  batchSucceeded,
  type ErrorState,
  INITIAL_ERROR_STATE,
  OFFLINE_MESSAGE,
  shownError,
  toUserFacingErrorMessage,
  untranslatedShareWarning,
  wentOffline,
  withWarning,
} from './errorState';

function failTimes(n: number, state: ErrorState = INITIAL_ERROR_STATE, message = 'HTTP 500'): ErrorState {
  let s = state;
  for (let i = 0; i < n; i++) s = batchFailed(s, message);
  return s;
}

describe('errorState', () => {
  it('starts clean: nothing shown, no backoff', () => {
    expect(shownError(INITIAL_ERROR_STATE)).toBeNull();
    expect(backoffDelay(INITIAL_ERROR_STATE)).toBeNull();
  });

  it('tolerates two failed batches, surfaces the third as a provider error', () => {
    expect(shownError(failTimes(2))).toBeNull();
    expect(shownError(failTimes(3))).toEqual({ message: 'HTTP 500', kind: 'provider' });
    expect(failTimes(3).surfacedStreak).toBe(1);
    expect(failTimes(5).surfacedStreak).toBe(3);
  });

  it('shows the latest surfaced message in plain language', () => {
    const s = batchFailed(failTimes(3), 'rejected (HTTP 403): API key not valid');
    expect(shownError(s)?.message).toBe('The translation service rejected the request: API key not valid');
  });

  it('reports offline at once, and counts it toward the backoff', () => {
    const s = wentOffline(INITIAL_ERROR_STATE);
    expect(shownError(s)).toEqual({ message: OFFLINE_MESSAGE, kind: 'offline' });
    expect(wentOffline(s).surfacedStreak).toBe(2);
  });

  it('spaces failures 1s, 2s, 4s before surfacing, then 8s growing by 1.5x up to 30s', () => {
    expect([1, 2].map((n) => backoffDelay(failTimes(n)))).toEqual([1000, 2000]);
    expect([3, 4, 5, 6, 7, 8].map((n) => backoffDelay(failTimes(n)))).toEqual([
      8000, 12000, 18000, 27000, 30000, 30000,
    ]);
  });

  it('a clean batch clears the counters and the real error, and shows the warning it is given', () => {
    const s = batchSucceeded('most of it came back untranslated');
    expect(s.failures).toBe(0);
    expect(s.surfacedStreak).toBe(0);
    expect(backoffDelay(s)).toBeNull();
    expect(shownError(s)).toEqual({ message: 'most of it came back untranslated', kind: 'provider' });
  });

  it('a real error outranks the untranslated warning, which shows again once the error clears', () => {
    const warned = withWarning(INITIAL_ERROR_STATE, 'warning');
    expect(shownError(warned)?.message).toBe('warning');
    // The warning is a report, not an outage: no backoff.
    expect(backoffDelay(warned)).toBeNull();
    const failing = failTimes(3, warned);
    expect(shownError(failing)?.message).toBe('HTTP 500');
    expect(shownError(batchSucceeded(failing.warning))?.message).toBe('warning');
  });

  it('withWarning keeps the same state object when nothing changed', () => {
    const warned = withWarning(INITIAL_ERROR_STATE, 'w');
    expect(withWarning(warned, 'w')).toBe(warned);
    expect(withWarning(INITIAL_ERROR_STATE, null)).toBe(INITIAL_ERROR_STATE);
  });

  describe('untranslatedShareWarning', () => {
    it('warns when given-up text is a large share and at least 200 characters', () => {
      expect(untranslatedShareWarning(300, 300)).toMatch(/^About 50% of this page came back untranslated/);
    });

    it('stays quiet for a small share or a small amount', () => {
      expect(untranslatedShareWarning(250, 1000)).toBeNull();
      expect(untranslatedShareWarning(199, 0)).toBeNull();
      expect(untranslatedShareWarning(0, 0)).toBeNull();
    });
  });

  describe('toUserFacingErrorMessage', () => {
    it('maps the known raw messages and passes others through', () => {
      expect(toUserFacingErrorMessage('Google kept sending text back untranslated')).toMatch(
        /keeps sending text back untranslated/,
      );
      expect(toUserFacingErrorMessage('no result for this piece')).toBe(
        "Couldn't reach the translation service — retrying automatically.",
      );
      expect(toUserFacingErrorMessage('rejected (HTTP 401)')).toBe(
        'The translation service rejected the request (HTTP 401).',
      );
      expect(toUserFacingErrorMessage('socket hang up')).toBe('socket hang up');
    });
  });
});
