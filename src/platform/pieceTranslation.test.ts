import { describe, expect, it, vi } from 'vitest';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../engine/translator';
import type { Config, ConfigKey } from '../shared/config/schema';
import { defaultConfig } from '../shared/config/schema';
import { cacheKeyFor } from './cache/translationCache';
import {
  buildProviderConfig,
  createProviderResolver,
  type PieceTranslationDeps,
  translatePiecesWithCache,
  translateTextWithProvider,
} from './pieceTranslation';

function fakeConfig(overrides: Partial<Config> = {}) {
  const state: Config = { ...defaultConfig, ...overrides };
  return {
    state,
    onReady: vi.fn(async () => {}),
    get<K extends ConfigKey>(key: K): Config[K] {
      return state[key];
    },
  };
}

/** Echoes each piece uppercased, and reports each one through onPieceComplete like the real batched provider. */
function fakeProvider() {
  const requests: TranslateBatchRequest[] = [];
  const provider: Translator = {
    translateBatch: vi.fn(async (request: TranslateBatchRequest) => {
      requests.push(request);
      const outcomes: PieceOutcome[] = request.pieces.map((piece) => ({
        ok: true,
        value: piece.map((s) => s.toUpperCase()),
      }));
      outcomes.forEach((outcome, i) => {
        request.onPieceComplete?.(i, outcome);
      });
      return outcomes;
    }),
  };
  return { provider, requests };
}

function fakeCache(stored: Record<string, string> = {}) {
  return {
    stored,
    getMany: vi.fn(async (keys: string[]) => keys.map((k) => stored[k] ?? null)),
    setMany: vi.fn(async (entries: Array<{ key: string; value: string }>) => {
      for (const { key, value } of entries) stored[key] = value;
    }),
  };
}

const TAB_SENDER = { tab: { id: 7, incognito: false }, frameId: 3 };

function request(pieces: string[][], requestId = 1) {
  return { sourceLanguage: 'zh', targetLanguage: 'en', pieces, requestId };
}

function deps(
  options: {
    provider?: Translator | null;
    config?: PieceTranslationDeps['config'];
    cache?: ReturnType<typeof fakeCache>;
    resolveProvider?: PieceTranslationDeps['resolveProvider'];
  } = {},
) {
  const provider = options.provider === undefined ? fakeProvider().provider : options.provider;
  return {
    resolveProvider: options.resolveProvider ?? (async () => ({ providerId: 'google', provider })),
    config: options.config ?? fakeConfig(),
    cache: options.cache ?? fakeCache(),
    sendProgress: vi.fn(async (_data: unknown, _target: unknown) => {}),
  } satisfies PieceTranslationDeps;
}

const keyFor = (piece: string[]) => cacheKeyFor('google', 'zh', 'en', JSON.stringify(piece));

describe('buildProviderConfig', () => {
  it('configures Cloud Translate only with a non-blank API key', () => {
    expect(buildProviderConfig(fakeConfig({ googleCloudTranslateApiKey: 'k1' }))).toEqual({
      googleCloudTranslate: { apiKey: 'k1' },
    });
    expect(buildProviderConfig(fakeConfig({ googleCloudTranslateApiKey: '   ' }))).toEqual({
      googleCloudTranslate: undefined,
    });
  });
});

