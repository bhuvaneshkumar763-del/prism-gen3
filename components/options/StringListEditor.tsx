import { createSignal, For, Show } from 'solid-js';
import { languageLabel } from '../../src/shared/languageLabel';
import { COMMON_LANGUAGES } from '../../src/shared/languages';

export interface StringListEditorProps {
  label: string;
  values: string[];
  onAdd(value: string): void;
  onRemove(value: string): void;
  /** Swaps the free-text add row for a `<select>` of common languages, and shows values as language names. */
  languageOptions?: boolean;
  placeholder?: string;
}

/** A labeled add/remove list editor for the always/never-translate lists and the preferred languages. */
export function StringListEditor(props: StringListEditorProps) {
  const [text, setText] = createSignal('');
  const display = (value: string) => (props.languageOptions ? languageLabel(value) : value);

  function commit(value: string): void {
    // A pasted "a.com, b.com" is several sites, not one that never matches.
    const parts = value
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return;
    for (const part of parts) props.onAdd(part);
    setText('');
  }

  return (
    <div class="listEditor">
      <span class="listEditorLabel">{props.label}</span>
      <Show
        when={props.languageOptions}
        fallback={
          <div class="listEditorAddRow">
            <input
              type="text"
              aria-label={props.label}
              value={text()}
              placeholder={props.placeholder}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(text());
                }
              }}
            />
            <button type="button" onClick={() => commit(text())}>
              Add
            </button>
          </div>
        }
      >
        <select
          class="listEditorSelect"
          aria-label={props.label}
          onChange={(e) => {
            commit(e.currentTarget.value);
            e.currentTarget.value = '';
          }}
        >
          {/* `selected` here, not `value` on the select: that is set before the options exist. */}
          <option value="" disabled selected>
            Add a language…
          </option>
          <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
        </select>
      </Show>
      <Show when={props.values.length > 0} fallback={<p class="listEditorEmpty">None</p>}>
        <ul class="listEditorItems">
          <For each={props.values}>
            {(value) => (
              <li>
                <span>{display(value)}</span>
                <button
                  type="button"
                  class="removeBtn"
                  aria-label={`Remove ${display(value)}`}
                  title={`Remove ${display(value)}`}
                  onClick={() => props.onRemove(value)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
