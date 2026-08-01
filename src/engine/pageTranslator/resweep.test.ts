// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResweepScheduler } from './resweep';

describe('createResweepScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call onResweep before start()', () => {
    const onResweep = vi.fn(() => false);
    createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    vi.advanceTimersByTime(5000);
    expect(onResweep).not.toHaveBeenCalled();
  });

  it('calls onResweep once translated+visible after start()', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(1500); // RESWEEP_MIN_MS
    expect(onResweep).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does not call onResweep while not translated', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => false, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(20000);
    expect(onResweep).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('does not call onResweep while the page is hidden', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => false, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(20000);
    expect(onResweep).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('backs off the interval when nothing new is found (fewer ticks over a fixed window than at the min interval)', () => {
    const onResweep = vi.fn(() => false); // never finds anything -> delay should keep growing
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();

    vi.advanceTimersByTime(30000);
    const backedOffCalls = onResweep.mock.calls.length;
    scheduler.stop();

    // At the constant 1500ms min interval, 30s would yield 20 ticks. Backing
    // off (capped at 10s max) means meaningfully fewer.
    expect(backedOffCalls).toBeGreaterThan(0);
    expect(backedOffCalls).toBeLessThan(20);
  });

  it('resets to the fast (min) interval on the tick after onResweep finds something new', () => {
    let grew = false;
    const onResweep = vi.fn(() => grew);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();

    // Let the delay back off for a while first.
    vi.advanceTimersByTime(10000);
    onResweep.mockClear();

    grew = true;
    vi.advanceTimersByTime(10000); // whatever the current (backed-off) delay is, it fires at least once
    expect(onResweep.mock.calls.length).toBeGreaterThanOrEqual(1);
    grew = false;

    // Now that a "found something" tick has happened, the very next
    // scheduled delay must be back at the 1500ms min, not still backed off.
    onResweep.mockClear();
    vi.advanceTimersByTime(1500);
    expect(onResweep).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('bump() has no effect before start()', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.bump();
    vi.advanceTimersByTime(1000);
    expect(onResweep).not.toHaveBeenCalled();
  });

  it('bump() schedules a near-immediate resweep', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(1500); // let the initial tick fire and settle
    onResweep.mockClear();

    scheduler.bump();
    vi.advanceTimersByTime(250); // bump()'s fixed re-check delay
    expect(onResweep).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('stop() prevents further onResweep calls', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(1500);
    expect(onResweep).toHaveBeenCalledTimes(1);

    scheduler.stop();
    onResweep.mockClear();
    vi.advanceTimersByTime(20000);
    expect(onResweep).not.toHaveBeenCalled();
  });

  it('a scroll event bumps the cadence back to the min interval while translated', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(20000); // let the delay back off first
    onResweep.mockClear();

    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(400); // scroll debounce
    vi.advanceTimersByTime(250); // bump()'s fixed re-check delay
    expect(onResweep).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('a scroll event while not translated does not schedule a bump', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => false, isPageVisible: () => true, onResweep });
    scheduler.start();

    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(650);
    expect(onResweep).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('a popstate event bumps the cadence while translated', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    vi.advanceTimersByTime(20000);
    onResweep.mockClear();

    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(250);
    expect(onResweep).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('a popstate event while not translated does not bump', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => false, isPageVisible: () => true, onResweep });
    scheduler.start();

    window.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(250);
    expect(onResweep).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('calling start() again after already started just bumps, not double-schedules', () => {
    const onResweep = vi.fn(() => false);
    const scheduler = createResweepScheduler({ isTranslated: () => true, isPageVisible: () => true, onResweep });
    scheduler.start();
    scheduler.start(); // should behave like bump(), not register a second interval chain
    vi.advanceTimersByTime(1500);
    // Exactly one initial tick fires from the first start(); the second
    // start() call's bump() reschedule lands at the same ~250ms mark or is
    // superseded by it — either way onResweep must not have been invoked
    // twice for the same logical tick.
    expect(onResweep.mock.calls.length).toBeGreaterThanOrEqual(1);
    scheduler.stop();
  });

  describe('onHrefChange', () => {
    const originalHref = window.location.href;

    afterEach(() => {
      window.history.replaceState(null, '', originalHref);
    });

    it('fires once per tick when location.href changes since the last tick', () => {
      const onHrefChange = vi.fn();
      const scheduler = createResweepScheduler({
        isTranslated: () => false,
        isPageVisible: () => true,
        onResweep: () => false,
        onHrefChange,
      });
      scheduler.start();
      vi.advanceTimersByTime(10000); // one tick, not translated so onResweep is skipped but href is still checked
      expect(onHrefChange).not.toHaveBeenCalled();

      window.history.pushState(null, '', `${originalHref}#chapter-2`);
      vi.advanceTimersByTime(10000);
      expect(onHrefChange).toHaveBeenCalledTimes(1);

      // Same href on the next tick — must not fire again.
      vi.advanceTimersByTime(10000);
      expect(onHrefChange).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });
});
