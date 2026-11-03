/**
 * Adaptive concurrency via the Network Information API (`navigator.connection`,
 * Chromium-only). Must fall back to the fixed default where it's absent.
 * Deliberately affects `maxConcurrent` only, never the accuracy-tuned
 * chunking knobs (`maxBatchChars`, `batchingHint`, `maxGroupChars`).
 */

interface NetworkInformationLike {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  saveData?: boolean;
}

declare global {
  interface Navigator {
    connection?: NetworkInformationLike;
  }
}

/** A concurrency cap for the current connection quality, or `defaultConcurrent` when the API is absent. */
export function getAdaptiveConcurrency(defaultConcurrent: number): number {
  const connection = typeof navigator === 'undefined' ? undefined : navigator.connection;
  if (!connection) return defaultConcurrent;

  if (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return 2;
  if (connection.effectiveType === '3g') return 4;
  return defaultConcurrent;
}
