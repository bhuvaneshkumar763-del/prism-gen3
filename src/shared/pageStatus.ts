import type { ErrorKind, PageLanguageState } from '../engine/pageTranslator/translateLoop';

/** The three things the popup asks the page when it opens, as plain async calls so this stays testable without a browser. */
export interface PageStatusQueries {
  getPageState(): Promise<PageLanguageState>;
  getOriginalLanguage(): Promise<string>;
  getPageError(): Promise<{ message: string; kind: ErrorKind } | null>;
}

export interface PageStatus {
  /** False when the page couldn't answer at all — there is no Prism content script in that tab. */
  reachable: boolean;
  pageState: PageLanguageState | null;
  originalLanguage: string | null;
  error: { message: string; kind: ErrorKind } | null;
}

/**
 * Asks the page all three questions concurrently.
 *
 * Speed fix, found via a UI audit: the popup used to await each round trip
 * before starting the next, so opening it cost three sequential round trips
 * to the page, and a hung page could cost three full timeouts in a row.
 * They're independent, so they now cost one.
 *
 * `allSettled`, not `all`: one question failing (a language detector that
 * times out) must not throw away the other two answers. The old code had
 * the same flaw in a different shape — a single `try` around all three, so
 * any failure silently skipped whatever came after it.
 *
 * Reachability is judged by `getPageState` alone: it's the cheapest question
 * and the one every Prism content script answers, so its failure is what
 * "no Prism in this tab" actually looks like.
 */
export async function loadPageStatus(queries: PageStatusQueries): Promise<PageStatus> {
  const [state, language, error] = await Promise.allSettled([
    queries.getPageState(),
    queries.getOriginalLanguage(),
    queries.getPageError(),
  ]);
  return {
    reachable: state.status === 'fulfilled',
    pageState: state.status === 'fulfilled' ? state.value : null,
    originalLanguage: language.status === 'fulfilled' ? language.value : null,
    error: error.status === 'fulfilled' ? error.value : null,
  };
}
