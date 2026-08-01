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

  it('skips contenteditable subtrees', () => {
    document.body.innerHTML = '<div contenteditable="true">editing this</div><p>Static</p>';
    const nodes = collectTextNodes(document.body);
    expect(nodes.map((n) => n.data)).toEqual(['Static']);
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
