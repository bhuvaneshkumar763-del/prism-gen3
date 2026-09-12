/**
 * Test-only helper: marks a synthetically-constructed event as
 * `isTrusted: true` before dispatching it.
 *
 * Needed because of a real security fix (round-4 audit): every
 * page-reachable UI handler (the floating bubble, the selection popup) now
 * rejects an event whose `isTrusted` is `false` — the standard defense
 * against a page dispatching synthetic clicks/keys at extension-injected
 * UI to drive privileged actions (persisting config, firing a real
 * translate request through the user's provider) without any real user
 * interaction. Both jsdom/happy-dom and real browsers report
 * `isTrusted: false` for anything dispatched via `element.dispatchEvent()`
 * or `element.click()` — exactly like a real page would see — so a test
 * simulating a genuine user click/keypress needs to explicitly mark its
 * event trusted; `isTrusted` is a getter-only property on a real `Event`
 * but is a plain, redefinable one on the constructed event before it's
 * dispatched.
 */
export function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true, configurable: true });
  return event;
}
