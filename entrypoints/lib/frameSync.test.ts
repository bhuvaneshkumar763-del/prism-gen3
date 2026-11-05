import { describe, expect, it } from 'vitest';
import { pageKeyFromSync } from './frameSync';

const own = 'https://example.com';

describe('pageKeyFromSync', () => {
  it('takes the page key from a same-origin sync message, whatever window object sent it', () => {
    expect(pageKeyFromSync({ prismFrameSync: true, pageKey: 'k-1234567890' }, own, own)).toBe('k-1234567890');
  });

  it('ignores a sync message from another origin', () => {
    expect(
      pageKeyFromSync({ prismFrameSync: true, pageKey: 'k-1234567890' }, 'https://evil.test', own),
    ).toBeUndefined();
  });

  it('ignores a key that is not a string, and messages that are not syncs', () => {
    expect(pageKeyFromSync({ prismFrameSync: true, pageKey: 42 }, own, own)).toBeUndefined();
    expect(pageKeyFromSync({ pageKey: 'k-1234567890' }, own, own)).toBeUndefined();
    expect(pageKeyFromSync(null, own, own)).toBeUndefined();
  });
});
