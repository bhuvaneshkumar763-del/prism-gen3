// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectAttributeTargets, collectTextNodes, isNoTranslateNode } from './collectTextNodes';

describe('collectTextNodes', () => {
  it('collects non-blank text nodes in document order', () => {
    document.body.innerHTML = '<p>Hello <b>world</b></p><p>Second</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Hello ', 'world', 'Second']);
  });

  it('skips blank/whitespace-only text nodes', () => {
    document.body.innerHTML = '<p>Real</p>\n  \n<p>   </p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Real']);
  });

  it('skips script/style/noscript/textarea subtrees entirely', () => {
    document.body.innerHTML =
      '<script>var x = "not translatable";</script><style>.a{}</style><textarea>typed text</textarea><p>Visible</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Visible']);
  });

  it('translates inside <pre> by default — matches TWP\'s real default exactly (translateTag_pre: "yes" in their actual defaultConfig, re-verified directly after shipping this backwards once already), real bug: cool18.com wraps a forum post\'s prose in a bare <pre> purely to preserve line breaks, not to mark code — the earlier hardcoded "always skip <pre>" silently excluded 60% of that page\'s content with no way to turn it back on', () => {
    document.body.innerHTML =
      '<div><pre>Some plain prose, not code.</pre><p>Intro</p><code>npm install</code><p>Outro</p></div>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Some plain prose, not code.', 'Intro', 'Outro']);
  });

  it('skips <pre> when translatePreTags is explicitly turned off', () => {
    document.body.innerHTML = '<pre>if (user.isAdmin) { grantAccess(); }</pre><p>Intro</p>';
    const nodes = collectTextNodes(document.body, { translatePreTags: false });
    expect(nodes.map((n) => n.data)).toEqual(['Intro']);
  });

  it('always skips <code>, nested inside a <pre> or standalone, regardless of translatePreTags — the real code-sample signal, matching TWP', () => {
    document.body.innerHTML = '<pre>See <code>npm install</code> below.</pre><code>standalone()</code><p>Text</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['See ', ' below.', 'Text']);
  });

  it("translates a bare <pre> even with translatePreTags off, when it is the ENTIRE page (viewing a raw text/JSON response) — matching TWP's exact exception", () => {
    document.body.innerHTML = '<pre>{"raw": "response body"}</pre>';
    const nodes = collectTextNodes(document.body, { translatePreTags: false });
    expect(nodes.map((n) => n.data)).toEqual(['{"raw": "response body"}']);
  });

  it('does not apply the bare-page exception when <pre> is one of several body children', () => {
    document.body.innerHTML = '<pre>Not the only child.</pre><p>Other content</p>';
    const nodes = collectTextNodes(document.body, { translatePreTags: false });
    expect(nodes.map((n) => n.data)).toEqual(['Other content']);
  });

  it('honors the standard translate="no" and .notranslate opt-out signals', () => {
    document.body.innerHTML =
      '<span translate="no">BrandName</span><span class="notranslate">@handle</span><p>Translate me</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Translate me']);
  });

  it('excludes descendants of a translate="no" subtree, not just the element itself', () => {
    document.body.innerHTML = '<div translate="no"><p>Keep <b>this</b> as-is</p></div><p>But translate this</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['But translate this']);
  });

  it('skips contenteditable subtrees', () => {
    document.body.innerHTML = '<div contenteditable="true">editing this</div><p>Static</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Static']);
  });

  it('skips a bare "#" or "@" marker node, real bug: alicesw.com tag list markup', () => {
    // <a><em>#</em>travel</a> — the marker is its own Text node, separate
    // from the word. Nothing useful to translate in a lone punctuation
    // character, and leaving it out of the queue means it can never be
    // mangled by a provider (grouping.ts's tag-anchor isolation still
    // recognizes the cluster as a tag via the anchor's live textContent).
    document.body.innerHTML = '<a><em>#</em>travel</a><a><em>@</em>user</a>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['travel', 'user']);
  });

  it('skips text with no letters at all, real bug: chapter-count filter chips ("> 100") came back as "compare 100"', () => {
    document.body.innerHTML =
      '<button>&gt; 50</button><button>&gt; 100</button><button>1234</button><button>-- 5 / 6 --</button><p>Translate this prose</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Translate this prose']);
  });

  it('does not skip text that mixes letters with digits/symbols', () => {
    document.body.innerHTML = '<p>Chapter 5</p><p>2024 was a good year</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Chapter 5', '2024 was a good year']);
  });

  it('does not skip content under a document-level lang attribute, real bug: pixiv.net sets <html lang="en"> from the UI language preference, unrelated to the actual (Chinese) novel content being viewed — a per-node lang check previously excluded 100% of every page whose <html lang> happened to match the target language', () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = '<p>你好世界</p><div lang="en"><p>Real English</p></div>';
    try {
      const nodes = collectTextNodes(document.body);
      expect(nodes.map((n) => n.data)).toEqual(['你好世界', 'Real English']);
    } finally {
      document.documentElement.removeAttribute('lang');
    }
  });

  // No dedicated "N-level-deep DOM doesn't stack-overflow" test: happy-dom's
  // own appendChild is itself recursive (Node.ts's connectedToNode walks the
  // full ancestor chain on every call), and the exact depth at which IT
  // overflows shifts with how much stack the rest of the suite already used
  // in the same worker — verified directly (5000 passed in isolation, failed
  // once run after the file's other tests). A threshold that moves based on
  // unrelated test ordering is not a reliable regression test; same call
  // made for the translationCache byte-accounting-drift case earlier this
  // project. The fix itself (explicit stack array instead of function-call
  // recursion — see collectTextNodes's implementation) has no depth-bound
  // call stack by construction, verified by code inspection instead.

  it('does not skip a marker character that is part of a larger word', () => {
    document.body.innerHTML = '<p>#travel</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['#travel']);
  });

  it('crosses an open shadow-root boundary, real bug: bilibili main comments not translated', () => {
    // <bili-comment-renderer> attaches an open shadow root — element.childNodes
    // never includes shadow content, so a plain walk would silently miss it.
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    if (!host) throw new Error('unreachable');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Shadow comment text</p>';

    const nodes = collectTextNodes(document.body);

    expect(nodes.map((n) => n.data)).toEqual(['Shadow comment text']);
  });

  it("crosses multiple nested shadow-root boundaries, matching bilibili's multi-level comment tree", () => {
    document.body.innerHTML = '<div id="outer"></div>';
    const outer = document.getElementById('outer');
    if (!outer) throw new Error('unreachable');
    const outerShadow = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    outerShadow.append(inner);
    const innerShadow = inner.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<span>Deeply nested reply</span>';

    const nodes = collectTextNodes(document.body);

    expect(nodes.map((n) => n.data)).toEqual(['Deeply nested reply']);
  });

  it('still skips script/style/contenteditable subtrees found inside a shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    if (!host) throw new Error('unreachable');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<script>var x = 1;</script><p>Visible in shadow</p>';

    const nodes = collectTextNodes(document.body);

    expect(nodes.map((n) => n.data)).toEqual(['Visible in shadow']);
  });

  it('does not throw when a closed shadow root is present (unreachable by design, not an error)', () => {
    document.body.innerHTML = '<div id="host"></div><p>Light DOM text</p>';
    const host = document.getElementById('host');
    if (!host) throw new Error('unreachable');
    const closedShadow = host.attachShadow({ mode: 'closed' });
    closedShadow.innerHTML = '<p>Unreachable</p>';

    const nodes = collectTextNodes(document.body);

    expect(nodes.map((n) => n.data)).toEqual(['Light DOM text']);
  });
});

