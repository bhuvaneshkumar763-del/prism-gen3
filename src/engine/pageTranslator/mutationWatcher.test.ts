// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMutationWatcher } from './mutationWatcher';

function flushMutations(): Promise<void> {
  // MutationObserver callbacks run as a microtask — a real await tick is
  // enough for happy-dom's implementation to have delivered the records.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createMutationWatcher', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports newly added nodes via onNewRoot', async () => {
    document.body.innerHTML = '';
    const onNewRoot = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot,
      onChangedTextNode: vi.fn(),
    });
    watcher.enable();

    const p = document.createElement('p');
    p.textContent = 'New content';
    document.body.append(p);
    await flushMutations();

    expect(onNewRoot).toHaveBeenCalledWith(p);
    watcher.disable();
  });

  it('does not report added nodes matching isNoTranslateNode', async () => {
    const onNewRoot = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: (node) => (node as Element).tagName === 'SCRIPT',
      onNewRoot,
      onChangedTextNode: vi.fn(),
    });
    watcher.enable();

    const script = document.createElement('script');
    document.body.append(script);
    await flushMutations();

    expect(onNewRoot).not.toHaveBeenCalled();
    watcher.disable();
  });

  it('reports a direct text-node data change via onChangedTextNode when translated', async () => {
    document.body.innerHTML = '<p>original</p>';
    const textNode = document.body.querySelector('p')?.firstChild as Text;
    const onChangedTextNode = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode,
    });
    watcher.enable();

    textNode.data = 'changed by the site';
    await flushMutations();

    expect(onChangedTextNode).toHaveBeenCalledWith(textNode);
    watcher.disable();
  });

  it('does not report a characterData change as external when it matches the last noted own write', async () => {
    document.body.innerHTML = '<p>original</p>';
    const textNode = document.body.querySelector('p')?.firstChild as Text;
    const onChangedTextNode = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode,
    });
    watcher.enable();

    watcher.noteOwnWrite(textNode, 'our translation');
    textNode.data = 'our translation';
    await flushMutations();

    expect(onChangedTextNode).not.toHaveBeenCalled();
    watcher.disable();
  });

  it('ignores characterData changes while not translated', async () => {
    document.body.innerHTML = '<p>original</p>';
    const textNode = document.body.querySelector('p')?.firstChild as Text;
    const onChangedTextNode = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => false,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode,
    });
    watcher.enable();

    textNode.data = 'changed while original';
    await flushMutations();

    expect(onChangedTextNode).not.toHaveBeenCalled();
    watcher.disable();
  });

  it('runs onRescan on the given interval while enabled, and stops after disable()', () => {
    vi.useFakeTimers();
    const onRescan = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode: vi.fn(),
    });
    watcher.enable(500, onRescan);

    vi.advanceTimersByTime(1500);
    expect(onRescan).toHaveBeenCalledTimes(3);

    watcher.disable();
    vi.advanceTimersByTime(1500);
    expect(onRescan).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('disable() is safe to call before enable()', () => {
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode: vi.fn(),
    });
    expect(() => watcher.disable()).not.toThrow();
  });

  it('reports every changed node in a single batch, not just the first 25 (no silent drop)', async () => {
    document.body.innerHTML = '';
    const textNodes: Text[] = [];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('p');
      p.textContent = `original ${i}`;
      document.body.append(p);
      const t = p.firstChild as Text;
      textNodes.push(t);
    }
    const onChangedTextNode = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode,
    });
    watcher.enable();
    await flushMutations();
    onChangedTextNode.mockClear();

    // A single synchronous render pass mutating more than the old 25-node
    // cap, all in one MutationObserver callback.
    textNodes.forEach((t, i) => {
      t.data = `changed ${i}`;
    });
    await flushMutations();

    expect(onChangedTextNode).toHaveBeenCalledTimes(40);
    watcher.disable();
  });

  it('skips the periodic onRescan tick when the observer already fired in that window', async () => {
    document.body.innerHTML = '<p>original</p>';
    const textNode = document.body.querySelector('p')?.firstChild as Text;
    const onRescan = vi.fn();
    const watcher = createMutationWatcher({
      isTranslated: () => true,
      isNoTranslateNode: () => false,
      onNewRoot: vi.fn(),
      onChangedTextNode: vi.fn(),
    });

    vi.useFakeTimers();
    try {
      watcher.enable(500, onRescan);

      textNode.data = 'changed by the site';
      await vi.advanceTimersByTimeAsync(0); // flush the observer's microtask-scheduled callback
      await vi.advanceTimersByTimeAsync(500); // first periodic tick
      // The observer already reported this exact change — the periodic tick
      // has nothing new to catch, so onRescan should be skipped for it.
      expect(onRescan).not.toHaveBeenCalled();

      // A second window with no further mutation fires normally.
      await vi.advanceTimersByTimeAsync(500);
      expect(onRescan).toHaveBeenCalledTimes(1);

      watcher.disable();
    } finally {
      vi.useRealTimers();
    }
  });
});
