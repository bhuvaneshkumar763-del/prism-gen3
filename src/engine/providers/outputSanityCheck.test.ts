import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unescapeHTML } from './htmlEscape';
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

  describe('Simplified and Traditional Chinese are different languages here', () => {
    const SIMPLIFIED = '这是一个很长的句子，用来测试简体中文是否被原样送回，而没有转换成繁体中文的情况，这种情况应该被标记出来。';

    it('flags a long Simplified echo for a Traditional target, by detected language', () => {
      expect(isSuspiciousOutcome(SIMPLIFIED, { text: SIMPLIFIED, detectedLanguage: 'zh-CN' }, 'auto', 'zh-TW')).toBe(
        true,
      );
    });

    it('flags a long Simplified echo for a Traditional target, by declared source', () => {
      expect(isSuspiciousOutcome(SIMPLIFIED, { text: SIMPLIFIED, detectedLanguage: null }, 'zh-CN', 'zh-TW')).toBe(true);
    });

    it("still accepts an echo when detection names plain 'zh', which matches either script", () => {
      expect(isSuspiciousOutcome(SIMPLIFIED, { text: SIMPLIFIED, detectedLanguage: 'zh' }, 'auto', 'zh-TW')).toBe(false);
    });
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

  it('does not flag an identical result when the detected language is a regional variant of the target (zh-CN vs zh)', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'zh-CN' }, 'auto', 'zh')).toBe(false);
  });

  it("does not flag an identical result when the detected language is Google's legacy code for the target (iw vs he)", () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'iw' }, 'auto', 'he')).toBe(false);
  });

  it('does not flag an identical result when the declared source is a regional variant of the target and nothing was detected', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: null }, 'pt-BR', 'pt')).toBe(false);
  });

  it('still flags an identical result when the detected language is a genuinely different language from the target', () => {
    expect(isSuspiciousOutcome(LONG, { text: LONG, detectedLanguage: 'en' }, 'en', 'zh')).toBe(true);
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

  describe('short Vietnamese lines echoed back unchanged', () => {
    const echo = (text: string, detectedLanguage: string | null, targetLanguage = 'en') =>
      isSuspiciousOutcome(text, { text, detectedLanguage }, 'auto', targetLanguage);

    it('flags dialogue Google sent back untranslated', () => {
      expect(echo('Ngươi muốn chết sao?', 'vi')).toBe(true);
      expect(echo('Hắn cười lạnh một tiếng.', null)).toBe(true);
      expect(echo('“Đi thôi!”', 'vi')).toBe(true);
    });

    it('flags a short lowercase phrase with no sentence mark', () => {
      expect(echo('Nút tìm kiếm', 'vi')).toBe(true);
    });

    it('flags a line without a Vietnamese-only letter when Google itself detected Vietnamese', () => {
      expect(echo('Cái gì?', 'vi')).toBe(true);
      expect(echo('Cái gì?', null)).toBe(false);
    });

    it('does not flag a Title Case label Google rightly leaves alone', () => {
      expect(echo('Kỳ Môn Bí Thuật(359)', 'vi')).toBe(false);
      expect(echo('Kỳ Môn Bí Thuật', 'vi')).toBe(false);
    });

    it('does not flag English Google misdetects as another language', () => {
      expect(echo('iPad drawing app Pastela', 'tl')).toBe(false);
    });

    it('does not flag names or a single word', () => {
      expect(echo('Đường Sanh', 'vi')).toBe(false);
      expect(echo('Nguyễn Văn An', 'vi')).toBe(false);
      expect(echo('Được.', 'vi')).toBe(false);
    });

    it('does not flag mostly-English text carrying a Vietnamese name', () => {
      expect(echo('Nguyễn Văn An said hello.', null)).toBe(false);
      expect(echo('SearchCuộn Endless scroll', null)).toBe(false);
    });

    it('does not flag when Google detected the target language or the target is Vietnamese', () => {
      expect(echo('Ngươi muốn chết sao?', 'en')).toBe(false);
      expect(echo('Ngươi muốn chết sao?', 'vi', 'vi')).toBe(false);
    });
  });

  it('flags nothing Google left unchanged on the saved real pages', () => {
    const flagged: string[] = [];
    for (const page of ['pixiv-novel', 'sangtacviet-search', 'wikipedia-es-faq']) {
      const path = join(process.cwd(), 'tests/replay/pages', page, 'google.json');
      const recording = JSON.parse(readFileSync(path, 'utf8')) as Record<string, [string, string | null][]>;
      for (const [key, answers] of Object.entries(recording)) {
        const [source, target, wire] = JSON.parse(key) as [string, string, string];
        const text = (raw: string) =>
          unescapeHTML([...raw.matchAll(/<a i=\d+>([^<]*)<\/a>/g)].map((m) => m[1] ?? '').join(''));
        for (const [answer, detectedLanguage] of answers) {
          if (text(wire).trim() !== text(answer).trim()) continue;
          if (isSuspiciousOutcome(text(wire), { text: text(answer), detectedLanguage }, source, target)) {
            flagged.push(text(wire));
          }
        }
      }
    }
    expect(flagged).toEqual([]);
  });
});
