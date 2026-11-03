import { Show } from 'solid-js';

/**
 * Tooltip showing the original of hovered translated text. Presentation only;
 * `mountHoverTooltip.ts` owns detection, debounce and positioning.
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
