/**
 * Copies `text` to the clipboard; true on success.
 *
 * `navigator.clipboard` exists only in secure contexts, so on a plain-http
 * page it is simply undefined — and it can also refuse on permissions. The
 * legacy copy command still works in both cases, so it's the fallback: a
 * temporary off-screen field is filled, selected, copied from, and removed.
 * Returns false rather than throwing, so the UI can say "Copy failed"
 * instead of falsely claiming success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy route
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.append(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
