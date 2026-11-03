import type { ProviderId } from '../engine/providers/descriptors';
import type { ProviderConfig } from '../engine/providers/registry';
import type { PieceOutcome, TranslateBatchRequest, TranslateError, Translator } from '../engine/translator';
import { translateOne } from '../engine/translator';
import { missingProviderSetup } from '../shared/config/providerSetup';
import type { Config, ConfigKey } from '../shared/config/schema';
import type { Result } from '../shared/result';
import { cacheKeyFor, type TranslationCache } from './cache/translationCache';

/**
 * The background's translate path as plain functions: provider resolution
 * and the per-piece cache. `entrypoints/background.ts` passes in the real
 * config store, provider factory, cache and messaging.
 */

export interface ConfigReader {
  get<K extends ConfigKey>(key: K): Config[K];
}

export interface ConfigSource extends ConfigReader {
  onReady(): Promise<void>;
}

export interface ActiveProvider {
  providerId: string;
  provider: Translator | null;
}

export type ResolveProvider = () => Promise<ActiveProvider>;

export function buildProviderConfig(config: ConfigReader): ProviderConfig {
  const fields = {
    googleCloudTranslateApiKey: config.get('googleCloudTranslateApiKey'),
  };
  // "Configured" is decided by the same rule the UI uses to show "needs
  // setup" (missingProviderSetup), so the two can't disagree.
  return {
    googleCloudTranslate:
      missingProviderSetup('googleCloudTranslate', fields) === null
        ? { apiKey: fields.googleCloudTranslateApiKey }
        : undefined,
  };
}

function providerFingerprint(providerId: string, config: ProviderConfig): string {
  return JSON.stringify(config[providerId as keyof ProviderConfig] ?? null);
}

/**
 * Returns a resolver that reuses one provider instance until the provider or
 * its settings change: the batched provider's concurrency cap and in-flight
 * dedupe live in its closure, so every tab must share one instance.
 */
export function createProviderResolver(
  config: ConfigSource,
  createProvider: (id: ProviderId, config: ProviderConfig) => Translator | null,
): ResolveProvider {
  let cached: { providerId: string; fingerprint: string; provider: Translator | null } | null = null;

  return async () => {
    await config.onReady();
    const providerId = config.get('pageTranslatorProvider');
    const providerConfig = buildProviderConfig(config);
    const fingerprint = providerFingerprint(providerId, providerConfig);

    if (!cached || cached.providerId !== providerId || cached.fingerprint !== fingerprint) {
      cached = { providerId, fingerprint, provider: createProvider(providerId, providerConfig) };
    }
    return { providerId, provider: cached.provider };
  };
}

function notConfigured(providerId: string): TranslateError {
  return { kind: 'notConfigured', message: `[${providerId}] not configured or unavailable` };
}

/** `translateText` (selection popup, title translator): one string, deliberately not cached. */
export async function translateTextWithProvider(
  resolveProvider: ResolveProvider,
  data: { text: string; sourceLanguage: string; targetLanguage: string },
): Promise<Result<string, TranslateError>> {
  const { providerId, provider } = await resolveProvider();
  if (!provider) {
    return { ok: false, error: notConfigured(providerId) };
  }
  return translateOne(provider, data.text, data.sourceLanguage, data.targetLanguage);
}

/** The parts of a `runtime.MessageSender` this path reads. */
export interface PieceRequestSender {
  tab?: { id?: number; incognito?: boolean };
  frameId?: number;
}

export interface PieceTranslationDeps {
  resolveProvider: ResolveProvider;
  config: ConfigReader;
  cache: Pick<TranslationCache, 'getMany' | 'setMany'>;
  /** Sends one `translatePiecesProgress` notification to the requesting frame. */
  sendProgress: (
    data: { requestId: number; index: number; outcome: PieceOutcome },
    target: { tabId: number; frameId: number | undefined },
  ) => Promise<unknown>;
}

