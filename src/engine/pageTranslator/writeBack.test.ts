// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PieceSlot } from './grouping';
import { createRestoreLedger, createSlotWriter, type SlotWriterDeps } from './writeBack';

function deps(): SlotWriterDeps & { requeued: Text[]; translated: Array<[string, number]> } {
  const requeued: Text[] = [];
  const translated: Array<[string, number]> = [];
  return {
    ledger: createRestoreLedger(),
    noteOwnWrite: vi.fn(),
    requeue: (node) => requeued.push(node),
    onTranslated: (node, chars) => translated.push([node.data, chars]),
    requeued,
    translated,
  };
}

function single(node: Text): PieceSlot {
  return { nodes: [node], separators: [], text: node.data };
}

describe('createSlotWriter', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes a translation with the boundary text the provider dropped, and reports the source length', () => {
    document.body.innerHTML = '<p>. Read more </p>';
    const node = (document.querySelector('p') as HTMLElement).firstChild as Text;
    const d = deps();
    const writeSlot = createSlotWriter([[single(node)]], d);
    writeSlot(single(node), 'LIRE PLUS');
    expect(node.data).toBe('. LIRE PLUS ');
    expect(d.noteOwnWrite).toHaveBeenCalledWith(node, '. LIRE PLUS ');
    expect(d.translated).toEqual([['. LIRE PLUS ', '. Read more'.length]]);
    // Writing the same slot again (the tick's final loop) is harmless.
    writeSlot(single(node), 'LIRE PLUS');
    expect(node.data).toBe('. LIRE PLUS ');
    expect(d.requeued).toEqual([]);
  });

  it('requeues instead of writing when the page changed the node while it was in flight', () => {
    document.body.innerHTML = '<p>score 1</p>';
    const node = (document.querySelector('p') as HTMLElement).firstChild as Text;
    const d = deps();
    const slot = single(node);
    const writeSlot = createSlotWriter([[slot]], d);
    node.data = 'score 2';
    writeSlot(slot, 'SCORE 1');
    expect(node.data).toBe('score 2');
    expect(d.requeued).toEqual([node]);
    expect(d.translated).toEqual([]);
  });

  it('writes a word run into its first word, empties the rest into the ledger, and requeues a run the page changed', () => {
    document.body.innerHTML = '<div><i>một</i> <i>hai</i>.</div>';
    const [one, two] = Array.from(document.querySelectorAll('i'), (el) => el.firstChild as Text) as [Text, Text];
    const div = document.querySelector('div') as HTMLElement;
    const space = div.childNodes[1] as Text;
    const stop = div.childNodes[3] as Text;
    const slot: PieceSlot = { nodes: [one, two], separators: [space, stop], text: 'một hai.' };
    const d = deps();
    // The loop records every queued node; the writer adds the separators it empties.
    d.ledger.reset([one, two]);
    createSlotWriter([[slot]], d)(slot, 'one two.');
    expect(div.textContent).toBe('one two.');
    expect(d.translated.map(([, chars]) => chars)).toEqual([3, 3]);
    d.ledger.restoreAll((node, text) => {
      node.data = text;
    });
    expect(div.innerHTML).toBe('<i>một</i> <i>hai</i>.');

    const changed = deps();
    const writeChanged = createSlotWriter([[slot]], changed);
    two.data = 'ba';
    writeChanged(slot, 'one two.');
    expect(div.textContent).toBe('một ba.');
    expect(changed.requeued).toEqual([one, two]);
  });
});

describe('createRestoreLedger', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('restores originals, finds a translated node by its parent, and lists entries', () => {
    document.body.innerHTML = '<p>hello</p>';
    const p = document.querySelector('p') as HTMLElement;
    const node = p.firstChild as Text;
    const ledger = createRestoreLedger();
    ledger.reset([node]);
    expect(ledger.findOriginalTextForElement(p)).toBeNull();
    node.data = 'HOLA';
    expect(ledger.findOriginalTextForElement(p)).toBe('hello');
    expect(ledger.entries()).toEqual([{ node, original: 'hello' }]);
    const noteOwnWrite = vi.fn();
    ledger.restoreAll(noteOwnWrite);
    expect(node.data).toBe('hello');
    expect(noteOwnWrite).toHaveBeenCalledWith(node, 'hello');
    expect(ledger.entries()).toEqual([]);
  });

  it('prunes a node only after two consecutive disconnected checks', () => {
    document.body.innerHTML = '<p>hello</p>';
    const node = (document.querySelector('p') as HTMLElement).firstChild as Text;
    const ledger = createRestoreLedger();
    ledger.record(node);
    node.parentElement?.remove();
    ledger.prune();
    expect(ledger.has(node)).toBe(true);
    ledger.prune();
    expect(ledger.has(node)).toBe(false);
  });
});
