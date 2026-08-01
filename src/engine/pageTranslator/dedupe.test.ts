import { describe, expect, it } from 'vitest';
import { createDedupeTracker } from './dedupe';

describe('createDedupeTracker', () => {
  it('reports untracked nodes as untracked', () => {
    const tracker = createDedupeTracker();
    expect(tracker.isTracked({} as Node)).toBe(false);
  });

  it('tracks nodes passed to track()', () => {
    const tracker = createDedupeTracker();
    const node = {} as Node;
    tracker.track([node]);
    expect(tracker.isTracked(node)).toBe(true);
  });

  it('tracks multiple nodes from one iterable', () => {
    const tracker = createDedupeTracker();
    const a = {} as Node;
    const b = {} as Node;
    tracker.track([a, b]);
    expect(tracker.isTracked(a)).toBe(true);
    expect(tracker.isTracked(b)).toBe(true);
  });

  it('reset() forgets all previously tracked nodes', () => {
    const tracker = createDedupeTracker();
    const node = {} as Node;
    tracker.track([node]);
    tracker.reset();
    expect(tracker.isTracked(node)).toBe(false);
  });
});
