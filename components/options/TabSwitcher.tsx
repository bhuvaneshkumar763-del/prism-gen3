import { For } from 'solid-js';
import { nextTabIndex } from '../../src/shared/ui/tabNavigation';

export interface TabDef {
  id: string;
  label: string;
}

export interface TabSwitcherProps {
  tabs: TabDef[];
  activeId: string;
  onSelect(id: string): void;
}

/**
 * ARIA APG "automatic activation" tablist — ported from the pre-rewrite
 * fork's options page. Arrow/Home/End move focus AND activate the tab in
 * one step (roving `tabindex`, only the active tab is in the tab order).
 * Keyboard math lives in `src/shared/ui/tabNavigation.ts` so the
 * wrap-around logic is unit-tested rather than only exercised by clicking
 * through a real tablist.
 */
export function TabSwitcher(props: TabSwitcherProps) {
  function activeIndex(): number {
    return props.tabs.findIndex((t) => t.id === props.activeId);
  }

  function onKeydown(e: KeyboardEvent): void {
    const next = nextTabIndex(e.key, activeIndex(), props.tabs.length);
    if (next === null) return;
    e.preventDefault();
    const tab = props.tabs[next];
    if (!tab) return;
    props.onSelect(tab.id);
    document.getElementById(`tab-${tab.id}`)?.focus();
  }

  return (
    <div class="tabList" role="tablist" aria-label="Settings sections" onKeyDown={onKeydown}>
      <For each={props.tabs}>
        {(tab) => (
          <button
            type="button"
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={tab.id === props.activeId}
            aria-controls={`panel-${tab.id}`}
            tabindex={tab.id === props.activeId ? '0' : '-1'}
            class="tab"
            classList={{ active: tab.id === props.activeId }}
            onClick={() => props.onSelect(tab.id)}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  );
}
