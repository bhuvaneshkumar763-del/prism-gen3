import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the original value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects with the original error when it rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError once the timeout elapses, real bug: a hung sendMessage left the popup stuck on "translating…" forever', async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise(() => {});

    const result = withTimeout(neverSettles, 5000);
    const assertion = expect(result).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('does not fire the timeout once the promise has already settled', async () => {
    vi.useFakeTimers();
    const result = withTimeout(Promise.resolve('fast'), 5000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe('fast');

    // Advancing well past the timeout afterward must not throw — the timer
    // was cleared on settlement.
    await vi.advanceTimersByTimeAsync(10000);
  });
});
