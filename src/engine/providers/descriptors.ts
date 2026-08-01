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

export type ProviderId = 'libretranslate' | 'google' | 'googleCloudTranslate' | 'llm' | 'builtin';

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
  /** Runtime feature-detection for providers that may not exist in this browser (the on-device provider). Omit for providers that are always usable once configured. */
  isAvailable?(): boolean;
  batchingHint?: BatchingHint;
}

function hasBuiltinTranslatorApi(): boolean {
  return typeof (globalThis as { Translator?: unknown }).Translator !== 'undefined';
}

export const providerDescriptors: ProviderDescriptor[] = [
  // Free, no signup, but a real quality ceiling — see
  // docs/decisions/0004-provider-scope.md. Kept as the no-setup fallback,
  // not the recommended default.
  { id: 'libretranslate', displayName: 'LibreTranslate', requiresKey: false },
  { id: 'google', displayName: 'Google (free)', requiresKey: false },
  // The real, official Google Cloud API (user's own key/billing) — the
  // closest match to what Arc's browser translate feature actually uses,
  // confirmed live (see the ADR above).
  { id: 'googleCloudTranslate', displayName: 'Google Cloud Translation API', requiresKey: true },
  {
    id: 'llm',
    displayName: 'AI (OpenAI-compatible — cloud or local)',
    requiresKey: true,
    batchingHint: { groupByBlock: true, maxGroupChars: 2000 },
  },
  {
    id: 'builtin',
    displayName: 'Built-in AI (on-device, this browser only)',
    requiresKey: false,
    isAvailable: hasBuiltinTranslatorApi,
    // Deliberately no batchingHint: on-device calls have no network
    // round-trip to amortize, so per-node granularity is already fine.
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
