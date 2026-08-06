/**
 * Single source of truth for "what providers exist and what can they do."
 * Kept as a fresh, small file rather than reproducing the old repo's exact
 * shape — but the idea (one capability registry other code derives
 * behavior from, instead of hand-maintained per-provider branches
 * scattered across the config schema/UI/registry) is a real, proven win,
 * kept on purpose.
 *
 * Zero browser-API imports here on purpose (see src/engine/README.md) —
 * this needs to be importable from anywhere, including a future
 * page-translation engine that needs a provider's `batchingHint`
 * synchronously, without a message round trip.
 */

export type ProviderId = 'libretranslate' | 'google' | 'googleCloudTranslate' | 'llm';

/** How a future page-translation engine should batch DOM text nodes for this provider, if it wants something other than one-node-per-piece. */
export interface BatchingHint {
  /** Group sibling text nodes under the same block-level ancestor into one multi-string piece for real context. */
  groupByBlock: boolean;
  /** Soft character budget per group. */
  maxGroupChars: number;
}

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  /** True if the provider needs a user-supplied key/URL before it can be used. */
  requiresKey: boolean;
  /** Runtime feature-detection for providers that may not exist in every environment. Omit for providers that are always usable once configured. */
  isAvailable?(): boolean;
  batchingHint?: BatchingHint;
}

export const providerDescriptors: ProviderDescriptor[] = [
  // Free, no signup, but a real quality ceiling — see
  // docs/decisions/0004-provider-scope.md. Kept as the no-setup fallback,
  // not the recommended default.
  {
    id: 'libretranslate',
    displayName: 'LibreTranslate',
    requiresKey: false,
    // No batchingHint: multi-string pieces here are joined with a plain
    // separator character (see libretranslate.ts) and sent as one text
    // blob — the model has no structural marker distinguishing the joined
    // segments, so there's a real (if modest) risk of it translating
    // across the separator inconsistently. Session 5 (page-translator
    // grouping.ts) chose not to take that risk without first observing it
    // against real traffic; revisit if per-node requests turn out to be
    // the bigger quality problem in practice.
  },
  {
    id: 'google',
    displayName: 'Google (free)',
    requiresKey: false,
    // Unlike the separator-joined providers above, Google's endpoint has
    // its own real multi-item marker scheme (`<a i=N>`, see google.ts) —
    // grouping sibling text nodes into one piece here gives the model
    // genuine sentence/paragraph context while still reliably splitting
    // back into the original per-node strings, no separator-ambiguity
    // risk. A smaller budget than the LLM provider's (this is a scraped
    // "lite" endpoint, not a chat completion — keeping requests modest
    // avoids stressing an endpoint this project doesn't control).
    batchingHint: { groupByBlock: true, maxGroupChars: 800 },
  },
  // The real, official Google Cloud API (user's own key/billing) — the
  // closest match to what Arc's browser translate feature actually uses,
  // confirmed live (see the ADR above). No batchingHint, same
  // separator-joining risk as LibreTranslate above.
  { id: 'googleCloudTranslate', displayName: 'Google Cloud Translation API', requiresKey: true },
  {
    id: 'llm',
    displayName: 'AI (OpenAI-compatible — cloud or local)',
    requiresKey: true,
    batchingHint: { groupByBlock: true, maxGroupChars: 2000 },
  },
];

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return providerDescriptors.find((d) => d.id === id);
}

export function getBatchingHint(id: string): BatchingHint | undefined {
  return getProviderDescriptor(id)?.batchingHint;
}

export function isProviderAvailable(id: string): boolean {
  const descriptor = getProviderDescriptor(id);
  if (!descriptor) return false;
  return descriptor.isAvailable ? descriptor.isAvailable() : true;
}