export async function translatePiecesWithCache(
  data: TranslateBatchRequest & { requestId: number },
  sender: PieceRequestSender,
  deps: PieceTranslationDeps,
): Promise<PieceOutcome[]> {
  const { providerId, provider } = await deps.resolveProvider();
  const { sourceLanguage, targetLanguage, pieces, requestId } = data;

  if (!provider) {
    const error = notConfigured(providerId);
    return pieces.map(() => ({ ok: false, error }));
  }

  // One worker serves normal and incognito windows ("spanning" mode), so an
  // incognito translate skips the cache entirely: it neither writes page text
  // into the normal profile's IndexedDB nor reads from it.
  const cacheEnabled = deps.config.get('translationCacheEnabled') && !sender.tab?.incognito;
  const pieceKeys = pieces.map((piece) =>
    cacheKeyFor(providerId, sourceLanguage, targetLanguage, JSON.stringify(piece)),
  );
  // The cache is only an optimization: a failed read or unparseable entry is
  // a miss, and a failed write is a no-op. getMany() reads every key in one
  // IndexedDB transaction.
  const rawCachedValues = cacheEnabled
    ? await deps.cache.getMany(pieceKeys).catch((e) => {
        console.warn('[prism] translation cache read failed, treating every piece as a cache miss', e);
        return pieces.map(() => null);
      })
    : pieces.map(() => null);
  const cachedValues: Array<string[] | null> = rawCachedValues.map((raw) => {
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as string[];
    } catch (e) {
      console.warn('[prism] cached entry failed to parse, treating as a cache miss', e);
      return null;
    }
  });

  const missingIndices: number[] = [];
  pieces.forEach((_, i) => {
    if (cachedValues[i] === null) missingIndices.push(i);
  });

  let freshOutcomes: PieceOutcome[] = [];
  if (missingIndices.length > 0) {
    const missingPieces = missingIndices
      .map((i) => pieces[i])
      .filter((p): p is (typeof pieces)[number] => p !== undefined);
    // Streams each fresh piece back to the requesting frame as it resolves
    // (a callback can't cross the messaging boundary; see remoteTranslator.ts).
    // `missingIndices` maps it back to the original request's index.
    // Best-effort: the returned outcomes still carry every piece.
    const tabId = sender.tab?.id;
    freshOutcomes = await provider.translateBatch({
      sourceLanguage,
      targetLanguage,
      pieces: missingPieces,
      onPieceComplete:
        tabId === undefined
          ? undefined
          : (missingIdx, outcome) => {
              const index = missingIndices[missingIdx];
              if (index === undefined) return;
              void deps.sendProgress({ requestId, index, outcome }, { tabId, frameId: sender.frameId }).catch(() => {
                // Tab/frame gone; the final reply still carries this piece.
              });
            },
    });
  }

  // O(1) lookup per piece instead of indexOf(); on a cold or disabled cache
  // every piece is missing.
  const missingIdxByPiece = new Map(missingIndices.map((i, idx) => [i, idx]));

  const outcomes: PieceOutcome[] = pieces.map((_, i) => {
    const cached = cachedValues[i];
    if (cached !== null && cached !== undefined) return { ok: true, value: cached };
    const missingIdx = missingIdxByPiece.get(i);
    const fresh = missingIdx !== undefined ? freshOutcomes[missingIdx] : undefined;
    return fresh ?? { ok: false, error: { kind: 'badResponse', message: 'no result for this piece' } };
  });

  if (cacheEnabled) {
    // setMany(): one transaction and one eviction pass for all fresh pieces.
    const freshEntries = missingIndices
      .map((i, idx) => {
        const outcome = freshOutcomes[idx];
        const key = pieceKeys[i];
        return outcome?.ok && key ? { key, value: JSON.stringify(outcome.value) } : null;
      })
      .filter((e): e is { key: string; value: string } => e !== null);
    // Not awaited: the reply the page is waiting on shouldn't sit behind the
    // IndexedDB commit and eviction.
    void deps.cache.setMany(freshEntries).catch((e) => {
      console.warn('[prism] translation cache write failed, continuing without caching these pieces', e);
    });
  }

  return outcomes;
}
