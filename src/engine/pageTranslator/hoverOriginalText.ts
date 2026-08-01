/**
 * Finds the pre-translation text for a hovered element, by scanning the
 * page-translator's live list of translated text nodes for one whose
 * `parentElement` matches the hovered element. A plain linear scan rather
 * than a WeakMap kept in sync with mutation-watcher/resweep traffic — hover
 * events are low-frequency compared to how often that list actually
 * changes, so the scan cost is negligible in practice.
 *
 * Standard Web APIs only (`Element`, `Text`) — lives in `src/engine/` so
 * it's directly unit-testable without mounting the hover-tooltip UI.
 */
export function findOriginalTextForElement(
  target: Element,
  translatedNodes: ReadonlyArray<{ node: Text; original: string }>,
): string | null {
  for (const { node, original } of translatedNodes) {
    if (node.parentElement === target && node.data !== original) return original;
  }
  return null;
}
