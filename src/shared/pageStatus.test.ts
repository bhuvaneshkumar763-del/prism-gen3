import { describe, expect, it } from 'vitest';
import { loadPageStatus, type PageStatusQueries } from './pageStatus';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('loadPageStatus', () => {
  it('asks all three questions at once, not one after another — real speed bug this closed, found via a UI audit: the popup awaited each round trip to the page before starting the next, so a fully populated popup cost three sequential round trips, and a hung page cost up to three full timeouts', async () => {
    const state = deferred<'original' | 'translated'>();
    const language = deferred<string>();
    const error = deferred<null>();
    const started: string[] = [];
    const queries: PageStatusQueries = {
      getPageState: () => {
        started.push('state');
        return state.promise;
      },
      getOriginalLanguage: () => {
        started.push('language');
        return language.promise;
      },
      getPageError: () => {
        started.push('error');
        return error.promise;
      },
    };

    const pending = loadPageStatus(queries);
    // Nothing has resolved yet, and every question is already in flight.
    expect(started).toEqual(['state', 'language', 'error']);

    state.resolve('translated');
    language.resolve('vi');
    error.resolve(null);
    await expect(pending).resolves.toEqual({
      reachable: true,
      pageState: 'translated',
      originalLanguage: 'vi',
      error: null,
    });
  });

  it("keeps the other answers when one question fails, instead of throwing all three away — which is what a plain Promise.all, or the old code's single catch, did", async () => {
    const status = await loadPageStatus({
      getPageState: async () => 'original',
      getOriginalLanguage: async () => {
        throw new Error('detector timed out');
      },
      getPageError: async () => ({ message: 'Provider down', kind: 'provider' }),
    });

    expect(status).toEqual({
      reachable: true,
      pageState: 'original',
      originalLanguage: null,
      error: { message: 'Provider down', kind: 'provider' },
    });
  });

  it('reports the page as unreachable when it cannot answer at all — no Prism content script in that tab', async () => {
    const noReceiver = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    const status = await loadPageStatus({
      getPageState: noReceiver,
      getOriginalLanguage: noReceiver,
      getPageError: noReceiver,
    });

    expect(status.reachable).toBe(false);
  });
});
