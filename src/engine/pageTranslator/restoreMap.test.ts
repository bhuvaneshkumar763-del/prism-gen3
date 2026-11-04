// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRestoreMap } from './restoreMap';

function entries(map: ReturnType<typeof createRestoreMap<Text, string>>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  map.forEach((value, node) => out.push([node.data, value]));
  return out;
}

describe('createRestoreMap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('keeps a pruned, detached entry for restore and makes it live again once reattached', () => {
    document.body.innerHTML = '<p>HELLO</p>';
    const p = document.querySelector('p') as HTMLElement;
    const node = p.firstChild as Text;
    const map = createRestoreMap<Text, string>();
    map.set(node, 'hello');

    p.remove();
    map.prune();
    map.prune();
    expect(map.get(node)).toBe('hello');
    expect(entries(map)).toEqual([['HELLO', 'hello']]);

    document.body.append(p);
    map.prune();
    // Parked again later, it is still listed once.
    p.remove();
    map.prune();
    expect(entries(map)).toEqual([['HELLO', 'hello']]);
  });

  it('a newer value replaces a parked one', () => {
    const node = document.createTextNode('HELLO');
    const map = createRestoreMap<Text, string>();
    map.set(node, 'hello');
    map.prune();
    map.set(node, 'goodbye');
    map.prune();
    expect(entries(map)).toEqual([['HELLO', 'goodbye']]);
  });

  it('forgets a parked entry once its node has been garbage-collected', () => {
    vi.stubGlobal(
      'WeakRef',
      class {
        deref(): undefined {
          return undefined;
        }
      },
    );
    const node = document.createTextNode('HELLO');
    const map = createRestoreMap<Text, string>();
    map.set(node, 'hello');
    map.prune();
    expect(entries(map)).toEqual([]);
  });

  it('clear() drops live and parked entries', () => {
    document.body.innerHTML = '<p>A</p>';
    const live = (document.querySelector('p') as HTMLElement).firstChild as Text;
    const detached = document.createTextNode('B');
    const map = createRestoreMap<Text, string>();
    map.set(live, 'a');
    map.set(detached, 'b');
    map.prune();
    map.clear();
    expect(entries(map)).toEqual([]);
    expect(map.has(detached)).toBe(false);
  });
});
