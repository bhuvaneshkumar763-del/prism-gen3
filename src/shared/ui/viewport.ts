/**
 * The visible area: the visual viewport (shrinks with pinch-zoom and the iOS
 * keyboard) when the browser has one, else the layout viewport.
 */
export function viewportSize(): { width: number; height: number } {
  return {
    width: window.visualViewport?.width || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  };
}
