import { untranslatedShareWarning } from './errorState';

/**
 * A translate cycle's "done of total", and its character accounting for the
 * untranslated-share warning. `total` counts every node that entered the
 * queue this cycle, including ones found after it started (an AJAX chapter),
 * so `done` never passes it. Each counts a node once, however often it's
 * written or requeued.
 */
export function createProgress(onChange: (done: number, total: number) => void) {
  let counted = new WeakSet<Text>();
  let total = 0;
  let completed = new WeakSet<Text>();
  let done = 0;
  /** Pieces given up on (echoed back or left out 3 times). */
  let givenUp = new Set<Text>();
  let translatedChars = 0;
  /** Coalesces a resolved batch's burst of completions into one notification per microtask drain. */
  let notifyScheduled = false;

  function notify(): void {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      onChange(done, total);
    });
  }

  function track(node: Text): void {
    if (counted.has(node)) return;
    counted.add(node);
    total++;
    notify();
  }

  return {
    /** Counts a node into this cycle's total the first time it's queued. */
    track,
    /**
     * A node's translation was written; `sourceChars` is the length of the
     * text it replaced, for the translated side of the warning's share.
     */
    translated(node: Text, sourceChars: number): void {
      givenUp.delete(node);
      if (completed.has(node)) return;
      track(node);
      completed.add(node);
      done++;
      translatedChars += sourceChars;
      notify();
    },
    gaveUp(node: Text): void {
      givenUp.add(node);
    },
    /** The untranslated-share warning for the given-up nodes still on the page, or `null`. */
    untranslatedWarning(): string | null {
      let untranslatedChars = 0;
      for (const node of givenUp) {
        if (node.isConnected) untranslatedChars += node.data.trim().length;
        else givenUp.delete(node);
      }
      return untranslatedShareWarning(untranslatedChars, translatedChars);
    },
    reset(): void {
      counted = new WeakSet<Text>();
      total = 0;
      completed = new WeakSet<Text>();
      done = 0;
      givenUp = new Set<Text>();
      translatedChars = 0;
      notify();
    },
  };
}

export type Progress = ReturnType<typeof createProgress>;
