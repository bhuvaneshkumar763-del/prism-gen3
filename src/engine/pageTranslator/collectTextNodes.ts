/**
 * Depth-first walk collecting translatable Text nodes under `root`, skipping
 * non-prose subtrees and editable content. Recurses into open shadow roots
 * (`childNodes` omits them); closed ones are unreachable by design. Content
 * changed inside a shadow root later is picked up by resweep.ts's re-walk.
 */

/**
 * Never translated: code comes back with identifiers reworded and quotes
 * smartened; `<template>` is inert markup page JS may clone; SVG and math
 * (MathML/MathJax) formulas break when their text is translated.
 * Compared upper-cased because SVG elements keep a lowercase `tagName`.
 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'CODE',
  'SVG',
  'TEMPLATE',
  'MATH',
  'MJX-CONTAINER',
  'TEX-MATH',
]);

/** Icon-font ligature classes (Material Icons/Symbols): the text `home` renders as a glyph, so translating it breaks the icon. */
const ICON_FONT_CLASSES = [
  'material-icons',
  'material-icons-outlined',
  'material-icons-round',
  'material-icons-sharp',
  'material-icons-two-tone',
  'material-symbols-outlined',
  'material-symbols-rounded',
  'material-symbols-sharp',
];

/**
 * KaTeX output: `MATH` only covers its hidden MathML half; the visible half
 * is plain spans (`sin` would become "pecado"). Skip the whole `.katex` wrapper.
 */
const KATEX_CLASS = 'katex';

/**
 * `<pre>` often holds plain prose kept for its line breaks, so skipping it is
 * a setting (`translatePreTags`). A page that is one bare `<pre>` (a raw
 * text/JSON response) is always translated.
 */
function isWholePageBarePre(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body?.childElementCount === 1 &&
    document.body.firstElementChild?.tagName === 'PRE'
  );
}

/**
 * A lone `#`/`@` marker node (`<a><em>#</em>travel</a>`): nothing to translate.
 * grouping.ts still sees it in the anchor's live `textContent`.
 */
const BARE_MARKER = /^[#@]$/;

/**
 * Letterless text (digits, symbols, zero-width chars) has nothing to translate,
 * and Google mangles short fragments like "> 50" into "approximately 50".
 */
const NO_LETTERS = /^[^\p{L}]*$/u;

export interface NoTranslateOptions {
  /** `false` skips `<pre>` (see `isWholePageBarePre`); omitted or `true` translates it. */
  translatePreTags?: boolean;
}

export function isNoTranslateNode(node: Node, options: NoTranslateOptions = {}): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    // Only an explicit `false` skips; omitted matches the config default (`true`).
    if (el.tagName === 'PRE' && options.translatePreTags === false && !isWholePageBarePre()) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    // Standard opt-outs: the HTML `translate="no"` attribute and the `.notranslate` class.
    if (el.getAttribute('translate') === 'no') return true;
    if (el.classList.contains('notranslate')) return true;
    if (ICON_FONT_CLASSES.some((cls) => el.classList.contains(cls))) return true;
    if (el.classList.contains(KATEX_CLASS)) return true;
    // An <option> without `value` submits its text, so translating it changes form data.
    if (el.tagName === 'OPTION' && !el.hasAttribute('value')) return true;
  }
  return false;
}

/**
 * True if any ancestor is a no-translate node. The top-down walks never need
 * this (they stop descending at a skip node), but a mutation can insert a
 * node deep inside an already-skipped subtree (spans into a `<code>`).
 */
export function hasNoTranslateAncestor(node: Node, isNoTranslate: (node: Node) => boolean): boolean {
  let el = node.parentElement;
  while (el) {
    if (isNoTranslate(el)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Iterative (explicit stack) so a pathologically deep DOM can't overflow the
 * call stack. No `lang`-attribute skip: sites set `<html lang>` to their UI
 * language, not the content's, so such a check would skip whole pages.
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
      // A descended-into node's parent was already checked before its children
      // were pushed; only a Text `root` (a bare added node) needs the check.
      const parentCheckNeeded = node === root;
      if (
        text &&
        !BARE_MARKER.test(text) &&
        !NO_LETTERS.test(text) &&
        parent &&
        !(parentCheckNeeded && isNoTranslateNode(parent, options))
      ) {
        nodes.push(node as Text);
      }
      continue;
    }
    if (isNoTranslateNode(node, options)) continue;
    // Reverse push so children pop in document order; the shadow root goes
    // last so it's processed before the host's light-DOM children.
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

/**
 * The single source of truth for which attributes get translated;
 * attributeTranslator.ts derives its observer filter from it.
 * `aria-placeholder`/`aria-description` are left out: rare, and each added
 * attribute risks translating a machine identifier, as `title` already can.
 */
export const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'alt', 'value', 'title', 'aria-label'] as const;

export interface AttributeTarget {
  element: Element;
  attribute: (typeof TRANSLATABLE_ATTRIBUTES)[number];
}

/**
 * Attribute exclusions are narrower than `isNoTranslateNode`: SKIP_TAGS stops
 * descent, but a `<textarea>` placeholder or `<code title>` is still translatable.
 */
function isHardExcludedFromAttributes(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.classList.contains('notranslate')) return true;
  return false;
}

function translatableAttributesFor(el: Element): AttributeTarget['attribute'][] {
  const attrs: AttributeTarget['attribute'][] = [];
  const tag = el.tagName;
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.hasAttribute('placeholder')) attrs.push('placeholder');
  const inputType = tag === 'INPUT' ? (el as HTMLInputElement).type : null;
  if ((tag === 'AREA' || tag === 'IMG' || inputType === 'image') && el.hasAttribute('alt')) attrs.push('alt');
  if (
    tag === 'INPUT' &&
    (inputType === 'button' || inputType === 'submit' || inputType === 'reset') &&
    el.hasAttribute('value')
  ) {
    attrs.push('value');
  }
  if (el.hasAttribute('title')) attrs.push('title');
  if (el.hasAttribute('aria-label')) attrs.push('aria-label');
  return attrs;
}

/**
 * Same iterative walk as `collectTextNodes`, but inspects every element's own
 * attributes. Only button-type `value` is a label; other inputs' are user data.
 */
export function collectAttributeTargets(root: Node, options: NoTranslateOptions = {}): AttributeTarget[] {
  const targets: AttributeTarget[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length just checked above
    const node = stack.pop()!;
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (isHardExcludedFromAttributes(el)) continue;
    for (const attribute of translatableAttributesFor(el)) {
      const value = el.getAttribute(attribute);
      if (value?.trim() && !NO_LETTERS.test(value)) targets.push({ element: el, attribute });
    }
    if (isNoTranslateNode(el, options)) continue; // don't descend, but this element's own attributes above were still checked
    const children = el.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: i is always in bounds
      stack.push(children[i]!);
    }
    const shadowRoot = el.shadowRoot;
    if (shadowRoot) stack.push(shadowRoot);
  }
  return targets;
}