describe('createProviderResolver', () => {
  it('waits for the config to load before reading the provider id', async () => {
    const config = fakeConfig();
    let ready = false;
    config.onReady.mockImplementation(async () => {
      ready = true;
    });
    const create = vi.fn(() => {
      expect(ready).toBe(true);
      return fakeProvider().provider;
    });
    await createProviderResolver(config, create)();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reuses one provider instance while the provider and its settings are unchanged', async () => {
    const config = fakeConfig();
    const create = vi.fn(() => fakeProvider().provider);
    const resolve = createProviderResolver(config, create);
    const first = await resolve();
    const second = await resolve();
    expect(create).toHaveBeenCalledTimes(1);
    expect(second.provider).toBe(first.provider);
    expect(first.providerId).toBe('google');
  });

  it("reuses a null provider too, so an unconfigured provider isn't rebuilt on every call", async () => {
    const config = fakeConfig({ pageTranslatorProvider: 'googleCloudTranslate' });
    const create = vi.fn(() => null);
    const resolve = createProviderResolver(config, create);
    expect((await resolve()).provider).toBeNull();
    await resolve();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the provider id changes', async () => {
    const config = fakeConfig();
    const create = vi.fn(() => fakeProvider().provider);
    const resolve = createProviderResolver(config, create);
    await resolve();
    config.state.pageTranslatorProvider = 'googleCloudTranslate';
    config.state.googleCloudTranslateApiKey = 'k1';
    const next = await resolve();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith('googleCloudTranslate', {
      googleCloudTranslate: { apiKey: 'k1' },
    });
    expect(next.providerId).toBe('googleCloudTranslate');
  });

  it("rebuilds when the active provider's own settings change, but not for another provider's", async () => {
    const config = fakeConfig({ pageTranslatorProvider: 'googleCloudTranslate', googleCloudTranslateApiKey: 'k1' });
    const create = vi.fn(() => fakeProvider().provider);
    const resolve = createProviderResolver(config, create);
    await resolve();
    config.state.googleCloudTranslateApiKey = 'k2';
    await resolve();
    expect(create).toHaveBeenCalledTimes(2);

    config.state.pageTranslatorProvider = 'google';
    await resolve();
    config.state.googleCloudTranslateApiKey = 'k3';
    await resolve();
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe('translateTextWithProvider', () => {
  it("returns a 'notConfigured' error naming the provider when it is unavailable, not a network error", async () => {
    const result = await translateTextWithProvider(
      async () => ({ providerId: 'googleCloudTranslate', provider: null }),
      {
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'notConfigured', message: '[googleCloudTranslate] not configured or unavailable' },
    });
  });

  it('translates one string through the provider', async () => {
    const { provider, requests } = fakeProvider();
    const result = await translateTextWithProvider(async () => ({ providerId: 'google', provider }), {
      text: 'hi',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    });
    expect(result).toEqual({ ok: true, value: 'HI' });
    expect(requests[0]).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'fr', pieces: [['hi']] });
  });
});

describe('translatePiecesWithCache', () => {
  it("fails every piece with a 'notConfigured' error, without touching the cache, when the provider is unavailable", async () => {
    const d = deps({ provider: null });
    const outcomes = await translatePiecesWithCache(request([['a'], ['b']]), TAB_SENDER, d);
    const error = { kind: 'notConfigured', message: '[google] not configured or unavailable' };
    expect(outcomes).toEqual([
      { ok: false, error },
      { ok: false, error },
    ]);
    expect(d.cache.getMany).not.toHaveBeenCalled();
    expect(d.cache.setMany).not.toHaveBeenCalled();
  });

  it('keys each piece by provider, language pair and the JSON of the piece', async () => {
    const d = deps();
    await translatePiecesWithCache(request([['a', 'b'], ['c']]), TAB_SENDER, d);
    expect(d.cache.getMany).toHaveBeenCalledWith([keyFor(['a', 'b']), keyFor(['c'])]);
  });

  it('serves cached pieces from the cache and sends only the misses to the provider, in order', async () => {
    const { provider, requests } = fakeProvider();
    const cache = fakeCache({ [keyFor(['b'])]: JSON.stringify(['cached-b']) });
    const outcomes = await translatePiecesWithCache(
      request([['a'], ['b'], ['c']]),
      TAB_SENDER,
      deps({ provider, cache }),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pieces).toEqual([['a'], ['c']]);
    expect(outcomes).toEqual([
      { ok: true, value: ['A'] },
      { ok: true, value: ['cached-b'] },
      { ok: true, value: ['C'] },
    ]);
  });

  it("doesn't call the provider when every piece is cached", async () => {
    const { provider, requests } = fakeProvider();
    const cache = fakeCache({ [keyFor(['a'])]: JSON.stringify(['x']) });
    const outcomes = await translatePiecesWithCache(request([['a']]), TAB_SENDER, deps({ provider, cache }));
    expect(requests).toHaveLength(0);
    expect(outcomes).toEqual([{ ok: true, value: ['x'] }]);
  });

  it('passes the language pair through to the provider', async () => {
    const { provider, requests } = fakeProvider();
    await translatePiecesWithCache(request([['a']]), TAB_SENDER, deps({ provider }));
    expect(requests[0]).toMatchObject({ sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it('writes only the successful fresh pieces back, JSON-encoded, in one setMany call', async () => {
    const provider: Translator = {
      translateBatch: async () => [
        { ok: true, value: ['A'] },
        { ok: false, error: { kind: 'network', message: 'down' } },
      ],
    };
    const d = deps({ provider });
    await translatePiecesWithCache(request([['a'], ['b']]), TAB_SENDER, d);
    expect(d.cache.setMany).toHaveBeenCalledTimes(1);
    expect(d.cache.setMany).toHaveBeenCalledWith([{ key: keyFor(['a']), value: JSON.stringify(['A']) }]);
  });

  it("doesn't wait for the cache write before replying, and a failed write doesn't fail the reply", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    d.cache.setMany.mockImplementation(() => new Promise(() => {}));
    await expect(translatePiecesWithCache(request([['a']]), TAB_SENDER, d)).resolves.toEqual([
      { ok: true, value: ['A'] },
    ]);

    d.cache.setMany.mockImplementation(async () => {
      throw new Error('quota');
    });
    await expect(translatePiecesWithCache(request([['a']]), TAB_SENDER, d)).resolves.toEqual([
      { ok: true, value: ['A'] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips the cache entirely when caching is turned off in settings', async () => {
    const d = deps({ config: fakeConfig({ translationCacheEnabled: false }) });
    const outcomes = await translatePiecesWithCache(request([['a']]), TAB_SENDER, d);
    expect(outcomes).toEqual([{ ok: true, value: ['A'] }]);
    expect(d.cache.getMany).not.toHaveBeenCalled();
    expect(d.cache.setMany).not.toHaveBeenCalled();
  });

  it('skips the cache entirely for an incognito tab, neither reading nor writing', async () => {
    const d = deps();
    d.cache.stored[keyFor(['a'])] = JSON.stringify(['from-normal-profile']);
    const outcomes = await translatePiecesWithCache(
      request([['a']]),
      { tab: { id: 7, incognito: true }, frameId: 0 },
      d,
    );
    expect(outcomes).toEqual([{ ok: true, value: ['A'] }]);
    expect(d.cache.getMany).not.toHaveBeenCalled();
    expect(d.cache.setMany).not.toHaveBeenCalled();
  });

  it('treats a failed cache read as all misses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    d.cache.getMany.mockRejectedValue(new Error('idb gone'));
    const outcomes = await translatePiecesWithCache(request([['a'], ['b']]), TAB_SENDER, d);
    expect(outcomes).toEqual([
      { ok: true, value: ['A'] },
      { ok: true, value: ['B'] },
    ]);
    warn.mockRestore();
  });

  it('treats an unparseable cached entry as a miss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { provider, requests } = fakeProvider();
    const cache = fakeCache({ [keyFor(['a'])]: '{not json' });
    const outcomes = await translatePiecesWithCache(request([['a']]), TAB_SENDER, deps({ provider, cache }));
    expect(requests[0]?.pieces).toEqual([['a']]);
    expect(outcomes).toEqual([{ ok: true, value: ['A'] }]);
    warn.mockRestore();
  });

  it('reports a bad response for a missing piece the provider returned no outcome for', async () => {
    const provider: Translator = { translateBatch: async () => [{ ok: true, value: ['A'] }] };
    const outcomes = await translatePiecesWithCache(request([['a'], ['b']]), TAB_SENDER, deps({ provider }));
    expect(outcomes[1]).toEqual({ ok: false, error: { kind: 'badResponse', message: 'no result for this piece' } });
  });

  it("relays each fresh piece to the requesting tab and frame under the original request's index", async () => {
    const cache = fakeCache({ [keyFor(['a'])]: JSON.stringify(['x']) });
    const d = deps({ cache });
    await translatePiecesWithCache(request([['a'], ['b'], ['c']], 42), TAB_SENDER, d);
    expect(d.sendProgress.mock.calls).toEqual([
      [
        { requestId: 42, index: 1, outcome: { ok: true, value: ['B'] } },
        { tabId: 7, frameId: 3 },
      ],
      [
        { requestId: 42, index: 2, outcome: { ok: true, value: ['C'] } },
        { tabId: 7, frameId: 3 },
      ],
    ]);
  });

  it('ignores a failed progress send (tab or frame gone): the reply still carries every piece', async () => {
    const d = deps();
    d.sendProgress.mockRejectedValue(new Error('no receiver'));
    await expect(translatePiecesWithCache(request([['a']]), TAB_SENDER, d)).resolves.toEqual([
      { ok: true, value: ['A'] },
    ]);
  });

  it('sends no progress callback when the sender has no tab', async () => {
    const { provider, requests } = fakeProvider();
    const d = deps({ provider });
    await translatePiecesWithCache(request([['a']]), { frameId: 0 }, d);
    expect(requests[0]?.onPieceComplete).toBeUndefined();
    expect(d.sendProgress).not.toHaveBeenCalled();
  });

  it('reads the cache setting after the provider (and so the config) is ready', async () => {
    const config = fakeConfig();
    const order: string[] = [];
    const d = deps({
      config: {
        ...config,
        get: <K extends ConfigKey>(key: K) => {
          order.push(`get:${key}`);
          return config.get(key);
        },
      },
      resolveProvider: async () => {
        order.push('resolve');
        return { providerId: 'google', provider: fakeProvider().provider };
      },
    });
    await translatePiecesWithCache(request([['a']]), TAB_SENDER, d);
    expect(order).toEqual(['resolve', 'get:translationCacheEnabled']);
  });
});
