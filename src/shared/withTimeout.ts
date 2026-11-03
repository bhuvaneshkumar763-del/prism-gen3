/**
 * Races a promise against a timer, so a reply that never comes (the page
 * navigated away, the content script crashed) can't leave a caller waiting
 * forever. It never cancels the underlying work; a late settlement is ignored.
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
