import { describe, expect, it } from 'vitest';
import { err, ok } from './result';
import { describeTranslationTest, pickTranslationTestSample } from './translationTest';

describe('pickTranslationTestSample', () => {
  it('translates English into the configured target', () => {
    expect(pickTranslationTestSample('es')).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'es' });
  });

  it('uses a non-English sample when the target IS English — English into English comes back unchanged and proves nothing', () => {
    const sample = pickTranslationTestSample('en');
    expect(sample.targetLanguage).toBe('en');
    expect(sample.sourceLanguage).not.toBe('en');
  });

  it('treats a regional English target the same way', () => {
    expect(pickTranslationTestSample('en-GB').sourceLanguage).not.toBe('en');
  });
});

describe('describeTranslationTest', () => {
  const sample = pickTranslationTestSample('es');

  it('reports success with the actual output and how long it took', () => {
    const result = describeTranslationTest(sample, ok('Buenos días, ¿cómo estás?'), 240);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Buenos días');
    expect(result.message).toContain('240 ms');
  });

  it("does NOT call it working when the text came back unchanged — this project's documented silent-failure mode, where the service answers successfully but translates nothing", () => {
    const result = describeTranslationTest(sample, ok(sample.text), 180);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unchanged/i);
  });

  it('ignores whitespace-only differences when deciding the text came back unchanged', () => {
    expect(describeTranslationTest(sample, ok(`  ${sample.text}  `), 180).ok).toBe(false);
  });

  it("passes the provider's own error through rather than a generic one", () => {
    const result = describeTranslationTest(sample, err({ kind: 'http', message: 'API key not valid' }), 90);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('API key not valid');
  });
});
