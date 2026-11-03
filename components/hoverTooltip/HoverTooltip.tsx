import { Show } from 'solid-js';
import type { HoverTooltipPlacement } from './hoverTooltipPlacement';

/**
 * Tooltip showing the original of hovered translated text. Presentation only;
 * `mountHoverTooltip.ts` owns detection, debounce and positioning.
 */
export interface HoverTooltipProps {
  visible: boolean;
  text: string;
  /** Viewport-clamped placement — see `hoverTooltipPlacement.ts`. */
  placement: HoverTooltipPlacement;
}

function px(value: number | null): string | undefined {
  return value === null ? undefined : `${value}px`;
}

export function HoverTooltip(props: HoverTooltipProps) {
  return (
    <Show when={props.visible}>
      <div
        class="tooltip"
        style={{
          top: px(props.placement.top),
          bottom: px(props.placement.bottom),
          left: px(props.placement.left),
          right: px(props.placement.right),
          'max-width': px(props.placement.maxWidth),
          'max-height': px(props.placement.maxHeight),
        }}
      >
        {props.text}
      </div>
    </Show>
  );
}
