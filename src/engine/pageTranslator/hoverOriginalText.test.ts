// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { findOriginalTextForElement } from './hoverOriginalText';

function textNode(text: string): Text {
  return document.createTextNode(text);
}

describe('findOriginalTextForElement', () => {
  it('returns the original text when the element is the parent of a translated node', () => {
    const p = document.createElement('p');
    const node = textNode('Hola');
    p.append(node);

    const result = findOriginalTextForElement(p, [{ node, original: 'Hello' }]);

    expect(result).toBe('Hello');
  });

  it('returns null when the element has no matching translated node', () => {
    const p = document.createElement('p');
    const other = document.createElement('span');
    const node = textNode('Hola');
    other.append(node);

    const result = findOriginalTextForElement(p, [{ node, original: 'Hello' }]);

    expect(result).toBeNull();
  });

  it('returns null when the node text still matches the original (not actually translated)', () => {
    const p = document.createElement('p');
    const node = textNode('Hello');
    p.append(node);

    const result = findOriginalTextForElement(p, [{ node, original: 'Hello' }]);

    expect(result).toBeNull();
  });

  it('returns the first match when multiple translated nodes share the same parent', () => {
    const p = document.createElement('p');
    const nodeA = textNode('Hola');
    const nodeB = textNode('Mundo');
    p.append(nodeA, nodeB);

    const result = findOriginalTextForElement(p, [
      { node: nodeA, original: 'Hello' },
      { node: nodeB, original: 'World' },
    ]);

    expect(result).toBe('Hello');
  });

  it('returns null for an empty translated-nodes list', () => {
    const p = document.createElement('p');
    expect(findOriginalTextForElement(p, [])).toBeNull();
  });
});
