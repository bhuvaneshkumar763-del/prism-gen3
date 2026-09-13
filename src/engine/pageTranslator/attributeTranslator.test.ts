// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../shared/result';
import type { PieceOutcome, Translator } from '../translator';
import { createAttributeTranslator, pruneDisconnectedAttributeEntries } from './attributeTranslator';

const translateBatch = vi.fn<Translator['translateBatch']>();
const translator: Translator = { translateBatch };

/** Uppercases every piece's single string — deterministic, easy to assert on. */
function uppercaseOnce(): void {
  translateBatch.mockImplementationOnce(async (request) =>
    request.pieces.map((piece): PieceOutcome => ok([piece[0]?.toUpperCase() ?? ''])),
  );
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A translator's start() leaves a live MutationObserver on document.body
// until restore() is called — happy-dom's document isn't recreated per
// test, so an un-torn-down observer from an earlier test would fire on a
// later test's mutations too. Track and restore every one created via
// newTranslator() so cleanup can't be forgotten per-test.
const active: ReturnType<typeof createAttributeTranslator>[] = [];
function newTranslator(getSourceLanguage: () => string = () => 'en') {
  const t = createAttributeTranslator({ translator, getSourceLanguage });
  active.push(t);
  return t;
}

beforeEach(() => {
  translateBatch.mockReset();
  document.body.innerHTML = '';
});

afterEach(() => {
  active.splice(0).forEach((t) => {
    t.restore();
  });
  vi.restoreAllMocks();
});

describe('createAttributeTranslator', () => {
  it('translates placeholder, alt, value, and title on the initial page', async () => {
    document.body.innerHTML =
      '<input id="a" placeholder="Search">' +
      '<img id="b" alt="A photo">' +
      '<input id="c" type="submit" value="Send">' +
      '<p id="d" title="A tooltip">text</p>';
    translateBatch.mockImplementationOnce(async (request) =>
      request.pieces.map((piece): PieceOutcome => ok([`TR:${piece[0]}`])),
    );

    const t = newTranslator();
    await t.start('es');

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('TR:Search');
    expect(document.getElementById('b')?.getAttribute('alt')).toBe('TR:A photo');
    expect(document.getElementById('c')?.getAttribute('value')).toBe('TR:Send');
    expect(document.getElementById('d')?.getAttribute('title')).toBe('TR:A tooltip');
  });

  it('sends the source/target languages and original values through as pieces', async () => {
    document.body.innerHTML = '<input placeholder="Search">';
    uppercaseOnce();

    const t = newTranslator(() => 'de');
    await t.start('fr');

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLanguage: 'de', targetLanguage: 'fr', pieces: [['Search']] }),
    );
  });

  it('restores every original value on restore()', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search"><img id="b" alt="A photo">';
    uppercaseOnce();

    const t = newTranslator();
    await t.start('es');
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('SEARCH');

    t.restore();

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('Search');
    expect(document.getElementById('b')?.getAttribute('alt')).toBe('A photo');
  });

  it('does not translate an element marked translate="no" or .notranslate', async () => {
    document.body.innerHTML =
      '<input placeholder="Skip me" translate="no">' + '<input placeholder="Skip me too" class="notranslate">';
    const t = newTranslator();
    await t.start('es');

    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('translates a newly-added element with a target attribute, discovered via the mutation observer', async () => {
    document.body.innerHTML = '';
    const t = newTranslator();
    await t.start('es'); // nothing to translate yet

    uppercaseOnce();
    const input = document.createElement('input');
    input.setAttribute('placeholder', 'New field');
    document.body.appendChild(input);
    await flushAsyncWork();

    expect(input.getAttribute('placeholder')).toBe('NEW FIELD');
  });

  it("re-translates an element's attribute when the PAGE changes it after the initial translate", async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    uppercaseOnce();
    const t = newTranslator();
    await t.start('es');
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('SEARCH');

    uppercaseOnce();
    document.getElementById('a')?.setAttribute('placeholder', 'Filter');
    await flushAsyncWork();

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('FILTER');
  });

  it("does not re-translate its OWN write, real bug this would cause otherwise: writing a retranslated value fires an 'attributes' mutation, which without a loop guard would be mistaken for the page changing the attribute again and re-queued for translation forever. The initial translate can't exercise this — the observer only starts watching AFTER that first write completes — so this drives it through a PAGE-initiated change instead, which happens while the observer is already live, exactly like the write ITS OWN retranslation performs.", async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    uppercaseOnce();
    const t = newTranslator();
    await t.start('es');
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('SEARCH');

    // A page-driven change while the observer is active triggers exactly
    // one retranslate.
    uppercaseOnce();
    document.getElementById('a')?.setAttribute('placeholder', 'Filter');
    await flushAsyncWork();
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('FILTER');

    // No further mock queued — if the retranslate's own write ('FILTER'
    // set back onto an already-'FILTER' attribute, structurally identical
    // to any other attribute mutation) weren't recognized as our own, the
    // observer would fire a 3rd translateBatch call here, hitting the
    // unmocked default and corrupting state.
    await flushAsyncWork();
    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(2); // initial + one retranslate, no more
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('FILTER');
  });

  it('restores the ORIGINAL value, not an intermediate translated one, even after a page-driven change and re-translate', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    uppercaseOnce();
    const t = newTranslator();
    await t.start('es');

    uppercaseOnce();
    document.getElementById('a')?.setAttribute('placeholder', 'Filter');
    await flushAsyncWork();
    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('FILTER');

    t.restore();

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('Search');
  });

  it('leaves an attribute alone when its translate outcome fails, rather than writing garbage or throwing', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    translateBatch.mockResolvedValueOnce([err({ kind: 'network', message: 'boom' })]);

    const t = newTranslator();
    await expect(t.start('es')).resolves.toBeUndefined();

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('Search');
  });

  it('does not write a translated value for an element that disconnected while its translation was in flight', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    let resolveTranslate!: (outcomes: PieceOutcome[]) => void;
    translateBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranslate = resolve;
        }),
    );

    const t = newTranslator();
    const startPromise = t.start('es');
    document.getElementById('a')?.remove();
    resolveTranslate([ok(['BUSCAR'])]);
    await startPromise;

    // Nothing to assert on the DOM (the node is detached), but restore()
    // must not throw over a since-removed element.
    expect(() => t.restore()).not.toThrow();
  });

  it('stops translating new content after restore()', async () => {
    document.body.innerHTML = '';
    const t = newTranslator();
    await t.start('es');
    t.restore();

    const input = document.createElement('input');
    input.setAttribute('placeholder', 'After restore');
    document.body.appendChild(input);
    await flushAsyncWork();

    expect(translateBatch).not.toHaveBeenCalled();
    expect(input.getAttribute('placeholder')).toBe('After restore');
  });

  it('translates multiple different attributes on the same element in one batch', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search" title="Search box">';
    translateBatch.mockImplementationOnce(async (request) =>
      request.pieces.map((piece): PieceOutcome => ok([`TR:${piece[0]}`])),
    );

    const t = newTranslator();
    await t.start('es');

    expect(document.getElementById('a')?.getAttribute('placeholder')).toBe('TR:Search');
    expect(document.getElementById('a')?.getAttribute('title')).toBe('TR:Search box');
    expect(translateBatch).toHaveBeenCalledTimes(1); // one batch covers both attributes
  });

  it('coalesces mutations arriving while a translate is already in flight into the SAME serialized drain, instead of firing a new concurrent request per mutation — real bug this closed, diagnosed live on a virtualized/infinite-scroll feed: the observer used to call translateTargets per callback with no debounce, coalescing, or cap, so a fast mutation stream could fire many unthrottled concurrent HTTP requests at once', async () => {
    document.body.innerHTML = '';
    const t = newTranslator();
    await t.start('es'); // nothing to translate yet — observer now live

    let resolveFirst!: (outcomes: PieceOutcome[]) => void;
    translateBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const inputA = document.createElement('input');
    inputA.setAttribute('placeholder', 'First');
    document.body.appendChild(inputA);
    await flushAsyncWork(); // observer callback fires, dispatches — now in flight

    // A second mutation arrives WHILE the first translate is still in
    // flight — must be coalesced into the pending batch, not dispatched as
    // its own concurrent request.
    const inputB = document.createElement('input');
    inputB.setAttribute('placeholder', 'Second');
    document.body.appendChild(inputB);
    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(1);

    // Resolving the first call drains the coalesced second target as its
    // own, separate, SERIALIZED (not concurrent) follow-up call.
    uppercaseOnce();
    resolveFirst([ok(['FIRST'])]);
    await flushAsyncWork();
    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(inputA.getAttribute('placeholder')).toBe('FIRST');
    expect(inputB.getAttribute('placeholder')).toBe('SECOND');
  });

  it('does not install the mutation observer if restore() lands while start() is still awaiting the initial translate — real bug this closed: start() used to install the observer unconditionally after its await, so a restore() (or a fast re-translate) landing during that gap was silently undone the instant the network call resolved, and the observer kept shipping attribute text to the provider after the user had already asked for the original page back', async () => {
    document.body.innerHTML = '<input id="a" placeholder="Search">';
    let resolveStart!: (outcomes: PieceOutcome[]) => void;
    translateBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    const t = newTranslator();
    const startPromise = t.start('es');
    t.restore(); // lands while start()'s own translate is still in flight
    resolveStart([ok(['BUSCAR'])]);
    await startPromise;

    // The initial translate's own write-back still happens (it was already
    // in flight when restore() landed) — restore() couldn't have undone
    // something that hadn't been written yet. What matters is what
    // happens AFTER: no observer should have been installed, so a later
    // page-driven mutation is never picked up.
    document.getElementById('a')?.setAttribute('placeholder', 'Filter');
    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(1); // only the initial call — no observer-driven retranslate
  });

  describe("pruneDisconnectedAttributeEntries (bounds originals' growth the same way translateLoop.ts bounds nodesToRestore)", () => {
    it('drops an entry only after TWO CONSECUTIVE disconnected ticks, not one — a virtualized/recycled list widget detaching and reattaching the SAME element within one resweep interval must not lose its restore entry', () => {
      const el = document.createElement('input');
      const originals = new Map<Element, Map<string, string>>([[el, new Map([['placeholder', 'Search']])]]);
      const disconnectedLastTick = new WeakSet<Element>();

      // Never attached to document.body — .isConnected is false throughout.
      pruneDisconnectedAttributeEntries(originals, disconnectedLastTick);
      expect(originals.has(el)).toBe(true); // first disconnected tick: noted, not yet pruned

      pruneDisconnectedAttributeEntries(originals, disconnectedLastTick);
      expect(originals.has(el)).toBe(false); // second consecutive tick: pruned
    });

    it('resets the disconnected streak if the element reconnects in between, so a transient detach/reattach never loses the entry', () => {
      const el = document.createElement('input');
      document.body.appendChild(el);
      const originals = new Map<Element, Map<string, string>>([[el, new Map([['placeholder', 'Search']])]]);
      const disconnectedLastTick = new WeakSet<Element>();

      el.remove();
      pruneDisconnectedAttributeEntries(originals, disconnectedLastTick); // 1st disconnected tick
      document.body.appendChild(el); // reconnects before the 2nd tick
      pruneDisconnectedAttributeEntries(originals, disconnectedLastTick); // reconnected: streak reset, not pruned
      el.remove();
      pruneDisconnectedAttributeEntries(originals, disconnectedLastTick); // 1st disconnected tick again

      expect(originals.has(el)).toBe(true);
    });
  });
});