describe('isNoTranslateNode', () => {
  it('is true for script/style/noscript/textarea elements', () => {
    for (const tag of ['script', 'style', 'noscript', 'textarea']) {
      const el = document.createElement(tag);
      expect(isNoTranslateNode(el)).toBe(true);
    }
  });

  it('is false for ordinary elements and text nodes', () => {
    expect(isNoTranslateNode(document.createElement('p'))).toBe(false);
    expect(isNoTranslateNode(document.createTextNode('hi'))).toBe(false);
  });

  it('is true for svg/template/math/mjx-container/tex-math elements, real gap this closed (TWP source comparison): svg keeps a lowercase tagName in the DOM unlike ordinary HTML elements, so this also exercises the case-insensitive tag comparison', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(svg.tagName).toBe('svg'); // sanity check on the exact quirk this fix handles
    expect(isNoTranslateNode(svg)).toBe(true);

    for (const tag of ['template', 'math', 'mjx-container', 'tex-math']) {
      const el = document.createElement(tag);
      expect(isNoTranslateNode(el)).toBe(true);
    }
  });

  it('is true for material-icons/material-symbols-outlined icon-font ligature classes, real gap this closed: their "text" is a ligature glyph, not translatable prose', () => {
    for (const cls of ['material-icons', 'material-symbols-outlined']) {
      const el = document.createElement('span');
      el.className = cls;
      expect(isNoTranslateNode(el)).toBe(true);
    }
  });

  it('is true for every official Material icon-font class variant, real gap this closed: only 2 of the 8 real class names were listed, so a site using e.g. material-icons-round or material-symbols-sharp got its icon ligature text translated', () => {
    for (const cls of [
      'material-icons-outlined',
      'material-icons-round',
      'material-icons-sharp',
      'material-icons-two-tone',
      'material-symbols-rounded',
      'material-symbols-sharp',
    ]) {
      const el = document.createElement('span');
      el.className = cls;
      expect(isNoTranslateNode(el)).toBe(true);
    }
  });

  it('is true for a KaTeX-rendered formula\'s visible HTML half (.katex), real gap this closed: skipping the <math> tag alone only protects the hidden screen-reader MathML copy — the visible .katex-html rendering (e.g. <span class="mop">sin</span> for the trig function) is plain <span>s with no tag-based signal, and translating "sin" as the ordinary English word breaks the formula', () => {
    const el = document.createElement('span');
    el.className = 'katex';
    expect(isNoTranslateNode(el)).toBe(true);
  });

  it('is false for an ordinary element that merely contains the substring "katex" in an unrelated class name (exact class match, not a substring check)', () => {
    const el = document.createElement('span');
    el.className = 'katex-example-not-real';
    expect(isNoTranslateNode(el)).toBe(false);
  });

  it('is true for an <option> with no value attribute, real gap this closed: an <option> with no value attribute submits its own TEXT as the form value (HTML default) — translating it silently changes what the form submits, not just what the user sees', () => {
    const el = document.createElement('option');
    el.textContent = 'Yes';
    expect(isNoTranslateNode(el)).toBe(true);
  });

  it('is false for an <option> that has an explicit value attribute — only its display text changes, not what the form submits', () => {
    const el = document.createElement('option');
    el.setAttribute('value', 'yes');
    el.textContent = 'Yes';
    expect(isNoTranslateNode(el)).toBe(false);
  });
});

