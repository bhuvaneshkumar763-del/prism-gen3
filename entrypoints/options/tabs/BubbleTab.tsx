import { createSignal, For, onCleanup, Show } from 'solid-js';
import { clearBubbleOverrideForHost } from '../../../src/shared/config/siteOverrides';
import type { SettingsTabProps } from './types';

/** Bubble tab: the default on/off, the remembered position, and per-site overrides. */
export function BubbleTab(props: SettingsTabProps) {
  function bubbleHostEntries(): Array<[string, boolean]> {
    return Object.entries(props.settings.bubbleByHost ?? {});
  }

  const [positionReset, setPositionReset] = createSignal(false);
  let positionResetTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(positionResetTimer));

  async function resetPosition(): Promise<void> {
    await props.setField('bubblePosition', null);
    // setField rolls back and reports a failed save itself; confirm only a saved reset.
    if (props.settings.bubblePosition !== null) return;
    setPositionReset(true);
    clearTimeout(positionResetTimer);
    positionResetTimer = setTimeout(() => setPositionReset(false), 2500);
  }

  async function removeBubbleOverride(host: string): Promise<void> {
    await props.setField('bubbleByHost', clearBubbleOverrideForHost(props.settings.bubbleByHost, host));
  }

  return (
    <section class="section">
      <h2>Floating bubble</h2>
      <label class="toggleRow">
        <input
          type="checkbox"
          checked={props.settings.bubbleEnabled}
          onChange={(e) => void props.setField('bubbleEnabled', e.currentTarget.checked)}
        />
        <span>Show the floating translate bubble by default</span>
      </label>
      <div class="bubbleActions">
        <button type="button" class="secondary" onClick={() => void resetPosition()}>
          Reset remembered position
        </button>
        <span class="saved inline" role="status">
          {positionReset() ? 'Bubble position reset' : ''}
        </span>
      </div>

      <p class="hint">Per-site overrides (set from the popup or the bubble's Hide chip):</p>
      <Show when={bubbleHostEntries().length > 0} fallback={<p class="listEditorEmpty">None</p>}>
        <ul class="siteTable">
          <For each={bubbleHostEntries()}>
            {([host, shown]) => (
              <li>
                <span>
                  {host}: <span class="siteValue">{shown ? 'shown' : 'hidden'}</span>
                </span>
                <button
                  type="button"
                  class="removeBtn"
                  aria-label={`Remove override for ${host}`}
                  title={`Remove override for ${host}`}
                  onClick={() => void removeBubbleOverride(host)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
