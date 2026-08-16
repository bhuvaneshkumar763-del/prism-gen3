/**
 * Depth-first walk collecting translatable Text nodes under `root`,
 * skipping script/style/noscript/textarea subtrees and editable content.
 * Extracted as its own function (rather than inlined in translateLoop.ts)
 * so it's directly unit-testable against a real (happy-dom) DOM without
 * spinning up the whole engine — same reasoning as `grouping.ts`.
 *
 * Crosses open shadow-root boundaries too — real bug, confirmed against a
 * real site (bilibili's main comment thread, as opposed to its danmaku
 * overlay which isn't shadow DOM and translated fine): `element.childNodes`
 * does NOT include a shadow host's `shadowRoot` content, so a plain walk
 * silently skips any subtree rendered inside one. Confirmed live that
 * site's comment system is a deep tree of custom elements
 * (`bili-comment-renderer` > `bili-rich-text` > ...), each attaching its
 * own OPEN shadow root — several levels deep, so this has to recurse into
 * `el.shadowRoot`, not just check the immediate root once. A closed shadow
 * root is unreachable from outside by design (`element.shadowRoot` reads
 * `null` for one) — nothing to do about that case, same as this project's
 * existing acknowledged gap for same-origin iframes.
 *
 * `mutationWatcher.ts`'s own MutationObserver still can't see mutations
 * happening *inside* an already-attached shadow root (subtree:true on a
 * light-DOM ancestor doesn't cross the boundary either) — that gap is
 * already covered by `resweep.ts`'s periodic/scroll-triggered re-walk,
 * which calls this same function; making this function shadow-aware is
 * what makes that existing backstop actually reach shadow content, not a
 * separate fix.
 */

// PRE/CODE: source code sent to a translation provider comes back with
// identifiers reworded, quotes "smartened", and indentation reflowed — the
// sample renders as broken, uncopyable code. Every mainstream translation
// tool excludes them.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'PRE', 'CODE']);

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
    // The standard, cross-tool opt-out signals a site uses to protect brand
    // names, identifiers, usernames and the like. `translate="no"` is the
    // HTML attribute; `.notranslate` is the long-standing class convention
    // Google Translate popularised. Both are honored by every major
    // translation tool, and both were previously ignored here entirely.
    if (el.getAttribute('translate') === 'no') return true;
    if (el.classList.contains('notranslate')) return true;
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
    const shadowRoot = (node as Element).shadowRoot;
    if (shadowRoot) walk(shadowRoot);
    node.childNodes.forEach(walk);
  };
  walk(root);
  return nodes;
}
