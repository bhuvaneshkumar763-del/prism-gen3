import type { TranslateError } from '../translator';

/**
 * The translate loop's error state as one value with pure transitions, so
 * "what does the bubble show" and "how long until the next try" are functions
 * of it rather than of several variables kept in step by hand.
 */

/** `'offline'`: the browser itself has no connectivity. `'provider'`: a broken or misconfigured provider while online. */
export type ErrorKind = 'offline' | 'provider' | null;

export interface ShownError {
  message: string;
  kind: Exclude<ErrorKind, null>;
}

export interface ErrorState {
  /** Failed batches in a row; a tick with no genuine failure resets it. */
  readonly failures: number;
  /** Ticks in a row that surfaced an error; sets the backoff length. Keeps growing while offline. */
  readonly surfacedStreak: number;
  /** A real error (outage, rejection, offline). Outranks `warning` and stops the spinner. */
  readonly error: ShownError | null;
  /** The untranslated-share report: shown only while there's no real error, with no backoff. */
  readonly warning: string | null;
}

/** A few failures in a row are tolerated before an error surfaces. */
export const CONSECUTIVE_FAILURES_BEFORE_SURFACING = 3;

export const OFFLINE_MESSAGE = 'Offline — translation will resume automatically once your connection is back.';

/** Warn when given-up text is at least this share of the page's characters, and at least this many. */
const UNTRANSLATED_SHARE_TO_WARN = 0.25;
const MIN_UNTRANSLATED_CHARS_TO_WARN = 200;

export const INITIAL_ERROR_STATE: ErrorState = { failures: 0, surfacedStreak: 0, error: null, warning: null };

/** Offline is reported at once: every request would fail, so none is sent. */
export function wentOffline(state: ErrorState): ErrorState {
  return {
    ...state,
    surfacedStreak: state.surfacedStreak + 1,
    error: { message: OFFLINE_MESSAGE, kind: 'offline' },
  };
}

/** A batch failed for real (not just a suspicious echo); surfaces `error` once the threshold is reached. */
export function batchFailed(state: ErrorState, error: TranslateError): ErrorState {
  const failures = state.failures + 1;
  if (failures < CONSECUTIVE_FAILURES_BEFORE_SURFACING) return { ...state, failures };
  return {
    ...state,
    failures,
    surfacedStreak: state.surfacedStreak + 1,
    error: { message: describeTranslateError(error), kind: 'provider' },
  };
}

/** A tick with no genuine failure: the provider works, so counters and any real error clear. */
export function batchSucceeded(warning: string | null): ErrorState {
  return { ...INITIAL_ERROR_STATE, warning };
}

export function withWarning(state: ErrorState, warning: string | null): ErrorState {
  return state.warning === warning ? state : { ...state, warning };
}

/** What the bubble shows: the real error, else the untranslated-share warning, else nothing. */
export function shownError(state: ErrorState): ShownError | null {
  if (state.error) return state.error;
  return state.warning === null ? null : { message: state.warning, kind: 'provider' };
}

/**
 * The next tick's minimum delay, or `null` for none. With an error surfaced:
 * 8s, 12s, 18s, ... capped at 30s. Before that, failures are spaced 1s, 2s,
 * 4s so a short blip can clear: rapid retries of one stuck batch aren't
 * independent signals of a broken provider.
 */
export function backoffDelay(state: ErrorState): number | null {
  if (state.error) return Math.min(30000, 8000 * 1.5 ** (state.surfacedStreak - 1));
  if (state.failures > 0) return Math.min(4000, 1000 * 2 ** (state.failures - 1));
  return null;
}

/** The given-up share is a report, not an outage: normally a few endonyms, worth a warning only when large. */
export function untranslatedShareWarning(untranslatedChars: number, translatedChars: number): string | null {
  const share = untranslatedChars / (untranslatedChars + translatedChars);
  if (untranslatedChars < MIN_UNTRANSLATED_CHARS_TO_WARN || share < UNTRANSLATED_SHARE_TO_WARN) return null;
  return `About ${Math.round(share * 100)}% of this page came back untranslated. Try again; if it keeps happening, switch provider in Settings.`;
}

const UNTRANSLATED_MESSAGE =
  'The translation service keeps sending text back untranslated. Prism keeps retrying; if it keeps happening, switch provider in Settings.';

/** What the bubble says for a failure, in plain words. Both providers are Google's, so naming Google is accurate. */
export function describeTranslateError(error: TranslateError): string {
  switch (error.kind) {
    case 'network':
      return "Couldn't reach the translation service — retrying automatically.";
    case 'timeout':
      return 'The translation service is taking too long to answer — retrying automatically.';
    case 'rateLimited':
      return 'Google is limiting requests right now; Prism will retry automatically.';
    case 'http':
      if (error.status === undefined) return 'The translation service answered with an error — retrying automatically.';
      if (error.status >= 500) {
        return `Google's translation service is having trouble (HTTP ${error.status}) — retrying automatically.`;
      }
      // A rejection won't change on retry, so don't promise one.
      return error.reason
        ? `The translation service rejected the request: ${error.reason}`
        : `The translation service rejected the request (HTTP ${error.status}).`;
    case 'auth': {
      const reason = error.reason?.endsWith('.') ? error.reason.slice(0, -1) : error.reason;
      const detail = error.status === undefined ? '' : ` (HTTP ${error.status}${reason ? `: ${reason}` : ''})`;
      return `Google's free translation key isn't working${detail}. Prism keeps retrying with a new key. To translate now, switch to Google Cloud in Settings and add your own API key.`;
    }
    case 'badResponse':
      return "Google changed how its translation service answers, so Prism can't read the replies. Switch to Google Cloud in Settings until Prism is updated.";
    case 'suspicious':
    case 'untranslated':
      return UNTRANSLATED_MESSAGE;
    case 'notConfigured':
      return "The chosen translation service isn't set up yet. Add its API key in Settings, or switch to Google (free).";
  }
}

/**
 * The wording for a translation that runs once (selected text, the Settings
 * test): the same plain message, without promising an automatic retry.
 */
export function describeOneOffTranslateError(error: TranslateError): string {
  if (error.kind === 'suspicious' || error.kind === 'untranslated') {
    return 'The translation service sent this text back untranslated. Try again; if it keeps happening, switch provider in Settings.';
  }
  return describeTranslateError(error).replace(/\s*(?:—|;)\s*(?:retrying|Prism will retry) automatically\.$/, '.');
}
