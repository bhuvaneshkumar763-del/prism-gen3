import { describe, expect, it } from 'vitest';
import { manifestVersionFor } from './manifestVersion';

/** Chrome and Firefox compare manifest versions part by part, padding missing parts with zero. */
function compareManifestVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('manifestVersionFor', () => {
  it('maps a prerelease to a fourth number', () => {
    expect(manifestVersionFor('0.3.2-beta.0')).toBe('0.3.2.0');
    expect(manifestVersionFor('0.3.2-beta.5')).toBe('0.3.2.5');
    expect(manifestVersionFor('0.4.0-rc.2')).toBe('0.4.0.2');
  });

  it('keeps the versions already published as they were, so Mozilla still finds them', () => {
    expect(manifestVersionFor('0.3.0-beta.73')).toBe('0.3.0.73');
    expect(manifestVersionFor('0.3.1')).toBe('0.3.1');
    expect(manifestVersionFor('0.2.1')).toBe('0.2.1');
  });

  it('puts a stable release after 0.3.1 above every one of its own betas', () => {
    expect(manifestVersionFor('0.3.2')).toBe('0.3.2.9999');
    expect(manifestVersionFor('1.0.0')).toBe('1.0.0.9999');
  });

  it('keeps every release in order, which is what broke 0.3.0', () => {
    const releases = ['0.3.0-beta.73', '0.3.1', '0.3.2-beta.0', '0.3.2-beta.5', '0.3.2', '0.3.3-beta.0', '0.3.3'];
    const versions = releases.map(manifestVersionFor);
    for (let i = 1; i < versions.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i is in bounds
      expect(compareManifestVersions(versions[i]!, versions[i - 1]!)).toBeGreaterThan(0);
    }
  });

  it('refuses a version it cannot map, rather than building an extension browsers reject', () => {
    expect(() => manifestVersionFor('0.3.2-beta')).toThrow();
    expect(() => manifestVersionFor('0.3.2-beta.9999')).toThrow();
    expect(() => manifestVersionFor('v0.3.2')).toThrow();
    expect(() => manifestVersionFor('0.3')).toThrow();
  });
});
