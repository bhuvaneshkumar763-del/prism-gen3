export interface ShadowHost {
  host: HTMLDivElement;
  mountPoint: HTMLDivElement;
}

/**
 * Creates the shadow-DOM host + mount point every injected UI surface
 * (bubble, hover tooltip, selection popup) needs: remove a stale host from
 * a prior mount, create the host div, attach an 'open' shadow root, inject
 * the surface's styles, and append a mount point ready for `solid-js/web`'s
 * `render()`.
 *
 * 'open' (not 'closed'): none of these surfaces hold user data beyond what's
 * already visible on the page, so the isolation benefit of a closed root is
 * marginal, and 'open' keeps `host.shadowRoot` reachable from outside for
 * tests.
 */
export function createShadowHost(hostId: string, styles: string): ShadowHost {
  document.getElementById(hostId)?.remove();

  const host = document.createElement('div');
  host.id = hostId;
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  document.documentElement.appendChild(host);

  return { host, mountPoint };
}
