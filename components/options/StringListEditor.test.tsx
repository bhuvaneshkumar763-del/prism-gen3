// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StringListEditor } from './StringListEditor';

describe('StringListEditor', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    container?.remove();
    container = undefined;
    dispose = undefined;
  });

  function mount(props: Partial<Parameters<typeof StringListEditor>[0]> = {}) {
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(
      () => StringListEditor({ label: 'Sites', values: [], onAdd: () => {}, onRemove: () => {}, ...props }),
      container,
    );
    return container;
  }

  function typeAndSubmit(el: HTMLElement, value: string): void {
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (el.querySelector('button') as HTMLButtonElement).click();
  }

  it('adds a single trimmed value on submit', () => {
    const onAdd = vi.fn();
    const el = mount({ onAdd });
    typeAndSubmit(el, '  example.com  ');
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('example.com');
  });

  it('splits a comma-separated paste into separate onAdd calls, matching the page\'s own "comma-separated" hint', () => {
    // Regression: commit() used to add the whole raw string as ONE entry —
    // pasting "a.com, b.com" created a single dead list item that never
    // matched a real hostname.
    const onAdd = vi.fn();
    const el = mount({ onAdd });
    typeAndSubmit(el, 'a.com, b.com,c.com');
    expect(onAdd).toHaveBeenCalledTimes(3);
    expect(onAdd).toHaveBeenNthCalledWith(1, 'a.com');
    expect(onAdd).toHaveBeenNthCalledWith(2, 'b.com');
    expect(onAdd).toHaveBeenNthCalledWith(3, 'c.com');
  });

  it('does not call onAdd for an empty or whitespace-only entry', () => {
    const onAdd = vi.fn();
    const el = mount({ onAdd });
    typeAndSubmit(el, '   ');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('renders each value with a remove button that calls onRemove', () => {
    const onRemove = vi.fn();
    const el = mount({ values: ['a.com', 'b.com'], onRemove });
    const items = el.querySelectorAll('li');
    expect(items).toHaveLength(2);
    (el.querySelector('button.removeBtn') as HTMLButtonElement).click();
    expect(onRemove).toHaveBeenCalledWith('a.com');
  });
});
