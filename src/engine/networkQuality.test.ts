import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdaptiveConcurrency } from './networkQuality';

describe('getAdaptiveConcurrency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the default unchanged when navigator.connection is absent (Firefox, older Chrome)', () => {
    vi.stubGlobal('navigator', {});
    expect(getAdaptiveConcurrency(6)).toBe(6);
  });

  it('returns the default unchanged when navigator itself is absent', () => {
    vi.stubGlobal('navigator', undefined);
    expect(getAdaptiveConcurrency(6)).toBe(6);
  });

  it('drops to 2 on slow-2g', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: 'slow-2g' } });
    expect(getAdaptiveConcurrency(6)).toBe(2);
  });

  it('drops to 2 on 2g', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } });
    expect(getAdaptiveConcurrency(6)).toBe(2);
  });

  it('drops to 2 when saveData is on, regardless of effectiveType', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '4g', saveData: true } });
    expect(getAdaptiveConcurrency(6)).toBe(2);
  });

  it('drops to 4 on 3g', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '3g' } });
    expect(getAdaptiveConcurrency(6)).toBe(4);
  });

  it('returns the default unchanged on 4g', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '4g' } });
    expect(getAdaptiveConcurrency(6)).toBe(6);
  });

  it('returns the default unchanged when effectiveType is unset entirely', () => {
    vi.stubGlobal('navigator', { connection: {} });
    expect(getAdaptiveConcurrency(6)).toBe(6);
  });
});
