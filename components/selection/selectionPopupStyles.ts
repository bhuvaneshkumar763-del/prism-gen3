export const SELECTION_POPUP_STYLES = `
  :host {
    all: initial !important;
  }
  .trigger {
    position: fixed;
    z-index: 2147483647;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    background: #4f46e5;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.35);
  }
  .panel {
    position: fixed;
    z-index: 2147483647;
    max-width: 280px;
    padding: 10px 28px 10px 12px;
    border-radius: 8px;
    background: #1e1b4b;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35);
  }
  .status {
    color: #cbd5e1;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
  }
  /* Perceived-speed fix: this used to be text-only while busy — see
     FloatingBubble.tsx's .spinner (components/bubble/bubbleStyles.ts) for
     the same pattern reused here. */
  .status .spinner {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    animation: selectionSpin 0.7s linear infinite;
  }
  @keyframes selectionSpin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status .spinner {
      animation-duration: 1.2s;
    }
  }
  .result {
    margin: 0;
  }
  .errorText {
    margin: 0;
    color: #fca5a5;
  }
  .close {
    position: absolute;
    top: 4px;
    right: 6px;
    cursor: pointer;
    border: none;
    background: transparent;
    color: #cbd5e1;
    font-size: 15px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 999px;
  }
  .close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
`;
