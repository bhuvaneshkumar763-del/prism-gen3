/**
 * The only owner of the translate loop's tick timer. There is at most one
 * pending tick: `schedule` always replaces it. An error backoff is a floor
 * that a later `schedule` can't undercut, so a page that keeps changing can't
 * turn a down provider's backoff into one request per mutation.
 */
export interface TickScheduler {
  /** Runs the tick after `delayMs`, or when the backoff ends if that is later. */
  schedule(delayMs: number): void;
  /** Starts a backoff of `delayMs` from now and schedules the tick at its end. */
  backOff(delayMs: number): void;
  /** Ends any backoff, leaving the pending tick where it is. */
  clearBackoff(): void;
  /** Ends any backoff and runs the tick now (connectivity came back). */
  wakeNow(): void;
  /** Drops the pending tick and any backoff. */
  cancel(): void;
}

export function createTickScheduler(tick: () => void): TickScheduler {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let backoffUntil = 0;

  function clearPending(): void {
    if (handle === null) return;
    clearTimeout(handle);
    handle = null;
  }

  function schedule(delayMs: number): void {
    clearPending();
    const delay = Math.max(delayMs, backoffUntil - Date.now());
    handle = setTimeout(() => {
      handle = null;
      tick();
    }, delay);
  }

  return {
    schedule,
    backOff(delayMs) {
      backoffUntil = Date.now() + delayMs;
      schedule(delayMs);
    },
    clearBackoff() {
      backoffUntil = 0;
    },
    wakeNow() {
      backoffUntil = 0;
      schedule(0);
    },
    cancel() {
      clearPending();
      backoffUntil = 0;
    },
  };
}
