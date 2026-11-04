import { createShadowHost } from '../../src/shared/ui/shadowHost';
import { UI_FONT_STACK } from '../shared/uiFont';

const HOST_ID = 'prism-bubble-undo-host';
export const UNDO_TOAST_MS = 5000;

const TOAST_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0;
      font-family: ${UI_FONT_STACK}; }
  :host { all: initial !important; }
  .toast {
    position: fixed; z-index: 2147483647;
    left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
    width: max-content; max-width: calc(100vw - 32px);
    display: flex; align-items: center; gap: 4px; padding: 0 4px 0 16px;
    border-radius: 12px; background: #1e293b; color: #f8fafc;
    font-size: 15px; font-weight: 500;
    box-shadow: 0 8px 28px -8px rgba(15,23,42,.6);
  }
  .undo {
    min-height: 44px; min-width: 64px; padding: 0 12px; border: none; border-radius: 10px;
    background: transparent; color: #a5b4fc; font: inherit; font-weight: 700; cursor: pointer;
  }
  .undo:focus-visible { outline: 2px solid #a5b4fc; outline-offset: -2px; }
  @media print { .toast { display: none !important; } }
`;

/**
 * "Bubble hidden on this site — Undo" for a few seconds after Hide. It has its
 * own shadow host because hiding unmounts the bubble's (content.ts reacts to
 * the `bubbleByHost` change), and Undo's restore re-mounts it the same way.
 */
export function showHideUndoToast(onUndo: () => void): void {
  const { host, mountPoint } = createShadowHost(HOST_ID, TOAST_STYLES);

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'Bubble hidden on this site';
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'undo';
  undo.textContent = 'Undo';
  toast.append(text, undo);
  mountPoint.append(toast);

  const timer = setTimeout(() => host.remove(), UNDO_TOAST_MS);
  undo.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    e.stopPropagation();
    clearTimeout(timer);
    host.remove();
    onUndo();
  });
}
