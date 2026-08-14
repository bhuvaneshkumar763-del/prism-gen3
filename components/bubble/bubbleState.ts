import { createStore, type SetStoreFunction } from 'solid-js/store';

/**
 * The bubble's reactive view state, owned by `mountBubble.ts` and passed
 * (as the store proxy itself, not spread primitives) into `FloatingBubble`.
 * `content.ts` calls the returned `setState` — via `mountBubble`'s
 * `update(patch)` — on every page-translator state change; `FloatingBubble`
 * reads `props.state.pageState` etc. directly in JSX, so Solid's own
 * fine-grained tracking re-renders just the parts that changed instead of
 * `mountBubble.ts`'s old full dispose-and-`render()`-again approach (which
 * would destroy drag state and DOM node identity on every update — see
 * `mountBubble.ts`'s header comment).
 */
export interface BubbleViewState {
  pageState: 'original' | 'translated';
  busy: boolean;
  errorMessage: string | null;
  /** `'offline'` vs `'provider'` vs `null` — see `translateLoop.ts`'s `ErrorKind`. Additive alongside `errorMessage`, not a replacement for it. */
  errorKind: 'offline' | 'provider' | null;
}

export const DEFAULT_BUBBLE_VIEW_STATE: BubbleViewState = {
  pageState: 'original',
  busy: false,
  errorMessage: null,
  errorKind: null,
};

export function createBubbleState(
  initial: BubbleViewState = DEFAULT_BUBBLE_VIEW_STATE,
): [BubbleViewState, SetStoreFunction<BubbleViewState>] {
  return createStore(initial);
}