describe('collectAttributeTargets', () => {
  it('finds placeholder on input and textarea', () => {
    document.body.innerHTML = '<input placeholder="Search..."><textarea placeholder="Type here"></textarea>';
    const targets = collectAttributeTargets(document.body);
    expect(targets.map((t) => [t.element.tagName, t.attribute])).toEqual([
      ['INPUT', 'placeholder'],
      ['TEXTAREA', 'placeholder'],
    ]);
  });

  it("finds a textarea's own placeholder even though TEXTAREA is a skip tag for text-node collection, real gap this closed: the skip-tag rule exists to protect a textarea's typed CONTENT, not its placeholder attribute", () => {
    document.body.innerHTML =
      '<textarea placeholder="Type your message">already typed content, not translatable</textarea>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.attribute).toBe('placeholder');
  });

  it('finds alt on img and area, and on an image-type input, but not a plain input', () => {
    document.body.innerHTML =
      '<img alt="A photo"><area alt="A region"><input type="image" alt="Submit button"><input type="text" alt="not applicable">';
    const targets = collectAttributeTargets(document.body);
    expect(targets.filter((t) => t.attribute === 'alt')).toHaveLength(3);
  });

  it("finds value on button/submit/reset inputs, but not other input types (a real form field's value is user data, never touched)", () => {
    document.body.innerHTML =
      '<input type="button" value="Click me"><input type="submit" value="Send"><input type="reset" value="Clear">' +
      '<input type="text" value="user typed this"><input type="email" value="user@example.com">';
    const targets = collectAttributeTargets(document.body);
    expect(targets.filter((t) => t.attribute === 'value')).toHaveLength(3);
  });

  it('finds title on any element, matching TWP\'s real "body [title]" scope', () => {
    document.body.innerHTML = '<p title="A paragraph tooltip">Text</p><abbr title="abbreviation">abbr</abbr>';
    const targets = collectAttributeTargets(document.body);
    expect(targets.filter((t) => t.attribute === 'title')).toHaveLength(2);
  });

  it('skips a letterless or blank attribute value', () => {
    document.body.innerHTML = '<img alt="   "><img alt="42"><input placeholder="">';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(0);
  });

  it('honors translate="no" and .notranslate on the element itself', () => {
    document.body.innerHTML =
      '<input placeholder="Skip me" translate="no"><input placeholder="Skip me too" class="notranslate">';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(0);
  });

  it('honors translate="no"/.notranslate on an ANCESTOR, not just the element itself', () => {
    document.body.innerHTML = '<div translate="no"><input placeholder="Skip me, my ancestor opted out"></div>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(0);
  });

  it("skips a contenteditable element's own attributes", () => {
    document.body.innerHTML = '<div contenteditable="true" title="Skip this tooltip">content</div>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(0);
  });

  it('does not descend into a <script>/<style>/<svg> subtree looking for attribute targets', () => {
    document.body.innerHTML =
      '<script><input placeholder="not real DOM, irrelevant"></script>' +
      '<svg><title>icon tooltip inside svg</title></svg>' +
      '<p title="Real tooltip">Visible</p>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.element.tagName).toBe('P');
  });

  it("still finds an icon-font-classed element's own title, even though its text content is skipped", () => {
    document.body.innerHTML = '<span class="material-icons" title="Home">home</span>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.attribute).toBe('title');
  });

  it('finds a title inside a <code> block — a real tooltip is independent of the (skipped) code content', () => {
    document.body.innerHTML = '<code title="npm install command">npm install</code>';
    const targets = collectAttributeTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.attribute).toBe('title');
  });

  it('finds multiple different attributes on the same element', () => {
    document.body.innerHTML = '<input placeholder="Search" title="Search box">';
    const targets = collectAttributeTargets(document.body);
    expect(targets.map((t) => t.attribute).sort()).toEqual(['placeholder', 'title']);
  });

  it('returns an empty array for a page with no translatable attributes', () => {
    document.body.innerHTML = '<p>Just some text</p><div>More text</div>';
    expect(collectAttributeTargets(document.body)).toEqual([]);
  });
});
