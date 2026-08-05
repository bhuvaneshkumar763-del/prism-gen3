/**
 * Depth-first walk collecting translatable Text nodes under `root`,
 * skipping script/style/noscript/textarea subtrees and editable content.
 * Extracted as its own function (rather than inlined in translateLoop.ts)
 * so it's directly unit-testable against a real (happy-dom) DOM without
 * spinning up the whole engine — same reasoning as `grouping.ts`.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

/**
 * Bare tag/mention markers with nothing else in the node — real-world tag
 * lists routinely wrap the marker in its own inline element for styling,
 * e.g. `<a><em>#</em>travel</a>`, leaving the marker as its own Text node
 * separate from the word. There is nothing useful to translate here (it's
 * punctuation, not prose) and leaving it out of the queue means it can
 * never get mangled by a provider — see `grouping.ts`'s tag-anchor
 * isolation, which relies on the surrounding `<a>`'s full text (marker
 * still present in the live DOM, just not queued) to still recognize the
 * cluster as a tag.
 */
const BARE_MARKER = /^[#@]$/;

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
      const text = node.textContent?.trim();
      if (text && !BARE_MARKER.test(text) && parent && !isNoTranslateNode(parent)) {
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
