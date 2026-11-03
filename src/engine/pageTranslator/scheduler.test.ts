// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../shared/result';
import type { PieceOutcome } from '../translator';
import { createTickScheduler } from './scheduler';
import { createPageTranslator } from './translateLoop';

describe('createTickScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps at most one pending tick: a later schedule replaces the earlier one', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.schedule(0);
    scheduler.schedule(500);
    await vi.advanceTimersByTimeAsync(400);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('treats a backoff as a floor that a sooner schedule cannot undercut', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.backOff(5000);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(3900);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
    // Once the backoff has passed, a schedule runs at its own delay again.
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('a later delay still wins over a shorter backoff', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.backOff(1000);
    scheduler.schedule(3000);
    await vi.advanceTimersByTimeAsync(2900);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('wakeNow ends the backoff and runs at once', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.backOff(30000);
    scheduler.wakeNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('clearBackoff lets the next schedule run at its own delay', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.backOff(30000);
    scheduler.clearBackoff();
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending tick and the backoff', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const scheduler = createTickScheduler(tick);
    scheduler.backOff(30000);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(60000);
    expect(tick).not.toHaveBeenCalled();
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe('error backoff on a page that keeps changing', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a page mutation does not cancel the backoff: a down provider gets one request per backoff interval, not one per mutation', async () => {
    document.body.innerHTML = '<p>hello</p><p id="live">live 0</p>';
    const live = (document.getElementById('live') as HTMLElement).firstChild as Text;
    const translateBatch = vi.fn(
      async (request: { pieces: string[][] }): Promise<PieceOutcome[]> =>
        request.pieces.map((): PieceOutcome => err({ kind: 'network', message: 'HTTP 500' })),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // Failing ticks at 0, 1000 and 3000 ms; the third surfaces the error
      // and sets an 8000 ms backoff.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(pageTranslator.getLastError()).not.toBeNull();
      const callsAtSurfacing = translateBatch.mock.calls.length;

      // A live counter on the page changes every 200 ms for 7 s.
      for (let i = 1; i <= 35; i++) {
        live.data = `live ${i}`;
        await vi.advanceTimersByTimeAsync(200);
      }
      expect(translateBatch.mock.calls.length).toBe(callsAtSurfacing);

      // The backoff runs out at 11000 ms: exactly one retry.
      await vi.advanceTimersByTimeAsync(1500);
      expect(translateBatch.mock.calls.length).toBe(callsAtSurfacing + 1);
    } finally {
      pageTranslator.restorePage();
    }
  });

  it('a retry queued while a failed tick writes back does not leave a 0 ms timer that skips the backoff', async () => {
    document.body.innerHTML = '<p>alpha</p><p>beta</p>';
    const translateBatch = vi.fn(
      async (request: { pieces: string[][] }): Promise<PieceOutcome[]> =>
        request.pieces.map(
          (piece): PieceOutcome =>
            piece[0]?.startsWith('alpha')
              ? err({ kind: 'network', message: 'HTTP 503' })
              : ok(piece.map((s) => s.toUpperCase())),
        ),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // One mixed tick: 'beta' lands, 'alpha' fails for real and is queued
      // again; the first pre-surfacing backoff is 1000 ms.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(900);
      expect(translateBatch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(translateBatch).toHaveBeenCalledTimes(2);
    } finally {
      pageTranslator.restorePage();
    }
  });
});
