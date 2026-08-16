export const HOVER_TOOLTIP_STYLES = `
  :host {
    all: initial !important;
  }
  .tooltip {
    position: fixed;
    z-index: 2147483647;
    max-width: 320px;
    padding: 6px 10px;
    border-radius: 6px;
    background: #1e1b4b;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.35);
    pointer-events: none;
  }
`;
