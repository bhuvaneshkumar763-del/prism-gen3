import { describe, expect, it } from 'vitest';
import type { TranslateError } from '../translator';
import {
  backoffDelay,
  batchFailed,
  batchSucceeded,
  describeTranslateError,
  type ErrorState,
  INITIAL_ERROR_STATE,
  OFFLINE_MESSAGE,
  shownError,
  untranslatedShareWarning,
  wentOffline,
  withWarning,
} from './errorState';

const SERVER_ERROR: TranslateError = { kind: 'http', status: 500, message: '[svc] server error (HTTP 500)' };
const SERVER_ERROR_SHOWN = "Google's translation service is having trouble (HTTP 500) — retrying automatically.";

function failTimes(n: number, state: ErrorState = INITIAL_ERROR_STATE): ErrorState {
  let s = state;
  for (let i = 0; i < n; i++) s = batchFailed(s, SERVER_ERROR);
  return s;
}

describe('errorState', () => {
  it('starts clean: nothing shown, no backoff', () => {
    expect(shownError(INITIAL_ERROR_STATE)).toBeNull();
    expect(backoffDelay(INITIAL_ERROR_STATE)).toBeNull();
  });

  it('tolerates two failed batches, surfaces the third as a provider error', () => {
    expect(shownError(failTimes(2))).toBeNull();
    expect(shownError(failTimes(3))).toEqual({ message: SERVER_ERROR_SHOWN, kind: 'provider' });
    expect(failTimes(3).surfacedStreak).toBe(1);
    expect(failTimes(5).surfacedStreak).toBe(3);
  });

  it('shows the latest surfaced message in plain language', () => {
    const s = batchFailed(failTimes(3), {
      kind: 'http',
      status: 403,
      reason: 'API key not valid',
      message: '[svc] rejected (HTTP 403): API key not valid',
    });
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
    expect(shownError(failing)?.message).toBe(SERVER_ERROR_SHOWN);
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
});

describe('describeTranslateError — what the bubble says for each kind of failure', () => {
  it('says Google is rate-limiting, not that it could not be reached, for an exhausted 429', () => {
    expect(
      describeTranslateError({ kind: 'rateLimited', status: 429, message: '[google] rate-limited (HTTP 429)' }),
    ).toBe('Google is limiting requests right now; Prism will retry automatically.');
  });

  it('says Google changed its answers for a response Prism cannot read', () => {
    expect(describeTranslateError({ kind: 'badResponse', message: '[google] response is not valid JSON' })).toBe(
      "Google changed how its translation service answers, so Prism can't read the replies. Switch to Google Cloud in Settings until Prism is updated.",
    );
  });

  it('says the service is too slow for a timeout', () => {
    expect(describeTranslateError({ kind: 'timeout', message: '[google] timed out' })).toBe(
      'The translation service is taking too long to answer — retrying automatically.',
    );
  });

  it('keeps "couldn\'t reach" for a real network failure only', () => {
    expect(describeTranslateError({ kind: 'network', message: '[google] network error: Failed to fetch' })).toBe(
      "Couldn't reach the translation service — retrying automatically.",
    );
  });

  it('names the status of a server error', () => {
    expect(describeTranslateError({ kind: 'http', status: 503, message: '[google] server error (HTTP 503)' })).toBe(
      "Google's translation service is having trouble (HTTP 503) — retrying automatically.",
    );
  });

  it('says the service rejected the request, with its reason or its status', () => {
    expect(describeTranslateError({ kind: 'http', status: 400, reason: 'Bad thing', message: 'x' })).toBe(
      'The translation service rejected the request: Bad thing',
    );
    expect(describeTranslateError({ kind: 'http', status: 403, message: 'x' })).toBe(
      'The translation service rejected the request (HTTP 403).',
    );
    expect(describeTranslateError({ kind: 'http', message: 'x' })).toBe(
      'The translation service answered with an error — retrying automatically.',
    );
  });

  it('points to Google Cloud when the free key is rejected', () => {
    expect(describeTranslateError({ kind: 'auth', status: 400, reason: 'API key not valid.', message: 'x' })).toBe(
      "Google's free translation key isn't working (HTTP 400: API key not valid). Prism keeps retrying with a new key. To translate now, switch to Google Cloud in Settings and add your own API key.",
    );
    expect(describeTranslateError({ kind: 'auth', message: 'x' })).toBe(
      "Google's free translation key isn't working. Prism keeps retrying with a new key. To translate now, switch to Google Cloud in Settings and add your own API key.",
    );
  });

  it('says the text keeps coming back untranslated for a run of echoes', () => {
    const expected =
      'The translation service keeps sending text back untranslated. Prism keeps retrying; if it keeps happening, switch provider in Settings.';
    expect(describeTranslateError({ kind: 'untranslated', message: 'x' })).toBe(expected);
    expect(describeTranslateError({ kind: 'suspicious', message: 'x' })).toBe(expected);
  });

  it('says the chosen service needs setting up', () => {
    expect(describeTranslateError({ kind: 'notConfigured', message: 'x' })).toBe(
      "The chosen translation service isn't set up yet. Add its API key in Settings, or switch to Google (free).",
    );
  });

  it('is what batchFailed surfaces', () => {
    let s = INITIAL_ERROR_STATE;
    for (let i = 0; i < 3; i++) s = batchFailed(s, { kind: 'rateLimited', status: 429, message: 'x' });
    expect(shownError(s)).toEqual({
      message: 'Google is limiting requests right now; Prism will retry automatically.',
      kind: 'provider',
    });
  });
});
