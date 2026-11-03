/**
 * Triggers a browser download of `blob` as `filename`. The anchor is attached
 * to the document and the URL revoked asynchronously: WebKit can hand a
 * detached anchor's download off later, and an early revoke silently no-ops it.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred so the download has started reading the blob before revoke.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
