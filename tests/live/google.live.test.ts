import { describe, expect, it } from 'vitest';
import { createGoogleProvider } from '../../src/engine/providers/google';

// Calls the real free Google endpoint, the way the extension does. Run by
// .github/workflows/google-canary.yml every day, so a change on Google's side
// shows up as a failed run before it shows up as an untranslated chapter.
describe('free Google translation (live)', () => {
  it('translates a Vietnamese sentence into English', async () => {
    const source = 'Hôm nay trời rất đẹp, chúng ta đi dạo nhé.';
    const [outcome] = await createGoogleProvider().translateBatch({
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      pieces: [[source]],
    });

    expect(outcome?.ok, JSON.stringify(outcome)).toBe(true);
    const text = outcome?.ok ? (outcome.value[0] ?? '') : '';
    expect(text.trim()).not.toBe('');
    expect(text).not.toBe(source);
    expect(text).toMatch(/[A-Za-z]/);
    expect(text).not.toMatch(/[ạảãàáâậầấẩẫăắằặẳẵơớờợởỡưứừựửữđ]/i);
  }, 60_000);
});
