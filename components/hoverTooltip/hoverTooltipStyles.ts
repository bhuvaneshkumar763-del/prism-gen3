import { UI_FONT_STACK } from '../shared/uiFont';

/*
 * `.tooltip` gets its edges and max-width/max-height inline from
 * hoverTooltipPlacement.ts, sized to the room on screen; `overflow: hidden`
 * keeps a very long original inside that box.
 */
export const HOVER_TOOLTIP_STYLES = `
  :host {
    all: initial !important;
  }
  .tooltip {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    padding: 6px 10px;
    border-radius: 6px;
    background: #1e1b4b;
    color: #fff;
    font-family: ${UI_FONT_STACK};
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.35);
    pointer-events: none;
  }
`;
