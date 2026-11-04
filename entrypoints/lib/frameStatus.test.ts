// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { FrameLanguageDecision } from '../../src/platform/messaging/protocol';
import { describeFollow, describeFollowError, describeTranslated, showFrameStatus } from './frameStatus';

const decision: FrameLanguageDecision = {
  shouldTranslate: true,
  targetLanguage: 'en',
  originalLanguage: 'zh',
  mainFrameOrigin: 'https://example.com',
};

describe('describeFollow', () => {
  it('says when the background had no decision', () => {
    expect(describeFollow(null, 'https://example.com', 'wait')).toBe('no-decision');
  });

  it('names both origins when they differ', () => {
    expect(describeFollow(decision, 'https://other.test', 'wait')).toBe(
      'origin-mismatch:https://example.com|https://other.test',
    );
  });

  it('gives the step taken when the decision applies', () => {
    expect(describeFollow(decision, 'https://example.com', 'translate')).toBe('translate');
  });
});

describe('describeTranslated and describeFollowError', () => {
  it('records the page state after translating, with any error kind', () => {
    expect(describeTranslated('translated', null)).toBe('translated:translated');
    expect(describeTranslated('original', 'network')).toBe('translated:original:network');
  });

  it('records a thrown error by its message', () => {
    expect(describeFollowError(new Error('Tab not found'))).toBe('error:Tab not found');
    expect(describeFollowError('odd')).toBe('error:odd');
  });
});

describe('showFrameStatus', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    delete document.documentElement.dataset.prismFrame;
  });

  it('writes the status only for a page that asks for it', () => {
    showFrameStatus(document, 'translate');
    expect(document.documentElement.dataset.prismFrame).toBeUndefined();

    document.head.innerHTML = '<meta name="prism-diagnostics">';
    showFrameStatus(document, 'translate');
    expect(document.documentElement.dataset.prismFrame).toBe('translate');
  });
});
