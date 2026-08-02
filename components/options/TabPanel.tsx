import type { JSX } from 'solid-js';

export interface TabPanelProps {
  id: string;
  active: boolean;
  children: JSX.Element;
}

export function TabPanel(props: TabPanelProps) {
  return (
    <div
      id={`panel-${props.id}`}
      role="tabpanel"
      aria-labelledby={`tab-${props.id}`}
      hidden={!props.active}
      tabindex="0"
    >
      {props.children}
    </div>
  );
}
