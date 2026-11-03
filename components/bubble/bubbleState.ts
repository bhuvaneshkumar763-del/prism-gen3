import { createStore, type SetStoreFunction } from 'solid-js/store';

/**
 * The bubble's reactive view state, owned by `mountBubble.ts` and passed into
 * `FloatingBubble` as the store proxy itself (not spread primitives), so JSX
 * reads track fine-grained and `update(patch)` never re-renders the tree.
 */
export interface BubbleViewState {
  pageState: 'original' | 'translated';
  busy: boolean;
  errorMessage: string | null;
  /** See `translateLoop.ts`'s `ErrorKind`; set alongside `errorMessage`, not instead of it. */
  errorKind: 'offline' | 'provider' | null;
  /**
   * `done/total` (0-1) from `translateLoop.ts`'s `onProgressChange`, or `null`
   * until the cycle's total is known. Can settle short of 1 on a finished
   * translate, so the progress bar hides on `busy`, not on `progress === 1`.
   */
  progress: number | null;
  /** The page's detected language ('und' until known) — for "Vietnamese → English" in the panel title. */
  originalLanguage: string;
}

export const DEFAULT_BUBBLE_VIEW_STATE: BubbleViewState = {
  pageState: 'original',
  busy: false,
  errorMessage: null,
  errorKind: null,
  progress: null,
  originalLanguage: 'und',
};

export function createBubbleState(
  initial: BubbleViewState = DEFAULT_BUBBLE_VIEW_STATE,
): [BubbleViewState, SetStoreFunction<BubbleViewState>] {
  return createStore(initial);
}
