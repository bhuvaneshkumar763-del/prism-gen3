import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollForFrameDecision } from './subFramePoll';

describe('pollForFrameDecision', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles instead of rejecting when asking the background throws (extension updated), and stops', async () => {
    const sync = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    const onError = vi.fn();
    await expect(pollForFrameDecision({ sync, maxAttempts: 5, intervalMs: 200, onError })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('polls until a decision is applied', async () => {
    const sync = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const done = pollForFrameDecision({ sync, maxAttempts: 5, intervalMs: 200, onError: vi.fn() });
    await vi.runAllTimersAsync();
    await done;
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt limit', async () => {
    const sync = vi.fn().mockResolvedValue(false);
    const done = pollForFrameDecision({ sync, maxAttempts: 4, intervalMs: 200, onError: vi.fn() });
    await vi.runAllTimersAsync();
    await done;
    expect(sync).toHaveBeenCalledTimes(4);
  });

  it('asks the top frame once when there is no decision yet, so a lost decision gets published again', async () => {
    const sync = vi.fn().mockResolvedValue(false);
    const onFirstWait = vi.fn();
    const done = pollForFrameDecision({ sync, maxAttempts: 4, intervalMs: 200, onFirstWait, onError: vi.fn() });
    await vi.runAllTimersAsync();
    await done;
    expect(onFirstWait).toHaveBeenCalledTimes(1);
  });
});
