import { restoreBoundaryText } from './boundaryText';
import type { PieceSlot } from './grouping';

/**
 * Writing translations into the page, and the bookkeeping that undoes it:
 * each node's pre-translation text for Show original and the hover tooltip,
 * and each sent string's boundary text, which Google tends to drop.
 */

/**
 * Google drops trailing whitespace and sometimes a leading run of punctuation
 * (". The program…" loses its period). Digits are excluded so "3D …" stays intact.
 */
const LEADING_NON_LETTER_OR_DIGIT = /^[^\p{L}\p{N}]+/u;

/**
 * Drops a `nodesToRestore` entry once its node has been disconnected for two
 * CONSECUTIVE resweep ticks: recycled list widgets detach and reattach the
 * same node within one tick, and pruning it then would make it unrestorable.
 */
export function pruneDisconnectedRestoreEntries(
  nodesToRestore: Map<Text, string>,
  disconnectedLastTick: WeakSet<Text>,
): void {
  for (const node of nodesToRestore.keys()) {
    if (!node.isConnected) {
      if (disconnectedLastTick.has(node)) {
        nodesToRestore.delete(node);
      } else {
        disconnectedLastTick.add(node);
      }
    } else {
      disconnectedLastTick.delete(node);
    }
  }
}

/**
 * Every node this cycle may change, with its pre-translation text. Keyed by
 * node so `prune` can drop nodes the page removed; otherwise a long-lived SPA
 * would keep every detached Text node it translated.
 */
export function createRestoreLedger() {
  let originals = new Map<Text, string>();
  const disconnectedLastTick = new WeakSet<Text>();

  return {
    /** Records `node`'s current text as its original, replacing any earlier one. */
    record(node: Text): void {
      originals.set(node, node.data);
    },
    /** Starts a new cycle with `nodes` as everything there is to restore. */
    reset(nodes: readonly Text[] = []): void {
      originals = new Map(nodes.map((node) => [node, node.data]));
    },
    /** Puts every connected node's original back, through `noteOwnWrite`, and forgets them all. */
    restoreAll(noteOwnWrite: (node: Text, text: string) => void): void {
      originals.forEach((original, node) => {
        if (node.isConnected && node.data !== original) {
          noteOwnWrite(node, original);
          node.data = original;
        }
      });
      originals = new Map();
    },
    /** Bounds the ledger's growth; see `pruneDisconnectedRestoreEntries`. */
    prune(): void {
      pruneDisconnectedRestoreEntries(originals, disconnectedLastTick);
    },
    has(node: Text): boolean {
      return originals.has(node);
    },
    /** Original text of a translated node directly under `target`, or null. Doesn't allocate: called on every mousemove. */
    findOriginalTextForElement(target: Element): string | null {
      for (const [node, original] of originals) {
        if (node.parentElement === target && node.data !== original) return original;
      }
      return null;
    },
  };
}

export type RestoreLedger = ReturnType<typeof createRestoreLedger>;

export interface SlotWriterDeps {
  ledger: RestoreLedger;
  /** Called before every write, so the mutation watcher and staleness checks know it's the engine's own. */
  noteOwnWrite(node: Text, text: string): void;
  /** The page changed this node while in flight: translate its current content instead. */
  requeue(node: Text): void;
  /** `node` now holds its translation; `sourceChars` is the trimmed length of the text it replaced. */
  onTranslated(node: Text, sourceChars: number): void;
}

/**
 * Captures, for one tick's slots, the exact text sent per node and each
 * slot's boundary text, and returns the writer for that tick's results.
 * Writing a slot twice (from `onPieceComplete`, then the tick's final loop)
 * assigns an identical string, which is harmless.
 */
export function createSlotWriter(
  slotGroups: readonly (readonly PieceSlot[])[],
  deps: SlotWriterDeps,
): (slot: PieceSlot, rawTranslated: string) => void {
  const boundaryText = new Map<Text, { leading: string; trailing: string }>();
  /**
   * The exact text sent per node. Write-back requeues instead of writing when a
   * node's `.data` changed in flight, so a live update isn't clobbered by a
   * stale translation.
   */
  const sentText = new Map<Text, string>();
  for (const slots of slotGroups) {
    for (const slot of slots) {
      // A run's boundary text is its whole sent string's, kept on the node
      // the translation is written into.
      const leading = slot.text.match(LEADING_NON_LETTER_OR_DIGIT)?.[0] ?? '';
      const trailing = slot.text.slice(slot.text.trimEnd().length);
      // biome-ignore lint/style/noNonNullAssertion: a slot always has a node
      if (leading || trailing) boundaryText.set(slot.nodes[0]!, { leading, trailing });
      for (const node of slot.nodes) sentText.set(node, node.data);
    }
  }

  function write(node: Text, text: string): void {
    deps.noteOwnWrite(node, text);
    node.data = text;
    // So a second write pass doesn't mistake our own write for a page change.
    sentText.set(node, text);
  }

  function writeTranslatedNode(node: Text, rawTranslated: string): void {
    if (sentText.get(node) !== node.data) {
      deps.requeue(node);
      return;
    }
    const sourceChars = node.data.trim().length;
    const original = boundaryText.get(node);
    // See `restoreBoundaryText` for how the source's leading mark is carried
    // without doubling and the translation's own marks are kept.
    write(node, original ? restoreBoundaryText(original, rawTranslated) : rawTranslated);
    deps.onTranslated(node, sourceChars);
  }

  function emptyRunNode(node: Text): void {
    if (!node.isConnected || node.data === '') return;
    if (!deps.ledger.has(node)) deps.ledger.record(node);
    write(node, '');
  }

  /**
   * A word run's translation goes into its first node and the rest of the run
   * (words and punctuation) is emptied, recorded in the ledger; if the page
   * changed any of it in flight, the run is requeued.
   */
  function writeSlot(slot: PieceSlot, rawTranslated: string): void {
    const [head, ...tail] = slot.nodes;
    if (!head) return;
    if (tail.length === 0 && slot.separators.length === 0) {
      writeTranslatedNode(head, rawTranslated);
      return;
    }
    if (slot.nodes.some((n) => !n.isConnected || sentText.get(n) !== n.data)) {
      for (const node of slot.nodes) if (node.isConnected) deps.requeue(node);
      return;
    }
    writeTranslatedNode(head, rawTranslated);
    if (head.data !== sentText.get(head)) return;
    // The run's translation stands for every word in it, not just the head.
    for (const node of tail) {
      const sourceChars = node.data.trim().length;
      emptyRunNode(node);
      deps.onTranslated(node, sourceChars);
    }
    for (const node of slot.separators) emptyRunNode(node);
  }

  return writeSlot;
}
