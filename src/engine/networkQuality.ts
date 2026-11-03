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

  // A slow connection only ever lowers the configured cap.
  if (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
    return Math.min(2, defaultConcurrent);
  }
  if (connection.effectiveType === '3g') return Math.min(4, defaultConcurrent);
  return defaultConcurrent;
}
