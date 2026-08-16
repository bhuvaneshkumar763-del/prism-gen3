// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectTextNodes, isNoTranslateNode } from './collectTextNodes';

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

  it('skips <pre> and <code> so source samples are not reworded into broken code', () => {
    document.body.innerHTML =
      '<pre>if (user.isAdmin) { grantAccess(); }</pre><p>Intro</p><code>npm install</code><p>Outro</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Intro', 'Outro']);
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
});
