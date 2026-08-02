import { createSignal, For, Show } from 'solid-js';
import { COMMON_LANGUAGES } from '../../src/shared/languages';

export interface StringListEditorProps {
  label: string;
  values: string[];
  onAdd(value: string): void;
  onRemove(value: string): void;
  /** Swaps the free-text add row for a `<select>` of common language codes. */
  languageOptions?: boolean;
  placeholder?: string;
}

/**
 * A labeled add/remove list editor — ported from the pre-rewrite fork's
 * options page (`StringListEditor`), used for the four always/never-
 * translate site/language lists here and reused as-is for the per-site
 * bubble/source-language override tables (values there are `"host: state"`
 * display strings, not raw hostnames, since those two need a different
 * remove semantics — see `entrypoints/options/App.tsx`).
 */
export function StringListEditor(props: StringListEditorProps) {
  const [text, setText] = createSignal('');

  function commit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    props.onAdd(trimmed);
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
          value=""
          onChange={(e) => {
            commit(e.currentTarget.value);
            e.currentTarget.value = '';
          }}
        >
          <option value="" disabled>
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
                <span>{value}</span>
                <button
                  type="button"
                  class="removeBtn"
                  aria-label={`Remove ${value}`}
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
