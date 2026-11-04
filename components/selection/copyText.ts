/**
 * Copies `text` to the clipboard; false (never a throw) on failure. Falls back
 * to `execCommand('copy')` on a temporary field, since `navigator.clipboard`
 * is missing on plain-http pages and can be refused by permissions.
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
  return copyWithCommand(text);
}

/** The focused element, looking inside open shadow roots (the popup's Copy button sits in one). */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * The field's select() replaces the page's selection and takes focus, so both
 * are put back after. The `copy` event is answered from a window capture
 * listener, ahead of the page's own, so the page can't see or rewrite it.
 */
function copyWithCommand(text: string): boolean {
  const selection = window.getSelection();
  const savedRanges: Range[] = [];
  for (let i = 0; i < (selection?.rangeCount ?? 0); i++) savedRanges.push(selection!.getRangeAt(i).cloneRange());
  const previousFocus = deepActiveElement();

  const onCopy = (e: Event) => {
    e.stopImmediatePropagation();
    const data = (e as ClipboardEvent).clipboardData;
    if (!data) return; // the field's own selection is copied instead
    data.setData('text/plain', text);
    e.preventDefault();
  };

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  window.addEventListener('copy', onCopy, true);
  try {
    const parent = document.body ?? document.documentElement;
    if (!parent) return false;
    parent.append(field);
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    window.removeEventListener('copy', onCopy, true);
    field.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of savedRanges) selection.addRange(range);
    }
  }
}
