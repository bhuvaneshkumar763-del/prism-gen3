import { describe, expect, it } from 'vitest';
import { isSuspiciousOutcome } from './outputSanityCheck';

const LONG = 'This is a genuinely long sentence that exceeds the forty character threshold.';

describe('isSuspiciousOutcome', () => {
  it('flags an empty result when the original was not empty', () => {
    expect(isSuspiciousOutcome(LONG, { text: '', detectedLanguage: null }, 'en', 'fr')).toBe(true);
  });

  it('does not flag an empty result for an already-empty/whitespace-only original', () => {
    expect(isSuspiciousOutcome('   ', { text: '', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });

  it('flags a long result byte-identical to the original when languages genuinely differ', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'en', 'fr')).toBe(true);
  });

  it('does not flag a short identical result — numbers, acronyms, proper nouns are legitimately identical', () => {
    expect(isSuspiciousOutcome('2024', { text: '2024', detectedLanguage: null }, 'en', 'fr')).toBe(false);
    expect(isSuspiciousOutcome('NASA', { text: 'NASA', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });

  it('does not flag an identical result when the provider detected the source was already in the target language', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'fr' }, 'en', 'fr')).toBe(false);
  });

  it('flags an identical result when the detected language differs from the target', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'en' }, 'auto', 'fr')).toBe(true);
  });

  it('does not flag an identical result when sourceLanguage is "auto" and there is no detected-language signal', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'auto', 'fr')).toBe(false);
  });

  it('does not flag an identical result when source and target are genuinely the same language', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'en', 'en')).toBe(false);
  });

  it('does not flag a genuinely different (real) translation', () => {
    expect(isSuspiciousOutcome(LONG, { text: 'Ceci est une phrase.', detectedLanguage: null }, 'en', 'fr')).toBe(false);
  });

  describe('script mismatch (real gap this closed — the length-only check above lets through nearly every real silent-echo failure this project has actually hit, since nav labels/buttons/headings are almost always short)', () => {
    it('flags a SHORT non-Latin-script string echoed back unchanged into a Latin-script target', () => {
      // "Login" — real example from this session's own investigation.
      expect(isSuspiciousOutcome('登陸', { text: '登陸', detectedLanguage: null }, 'zh', 'en')).toBe(true);
    });

    it('flags it even when auto and even when the provider claims it detected the target language (the exact known failure mode — Google misreporting real Chinese text as English)', () => {
      expect(isSuspiciousOutcome('登陸', { text: '登陸', detectedLanguage: 'en' }, 'auto', 'en')).toBe(true);
    });

    it('does not flag a short non-Latin string when the target language legitimately uses that same script', () => {
      expect(isSuspiciousOutcome('登陸', { text: '登陸', detectedLanguage: null }, 'en', 'zh')).toBe(false);
    });

    it('does not flag a short Latin-script identical string (falls through to the ordinary length-based check)', () => {
      expect(isSuspiciousOutcome('OK', { text: 'OK', detectedLanguage: null }, 'en', 'fr')).toBe(false);
    });

    it('does not flag when the result genuinely differs (real translation happened)', () => {
      expect(isSuspiciousOutcome('登陸', { text: 'Login', detectedLanguage: null }, 'zh', 'en')).toBe(false);
    });

    it('does not flag a legitimately-unchanged SHORT string that merely CONTAINS one incidental non-Latin character mixed into otherwise-Latin text, real regression this closed: the original version fired on any non-Latin character anywhere, so a physics variable like "Δt" was wrongly flagged even though it is mostly-Latin at 1-of-2 letters, wasting a repair request and requeue ticks on text that was correct all along', () => {
      expect(isSuspiciousOutcome('Δt', { text: 'Δt', detectedLanguage: null }, 'en', 'fr')).toBe(false);
    });

    it('still flags a short mostly-non-Latin string that has one incidental Latin character mixed in (4-of-5 letters non-Latin, at the 80% majority threshold), since it remains overwhelmingly non-Latin', () => {
      // e.g. a mixed CJK+ASCII product/menu label that echoed back unchanged.
      expect(isSuspiciousOutcome('登陸選項A', { text: '登陸選項A', detectedLanguage: null }, 'zh', 'en')).toBe(true);
    });

    it('flags a LONG Tamil string echoed back unchanged even when the (wrongly-detected) declared source happens to equal the target — real bug this closed, reproduced live against a real X.com/Twitter account: a page-level language detector dominated by English UI chrome (nav/sidebar/trending — see `originalLanguageTracker.ts`) misdetects a mixed-language feed as "en", and when the target is ALSO "en" the ordinary length-based fallback (`sourceLanguage !== targetLanguage`) cannot distinguish that from a genuine same-language no-op. Before this fix, Tamil (and Telugu/Kannada/Malayalam/Bengali/Gujarati/Punjabi/Sinhala/Lao/Myanmar/Georgian) fell entirely outside `NON_LATIN_SCRIPT`, so this length-only fallback was the only signal available and got it wrong', () => {
      const tamil = 'மத்திய அரசு விவசாயிகளுக்கு மானிய விலையில் வழங்கும் யூரியா மூட்டைகளை சட்டவிரோதமாக வேறு சாக்கு பையில் மாற்றி லாரியில்';
      expect(isSuspiciousOutcome(tamil, { text: tamil, detectedLanguage: null }, 'en', 'en')).toBe(true);
    });

    it('does not flag a short Tamil string when the target language legitimately uses that script (mirrors the existing short-CJK case above — kept short so it does not also trip the separate, unrelated source!==target length-based fallback)', () => {
      const tamil = 'வணக்கம்';
      expect(isSuspiciousOutcome(tamil, { text: tamil, detectedLanguage: null }, 'en', 'ta')).toBe(false);
    });

    it('flags an echoed Bengali string too — spot-checks one of the other newly-covered scripts (Telugu/Kannada/Malayalam/Gujarati/Punjabi/Sinhala/Lao/Myanmar/Georgian share the same fix), not just Tamil', () => {
      const bengali = 'কেন্দ্রীয় সরকার কৃষকদের ভর্তুকি মূল্যে সরবরাহ করা ইউরিয়া ব্যাগ অবৈধভাবে';
      expect(isSuspiciousOutcome(bengali, { text: bengali, detectedLanguage: null }, 'en', 'en')).toBe(true);
    });
  });
});
