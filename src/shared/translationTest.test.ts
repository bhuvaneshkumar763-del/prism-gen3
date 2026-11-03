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

  it('explains a failure in plain words, not the raw diagnostic text', () => {
    const result = describeTranslationTest(
      sample,
      err({ kind: 'timeout', message: '[google] timed out after 5000ms' }),
      5000,
    );
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('[google]');
    expect(result.message).not.toContain('5000ms');
    expect(result.message).toMatch(/taking too long/i);
  });

  it('does not promise an automatic retry, since the test runs once', () => {
    const timeout = describeTranslationTest(sample, err({ kind: 'timeout', message: 'x' }), 5000);
    const limited = describeTranslationTest(sample, err({ kind: 'rateLimited', message: 'x', status: 429 }), 5000);
    expect(timeout.message).not.toMatch(/retry/i);
    expect(limited.message).not.toMatch(/retry/i);
  });

  it("keeps the service's own reason for a rejection", () => {
    const result = describeTranslationTest(
      sample,
      err({ kind: 'http', status: 400, reason: 'API key not valid', message: '[googleCloudTranslate] HTTP 400' }),
      90,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('API key not valid');
    expect(result.message).not.toContain('[googleCloudTranslate]');
  });

  it('tells you what to do when the provider is not set up', () => {
    const result = describeTranslationTest(
      sample,
      err({ kind: 'notConfigured', message: '[googleCloudTranslate] not configured or unavailable' }),
      5,
    );
    expect(result.message).not.toContain('[googleCloudTranslate]');
    expect(result.message).toMatch(/API key/);
  });
});
