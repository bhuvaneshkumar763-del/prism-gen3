/**
 * Adaptive concurrency via the Network Information API — Phase 4b of the
 * graceful-degradation pass. `navigator.connection` is Chromium-only and
 * experimental (not `chrome`/`browser`-namespaced, so it's fine to touch
 * from `src/engine/**` per the purity boundary) — this must degrade to
 * exactly today's fixed behavior everywhere the API is absent (Firefox,
 * older Chrome), not fail or behave differently there.
 *
 * Deliberately scoped to `maxConcurrent` only — see
 * `batchedHttpProvider.ts`'s `pump()` for where this gets called. Does
 * NOT touch `maxBatchChars`, `batchingHint`, or `maxGroupChars` —
 * those are accuracy-tuned chunking knobs with their own hard-won tuning
 * history (including the Google reflow-corruption bug fixed just before
 * this pass), and mixing a speed/connection-quality signal into them would
 * multiply the surface a future accuracy bug could hide in for no clear
 * benefit over just adjusting how many requests run at once.
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

/**
 * Returns a concurrency cap adapted to the current connection quality, or
 * `defaultConcurrent` unchanged when `navigator.connection` isn't present
 * (Firefox, or a Chrome build/version without it) — the exact behavior
 * every provider had before this module existed.
 */
export function getAdaptiveConcurrency(defaultConcurrent: number): number {
  const connection = typeof navigator === 'undefined' ? undefined : navigator.connection;
  if (!connection) return defaultConcurrent;

  if (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return 2;
  if (connection.effectiveType === '3g') return 4;
  return defaultConcurrent;
}
