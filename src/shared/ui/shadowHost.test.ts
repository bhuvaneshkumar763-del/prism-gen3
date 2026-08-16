// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createShadowHost } from './shadowHost';

describe('createShadowHost', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('#test-host').forEach((el) => {
      el.remove();
    });
  });

  it('creates an open shadow root with the given styles and a mount point', () => {
    const { host, mountPoint } = createShadowHost('test-host', '.foo { color: red; }');

    expect(host.id).toBe('test-host');
    expect(document.getElementById('test-host')).toBe(host);
    expect(host.shadowRoot?.mode).toBe('open');
    expect(host.shadowRoot?.querySelector('style')?.textContent).toBe('.foo { color: red; }');
    expect(host.shadowRoot?.contains(mountPoint)).toBe(true);
  });

  it('removes a stale host with the same id before creating a new one', () => {
    const first = createShadowHost('test-host', '');
    const second = createShadowHost('test-host', '');

    expect(document.getElementById('test-host')).toBe(second.host);
    expect(document.documentElement.querySelectorAll('#test-host').length).toBe(1);
    expect(first.host.isConnected).toBe(false);
  });
});
