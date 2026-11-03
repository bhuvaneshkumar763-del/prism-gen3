/**
 * The visible area: the visual viewport (shrinks with pinch-zoom and the iOS
 * keyboard) when the browser has one, else the layout viewport. The offsets
 * say where it sits inside the layout viewport, which `position: fixed` uses.
 */
export function viewportSize(): {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  scale: number;
} {
  const vv = window.visualViewport;
  return {
    width: vv?.width || window.innerWidth,
    height: vv?.height || window.innerHeight,
    offsetLeft: vv?.offsetLeft || 0,
    offsetTop: vv?.offsetTop || 0,
    scale: vv?.scale || 1,
  };
}
