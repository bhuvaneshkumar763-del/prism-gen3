// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './downloadBlob';

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it(
    'attaches the download anchor to the document before clicking it, and revokes the object URL only on a LATER task, not synchronously — ' +
      'real bug this closed, found via a round-6 audit: a.click() used to fire on an anchor that was never attached to the document, with ' +
      'URL.revokeObjectURL(url) called synchronously right after — confirmed WebKit-specific risk (a shipped target here, see safari/Prism/): ' +
      "clicking a detached download anchor can hand off to the browser's own download machinery asynchronously, so revoking the blob URL " +
      'before that hand-off has actually read it can make the export silently no-op',
    () => {
      vi.useFakeTimers();
      let createdAnchor: HTMLAnchorElement | undefined;
      let connectedAtClickTime: boolean | undefined;
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          createdAnchor = el as HTMLAnchorElement;
          const originalClick = el.click.bind(el);
          el.click = () => {
            connectedAtClickTime = el.isConnected;
            originalClick();
          };
        }
        return el;
      });

      // Spy on the two static methods, not the whole global — replacing
      // `URL` itself would break happy-dom's own internal anchor-click
      // navigation simulation, which needs a real `URL` constructor.
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const blob = new Blob(['{}'], { type: 'application/json' });
      downloadBlob(blob, 'prism-settings-2026-01-01.json');

      expect(createdAnchor?.download).toBe('prism-settings-2026-01-01.json');
      expect(createdAnchor?.href).toBe('blob:fake-url');
      // The click must land on an anchor that's actually IN the document —
      // a detached anchor's click() is exactly the unreliable case this fix
      // closes.
      expect(connectedAtClickTime).toBe(true);
      // Revoking must NOT happen synchronously, in the same task as the
      // click — that's the race. It's fine (expected) once a later task runs.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      vi.advanceTimersByTime(0);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      // Cleans up after itself — no anchor left sitting in the document.
      expect(createdAnchor?.isConnected).toBe(false);
    },
  );
});
