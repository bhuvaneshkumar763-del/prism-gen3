/**
 * Depth-first walk collecting translatable Text nodes under `root`,
 * skipping script/style/noscript/textarea subtrees and editable content.
 * Extracted as its own function (rather than inlined in translateLoop.ts)
 * so it's directly unit-testable against a real (happy-dom) DOM without
 * spinning up the whole engine — same reasoning as `grouping.ts`.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

export function isNoTranslateNode(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if ((el as HTMLElement).isContentEditable) return true;
  }
  return false;
}

export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;
      if (node.textContent?.trim() && parent && !isNoTranslateNode(parent)) {
        nodes.push(node as Text);
      }
      return;
    }
    if (isNoTranslateNode(node)) return;
    node.childNodes.forEach(walk);
  };
  walk(root);
  return nodes;
}
