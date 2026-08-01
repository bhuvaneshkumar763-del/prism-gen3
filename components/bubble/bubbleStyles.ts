/**
 * Inline CSS for the floating bubble's shadow root — see FloatingBubble.tsx's
 * header comment for why this can't be an imported stylesheet.
 */
export const BUBBLE_STYLES = `
  :host {
    all: initial;
  }
  .bubble {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 999px;
    background: #1e1b4b;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35);
  }
  .label {
    font-weight: 600;
    padding-left: 4px;
  }
  .action {
    cursor: pointer;
    border: none;
    border-radius: 999px;
    padding: 6px 12px;
    background: #4f46e5;
    color: #fff;
    font-weight: 600;
    font-size: 12px;
    font-family: inherit;
  }
  .action:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .close {
    cursor: pointer;
    border: none;
    background: transparent;
    color: #cbd5e1;
    font-size: 16px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 999px;
  }
  .close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
`;
