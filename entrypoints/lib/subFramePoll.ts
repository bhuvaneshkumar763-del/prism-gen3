export interface PollOptions {
  /** Applies the top frame's decision; resolves false while there is none yet. */
  sync: () => Promise<boolean>;
  maxAttempts: number;
  intervalMs: number;
  /** Called once, after the first attempt finds no decision. */
  onFirstWait?: () => void;
  onError: (e: unknown) => void;
}

/**
 * A sub-frame's bounded wait for the top frame's decision. A failure ends the
 * poll (after an extension update every later call fails the same way) and
 * goes to `onError`, so the page never sees an unhandled rejection.
 */
export async function pollForFrameDecision(options: PollOptions): Promise<void> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      if (await options.sync()) return;
    } catch (e) {
      options.onError(e);
      return;
    }
    if (attempt === 0) options.onFirstWait?.();
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
