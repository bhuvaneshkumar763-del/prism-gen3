import { describe, expect, it } from 'vitest';
import type { FrameLanguageDecision } from './messaging/protocol';
import {
  classifyFrame,
  type FollowerState,
  type FrameKind,
  followTopFrame,
  type PageControl,
  pageCommandRoute,
} from './pageFrames';

const CONTROLS: PageControl[] = ['bubble', 'pageMessage', 'autoTranslate'];
const FRAMES: FrameKind[] = ['top', 'sameOriginSubFrame', 'crossOriginSubFrame'];

/** The frames a command from `control` ends up applied in: run directly, or forwarded by the top frame. */
function framesReached(control: PageControl): FrameKind[] {
  const top = pageCommandRoute('top', control);
  return FRAMES.filter((frame) => {
    if (pageCommandRoute(frame, control).runHere) return true;
    return frame === 'sameOriginSubFrame' && top.forwardToSameOriginSubFrames;
  });
}

const TOP = 'https://example.com';

function decision(overrides: Partial<FrameLanguageDecision> = {}): FrameLanguageDecision {
  return { shouldTranslate: true, targetLanguage: 'en', originalLanguage: 'zh', mainFrameOrigin: TOP, ...overrides };
}

const ORIGINAL: FollowerState = { translated: false };

describe('classifyFrame', () => {
  it('tells the top frame, same-origin sub-frames and cross-origin sub-frames apart', () => {
    expect(classifyFrame(true, true)).toBe('top');
    expect(classifyFrame(false, true)).toBe('sameOriginSubFrame');
    expect(classifyFrame(false, false)).toBe('crossOriginSubFrame');
  });
});

describe('pageCommandRoute', () => {
  it.each(CONTROLS)(
    'a command from %s reaches the top frame and same-origin sub-frames, never cross-origin ones',
    (control) => {
      expect(framesReached(control)).toEqual(['top', 'sameOriginSubFrame']);
    },
  );

  it('applies each command once per frame: a sub-frame never runs a command itself, it hears it from the top frame', () => {
    for (const control of CONTROLS) {
      expect(pageCommandRoute('top', control)).toEqual({ runHere: true, forwardToSameOriginSubFrames: true });
      expect(pageCommandRoute('sameOriginSubFrame', control)).toEqual({
        runHere: false,
        forwardToSameOriginSubFrames: false,
      });
      expect(pageCommandRoute('crossOriginSubFrame', control)).toEqual({
        runHere: false,
        forwardToSameOriginSubFrames: false,
      });
    }
  });
});

describe('followTopFrame', () => {
  it("waits while the top frame hasn't published a decision for this page load", () => {
    expect(followTopFrame(null, TOP, ORIGINAL)).toEqual({ action: 'wait' });
    expect(followTopFrame(decision({ mainFrameOrigin: 'https://other.example' }), TOP, ORIGINAL)).toEqual({
      action: 'wait',
    });
  });

  it("translates with the top frame's language decision, turning an undetected source into 'auto'", () => {
    expect(followTopFrame(decision(), TOP, ORIGINAL)).toEqual({
      action: 'translate',
      targetLanguage: 'en',
      sourceLanguage: 'zh',
    });
    expect(followTopFrame(decision({ originalLanguage: 'und' }), TOP, ORIGINAL)).toEqual({
      action: 'translate',
      targetLanguage: 'en',
      sourceLanguage: 'auto',
    });
  });

  it("stays in the original when the top frame decided not to translate and this frame isn't translated", () => {
    expect(followTopFrame(decision({ shouldTranslate: false }), TOP, ORIGINAL)).toEqual({ action: 'stay' });
  });

  it('restores when the top frame switched back to the original after translating', () => {
    const translated: FollowerState = { translated: true, targetLanguage: 'en', sourceLanguage: 'zh' };
    expect(followTopFrame(decision({ shouldTranslate: false }), TOP, translated)).toEqual({ action: 'restore' });
  });

  it('re-translates when the top frame changed the target or source language', () => {
    const translated: FollowerState = { translated: true, targetLanguage: 'en', sourceLanguage: 'zh' };
    expect(followTopFrame(decision({ targetLanguage: 'fr' }), TOP, translated)).toEqual({
      action: 'translate',
      targetLanguage: 'fr',
      sourceLanguage: 'zh',
    });
    expect(followTopFrame(decision({ originalLanguage: 'ja' }), TOP, translated)).toEqual({
      action: 'translate',
      targetLanguage: 'en',
      sourceLanguage: 'ja',
    });
  });

  it("doesn't re-translate a frame already showing the top frame's current decision", () => {
    const translated: FollowerState = { translated: true, targetLanguage: 'en', sourceLanguage: 'zh' };
    expect(followTopFrame(decision(), TOP, translated)).toEqual({ action: 'stay' });
  });
});
