export interface ShadowHost {
  host: HTMLDivElement;
  mountPoint: HTMLDivElement;
}

/**
 * Creates the shadow-DOM host + mount point every injected UI surface needs,
 * replacing any stale host with the same id. 'open' rather than 'closed':
 * these surfaces hold nothing beyond what's on the page, and tests can reach
 * `host.shadowRoot`.
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
