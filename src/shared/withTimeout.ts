/**
 * A promise that never settles (a content script that never replies — the
 * page navigated away mid-request, or the tab's content script crashed)
 * used to leave the popup stuck on "translating…" forever, with no
 * recovery short of closing and reopening it. Real gap: nothing in the
 * messaging layer ever timed out a request.
 *
 * `race()`s the given promise against a timer, so the original promise's
 * own eventual settlement (if it ever comes) is simply ignored once the
 * timer wins — this never cancels the underlying work, it only stops the
 * caller from waiting on it forever.
 */
export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number, message = `timed out after ${ms}ms`): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}
