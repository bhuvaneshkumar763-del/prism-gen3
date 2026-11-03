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
 * Asks the page all three questions concurrently, so a hung page costs one
 * timeout, not three. `allSettled` so one failure doesn't discard the other
 * answers. Reachability is judged by `getPageState` alone: every Prism
 * content script answers it, so its failure means "no Prism in this tab".
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
