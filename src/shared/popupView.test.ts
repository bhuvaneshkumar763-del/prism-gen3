import { describe, expect, it } from 'vitest';
import { describeTranslateError } from '../engine/pageTranslator/errorState';
import {
  describePopupError,
  GENERIC_POPUP_ERROR,
  pageErrorText,
  pillRowAfterPick,
  REACH_PAGE_MESSAGE,
  SAVE_FAILED_MESSAGE,
  siteRuleFor,
  siteRulePatch,
  statusPillText,
  translateButtonLabel,
} from './popupView';
import { TimeoutError } from './withTimeout';

const emptyLists = {
  alwaysTranslateSites: [] as string[],
  neverTranslateSites: [] as string[],
  alwaysTranslateLangs: [] as string[],
  neverTranslateLangs: [] as string[],
};

describe('translateButtonLabel', () => {
  it('names the target language', () => {
    expect(translateButtonLabel('en')).toBe('Translate to English');
    expect(translateButtonLabel('vi')).toBe('Translate to Vietnamese');
  });

  it('falls back to the code for a language outside the common list', () => {
    expect(translateButtonLabel('xx')).toBe('Translate to xx');
  });
});

describe('statusPillText', () => {
  it('shows which way a translated page went', () => {
    expect(statusPillText(true, 'fr', 'en')).toBe('French → English');
  });

  it('says "Translated" when the direction cannot be said honestly', () => {
    expect(statusPillText(true, 'und', 'en')).toBe('Translated');
  });

  it('names the detected language of an untranslated page', () => {
    expect(statusPillText(false, 'fr', 'en')).toBe('Original · French');
  });

  it('never shows a dangling "…" while the language is unknown', () => {
    expect(statusPillText(false, 'und', 'en')).toBe('Original');
  });
});

describe('pillRowAfterPick', () => {
  it('leaves the row exactly as it is when the picked language is already shown', () => {
    const row = ['en', 'fr', 'vi'];
    expect(pillRowAfterPick(row, 'vi', 5)).toEqual(['en', 'fr', 'vi']);
    expect(pillRowAfterPick(row, 'fr', 5)).toEqual(['en', 'fr', 'vi']);
  });

  it('adds a newly picked language at the end while there is room', () => {
    expect(pillRowAfterPick(['en', 'fr'], 'de', 5)).toEqual(['en', 'fr', 'de']);
  });

  it('replaces only the last pill when the row is full, so the others stay put', () => {
    expect(pillRowAfterPick(['en', 'fr', 'de', 'es', 'it'], 'vi', 5)).toEqual(['en', 'fr', 'de', 'es', 'vi']);
  });

  it('shows the first pick on an empty row', () => {
    expect(pillRowAfterPick([], 'en', 5)).toEqual(['en']);
  });
});

describe('siteRuleFor', () => {
  it('is "default" for a site on neither list', () => {
    expect(siteRuleFor(emptyLists, 'example.com')).toBe('default');
  });

  it('reads each list, matching www. and apex forms', () => {
    expect(siteRuleFor({ ...emptyLists, alwaysTranslateSites: ['example.com'] }, 'www.example.com')).toBe('always');
    expect(siteRuleFor({ ...emptyLists, neverTranslateSites: ['www.example.com'] }, 'example.com')).toBe('never');
  });

  it('lets "never" win when a site is somehow on both lists', () => {
    expect(
      siteRuleFor(
        { ...emptyLists, alwaysTranslateSites: ['example.com'], neverTranslateSites: ['example.com'] },
        'example.com',
      ),
    ).toBe('never');
  });

  it('is "default" with no hostname', () => {
    expect(siteRuleFor({ ...emptyLists, alwaysTranslateSites: ['example.com'] }, '')).toBe('default');
  });
});

describe('siteRulePatch', () => {
  const onBoth = { ...emptyLists, alwaysTranslateSites: ['example.com'], neverTranslateSites: ['www.example.com'] };

  it('"always" adds the site to the always list and takes it off the never list', () => {
    expect(siteRulePatch(onBoth, 'example.com', 'always')).toEqual({
      alwaysTranslateSites: ['example.com'],
      neverTranslateSites: [],
    });
  });

  it('"never" adds the site to the never list and takes it off the always list', () => {
    expect(siteRulePatch(emptyLists, 'example.com', 'never')).toEqual({
      alwaysTranslateSites: [],
      neverTranslateSites: ['example.com'],
    });
  });

  it('"default" takes the site off both lists', () => {
    expect(siteRulePatch(onBoth, 'example.com', 'default')).toEqual({
      alwaysTranslateSites: [],
      neverTranslateSites: [],
    });
  });

  it('leaves other sites alone', () => {
    const lists = { ...emptyLists, alwaysTranslateSites: ['a.com', 'example.com'], neverTranslateSites: ['b.com'] };
    expect(siteRulePatch(lists, 'example.com', 'never')).toEqual({
      alwaysTranslateSites: ['a.com'],
      neverTranslateSites: ['b.com', 'example.com'],
    });
  });
});

describe('describePopupError', () => {
  it.each([
    new TimeoutError('timed out after 5000ms'),
    new Error('No response'),
    new Error('Could not establish connection. Receiving end does not exist.'),
    new Error('The message port closed before a response was received.'),
    new Error('No active tab'),
    'timed out after 5000ms',
  ])('says the page could not be reached for %s', (error) => {
    expect(describePopupError(error)).toBe(REACH_PAGE_MESSAGE);
  });

  it('turns an unconfigured-provider message into the plain setup advice', () => {
    expect(describePopupError(new Error('[googleCloudTranslate] not configured or unavailable'))).toBe(
      describeTranslateError({ kind: 'notConfigured', message: '' }),
    );
  });

  it('never shows an unknown internal message', () => {
    expect(describePopupError(new Error('TypeError: x is undefined'))).toBe(GENERIC_POPUP_ERROR);
    expect(describePopupError(undefined)).toBe(GENERIC_POPUP_ERROR);
  });

  it('has plain, user-facing wording', () => {
    expect(REACH_PAGE_MESSAGE).toBe("Prism can't reach this page. Reload it and try again.");
    expect(SAVE_FAILED_MESSAGE).not.toMatch(/\(|Error/);
  });
});

describe('pageErrorText', () => {
  it('passes the page’s own plain-language message through, with no "Error:" prefix', () => {
    const message = describeTranslateError({ kind: 'network', message: '' });
    expect(pageErrorText({ message, kind: 'provider' })).toBe(message);
  });

  it('keeps the offline message as it is', () => {
    expect(pageErrorText({ message: 'Offline — translation will resume.', kind: 'offline' })).toBe(
      'Offline — translation will resume.',
    );
  });

  it('rewrites internal text that reaches the popup from an older page', () => {
    expect(pageErrorText({ message: '[googleCloudTranslate] not configured or unavailable', kind: 'provider' })).toBe(
      describeTranslateError({ kind: 'notConfigured', message: '' }),
    );
    expect(pageErrorText({ message: 'timed out after 5000ms', kind: 'provider' })).toBe(REACH_PAGE_MESSAGE);
  });
});
