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

// Always skipped: source code sent to a translation provider comes back
// with identifiers reworded, quotes "smartened", and indentation reflowed
// — the sample renders as broken, uncopyable code. `<code>` is the
// standard semantic tag for exactly this, whether standalone or nested
// inside a `<pre>` block.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE']);

/**
 * `<pre>` is skipped separately from `SKIP_TAGS` (not always, not never) —
 * real bug, confirmed live against cool18.com: an old-school forum's post
 * body was a single `<pre>` wrapping 60% of the page's actual content
 * (10,750 of 17,754 characters), used purely to preserve the author's
 * original line breaks, not to mark code. `<pre>` alone doesn't mean
 * "code" the way `<code>` does — plenty of sites use it just for
 * whitespace-sensitive prose. TWP (confirmed against their live source)
 * gets this exactly right: `<pre>` skipping is a per-user setting
 * (`translateTag_pre`, default off) with one automatic exception — if the
 * *entire* page is nothing but one bare `<pre>` (viewing a raw text/JSON
 * response, which browsers render this way natively), it's always
 * translated regardless of the setting, since there's nothing there to be
 * "code embedded in an article." Matched here as `translatePreTags`
 * (`src/shared/config/schema.ts`) plus `isWholePageBarePre` below.
 */
export function isWholePageBarePre(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body?.childElementCount === 1 &&
    document.body.firstElementChild?.tagName === 'PRE'
  );
}

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

/**
 * Text with no letters at all — digits, punctuation, symbols, whitespace —
 * has nothing translatable in it and is exactly the kind of short,
 * context-free fragment a provider is most likely to mangle instead of
 * passing through unchanged: real site bug, a novel-site's chapter-count
 * filter chips ("> 50", "> 100", "> 200", ...) came back as "approximately
 * 50", "compare 100", "> 200" — visibly inconsistent for tokens that are
 * identical in shape, because Google's endpoint doesn't leave a bare
 * symbol+number alone the way it leaves prose alone. Skipping these
 * entirely is strictly safe (nothing here needs translating) and removes
 * them from the provider's context window, rather than trying to get a
 * translation provider to consistently no-op on them.
 */
/**
 * Also the reason a lone zero-width character (U+200B, U+200C/U+200D
 * joiners, U+FEFF) never needs its own filter: none of those are in the
 * Unicode Letter category either, so a text node containing only invisible
 * characters already matches this and gets skipped — verified directly
 * before adding a separate check that would have been dead code.
 */
const NO_LETTERS = /^[^\p{L}]*$/u;

export interface NoTranslateOptions {
  /** See `isWholePageBarePre`'s doc comment above — when false (the config default), `<pre>` is treated as a skip tag same as `SKIP_TAGS`. */
  translatePreTags?: boolean;
}

export function isNoTranslateNode(node: Node, options: NoTranslateOptions = {}): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.tagName === 'PRE' && !options.translatePreTags && !isWholePageBarePre()) return true;
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

/**
 * Iterative (explicit stack, not recursive) — a pathologically deep DOM
 * (real risk: infinite-scroll/virtualized-list pages that nest a nearly
 * flat structure hundreds of levels deep) would blow the call stack with a
 * recursive walk and kill translation outright with a `RangeError` instead
 * of just costing more time.
 *
 * Deliberately no `lang`-attribute-based skip check: an earlier version had
 * one ("if a site marks this exact text as already the target language,
 * skip it"), but real sites almost never annotate individual paragraphs —
 * they set `lang` once on `<html>` to describe their own UI's language, not
 * to describe what's actually written on the page. Real bug this caused:
 * pixiv sets `<html lang="en">` from the logged-in user's UI-language
 * preference, completely independent of the actual language of whatever
 * novel/manga/post is being viewed (confirmed live: `<html lang>` was
 * "en" while the page's own title was Chinese) — `closest('[lang]')`
 * resolves to that root `<html>` for every single text node with no closer
 * override, so the old check silently excluded 100% of the page whenever
 * the target language happened to match the site's UI language. TWP
 * (confirmed against their live source) has no equivalent check at all —
 * removing this matches that, and removes the whole bug class rather than
 * just this one page's specific shape of it.
 */
export function collectTextNodes(root: Node, options: NoTranslateOptions = {}): Text[] {
  const nodes: Text[] = [];

  const stack: Node[] = [root];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length just checked above
    const node = stack.pop()!;
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;
      const text = node.textContent?.trim();
      if (text && !BARE_MARKER.test(text) && !NO_LETTERS.test(text) && parent && !isNoTranslateNode(parent, options)) {
        nodes.push(node as Text);
      }
      continue;
    }
    if (isNoTranslateNode(node, options)) continue;
    // Push in reverse so the stack pops children in original document
    // order, then push the shadow root last so it's on top of the stack
    // and pops first — matching the original recursive walk's order
    // (shadow content processed before the host's own light-DOM children).
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: i is always in bounds
      stack.push(children[i]!);
    }
    const shadowRoot = (node as Element).shadowRoot;
    if (shadowRoot) stack.push(shadowRoot);
  }
  return nodes;
}
