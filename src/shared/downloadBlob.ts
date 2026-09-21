/**
 * Triggers a browser download of `blob` as `filename` — the standard
 * detached-anchor-click pattern, done the safe way.
 *
 * Reliability fix, found via a round-6 audit: `entrypoints/options/App.tsx`'s
 * settings export used to build this anchor, click it, and revoke its
 * object URL synchronously right after `click()` returned, without ever
 * attaching the anchor to the document. Confirmed WebKit-specific risk (a
 * shipped target here — see `safari/Prism/`): clicking a detached download
 * anchor can hand off to the browser's own download machinery
 * asynchronously, so revoking the blob URL before that hand-off has
 * actually read it can make the export silently no-op. Extracted here
 * (rather than left inline in the Solid component) so this DOM-mechanics
 * fix is directly unit-testable without pulling in the whole options
 * page's `configStore`/`translationCache` dependency graph.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred, not synchronous: gives the browser's download machinery a
  // real chance to have started reading the blob before the URL it points
  // to is revoked — see this file's own header comment.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
