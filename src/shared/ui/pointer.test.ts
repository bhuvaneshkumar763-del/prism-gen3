import { afterEach, describe, expect, it, vi } from 'vitest';
import { canHover } from './pointer';

describe('canHover', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true where the primary pointer hovers', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: hover)' }));
    expect(canHover()).toBe(true);
  });

  it('is false on a touch-only device', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(canHover()).toBe(false);
  });

  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(canHover()).toBe(false);
  });
});
