import { Show } from 'solid-js';

/**
 * "Hover over translated text to see the original" — a small tooltip
 * following the cursor. Pure presentation; `mountHoverTooltip.ts` owns the
 * hover-detection/debounce/positioning logic (kept out of this component
 * so the interaction logic is unit-testable without mounting Solid).
 */
export interface HoverTooltipProps {
  visible: boolean;
  text: string;
  top: number;
  left: number;
}

export function HoverTooltip(props: HoverTooltipProps) {
  return (
    <Show when={props.visible}>
      <div class="tooltip" style={{ top: `${props.top}px`, left: `${props.left}px` }}>
        {props.text}
      </div>
    </Show>
  );
}
