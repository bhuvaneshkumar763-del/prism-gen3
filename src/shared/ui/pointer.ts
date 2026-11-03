/**
 * Whether the primary pointer can hover. Asks the device, not the user agent:
 * an iPad or iPhone in desktop mode sends a desktop UA but still can't hover,
 * and touch browsers leave `:hover` stuck on the last tapped element.
 */
export function canHover(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
}
