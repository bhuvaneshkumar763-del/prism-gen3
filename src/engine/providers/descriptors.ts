/**
 * Single source of truth for which providers exist and what they can do;
 * other code derives behavior from here instead of per-provider branches.
 * Browser-API-free so anything can read it synchronously.
 */

export type ProviderId = 'google' | 'googleCloudTranslate';

/** How page translation should batch DOM text nodes for this provider, if not one node per piece. */
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
  batchingHint?: BatchingHint;
}

export const providerDescriptors: ProviderDescriptor[] = [
  {
    id: 'google',
    displayName: 'Google (free)',
    requiresKey: false,
    // Grouping gives sentence context ("She left the party"). It is safe
    // only because google.ts detects a response reflowed across `<a i=N>`
    // boundaries and repairs it with a per-node re-request.
    batchingHint: { groupByBlock: true, maxGroupChars: 2000 },
  },
  // Official Google Cloud API (user's own key/billing). No batchingHint:
  // multi-string pieces are joined with a plain separator the model has no
  // structural reason to respect.
  { id: 'googleCloudTranslate', displayName: 'Google Cloud Translation API', requiresKey: true },
];

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return providerDescriptors.find((d) => d.id === id);
}

/** `groupParagraphs` is Settings' off switch for grouping — see `Config.groupParagraphs`. */
export function getBatchingHint(id: string, groupParagraphs = true): BatchingHint | undefined {
  const hint = getProviderDescriptor(id)?.batchingHint;
  return hint && !groupParagraphs ? { ...hint, groupByBlock: false } : hint;
}

export function isProviderAvailable(id: string): boolean {
  return getProviderDescriptor(id) !== undefined;
}
