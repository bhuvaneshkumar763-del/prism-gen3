/**
 * Inline CSS for the floating bubble's shadow root — duplicated here rather
 * than imported (a shadow root injected into an arbitrary third-party page
 * can't reach this extension's own stylesheets by a relative path). Ported
 * from the pre-rewrite fork's `FloatingBubble.tsx` palette/layout, which was
 * restyled onto an indigo/violet gradient with a documented green
 * "translated" accent — kept here rather than reinvented, plus a red/amber
 * "error" accent for the "Translation failed" state, which the fork never had.
 */
export const BUBBLE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }

  :host { all: initial !important; }

  .wrap { position: fixed; width: 40px; height: 40px;
          --accent: #6366f1; --accent2: #4f46e5; z-index: 2147483647; }
  .wrap.translated { --accent: #16a34a; --accent2: #15803d; }
  .wrap.error { --accent: #dc2626; --accent2: #b91c1c; }

  .ball {
    position: absolute; inset: 0;
    width: 40px; height: 40px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    cursor: grab; user-select: none;
    color: #fff; font-weight: 700; font-size: 14px; letter-spacing: -.5px;
    background: linear-gradient(140deg, var(--accent), var(--accent2));
    box-shadow: 0 4px 14px -3px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset;
    opacity: .55; transition: opacity .2s ease, transform .15s ease, box-shadow .2s ease;
    touch-action: none;
  }
  .wrap:hover .ball, .ball.active { opacity: 1; }
  .ball:active { cursor: grabbing; transform: scale(.94); }
  .ball .ic { width: 21px; height: 21px; pointer-events: none; }
  .ball .ic-or { display: none; }
  .wrap.translated .ball .ic-tr, .wrap.error .ball .ic-tr { display: none; }
  .wrap.translated .ball .ic-or, .wrap.error .ball .ic-or { display: block; }
  .ball .spinner {
    display: none; width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
    animation: prismspin .7s linear infinite;
  }
  .ball.busy .ic { display: none !important; }
  .ball.busy .spinner { display: block; }
  @keyframes prismspin { to { transform: rotate(360deg); } }

  .panel {
    position: fixed; left: 0; top: 0;
    width: 296px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
    overflow: auto;
    border-radius: 16px;
    background: #ffffff; color: #0f172a;
    box-shadow: 0 12px 40px -10px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.06);
    opacity: 0; visibility: hidden;
    transform: scale(.96);
    transform-origin: center center;
    transition: opacity .16s ease, transform .16s ease, visibility .16s;
  }
  .wrap:hover .panel, .panel.pinned, .wrap:focus-within .panel {
    opacity: 1; visibility: visible; transform: scale(1);
  }

  .head {
    padding: 13px 14px 11px; display: flex; align-items: center; gap: 9px;
    background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff;
  }
  .head .hicon { width: 22px; height: 22px; padding: 4px; border-radius: 6px; background: rgba(255,255,255,.18); }
  .head .htitle { font-size: 13.5px; font-weight: 700; }
  .head .hsub { font-size: 11px; opacity: .85; font-weight: 500; }

  .body { padding: 12px; display: flex; flex-direction: column; gap: 11px; }
  .primary {
    width: 100%; border: none; cursor: pointer; border-radius: 11px;
    padding: 12px; font-size: 14px; font-weight: 700; color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    box-shadow: 0 4px 12px -4px var(--accent);
    transition: transform .12s ease, filter .12s ease;
  }
  .primary:hover { transform: translateY(-1px); filter: brightness(1.06); }
  .primary:active { transform: translateY(0); }
  .primary:disabled { opacity: .6; cursor: default; transform: none; }

  .errorText { font-size: 12px; color: #b91c1c; line-height: 1.4; }

  .divider { height: 1px; background: #e2e8f0; margin: 1px 0; }

  .row { display: flex; gap: 8px; }
  .chip {
    flex: 1; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
    border-radius: 10px; padding: 9px 6px; font-size: 11.5px; font-weight: 600;
    cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 5px;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  .chip:hover { background: #eef2f7; }
  .chip svg { width: 17px; height: 17px; }
  .chip.on { border-color: var(--accent); color: var(--accent); background: rgba(99,102,241,.08); }

  .selrow { display: flex; gap: 8px; }
  .selcol { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .sellbl { font-size: 9.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
            opacity: .55; padding-left: 2px; }
  .sel {
    width: 100%; padding: 8px 9px; border-radius: 10px; cursor: pointer;
    border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
    font-size: 12.5px; font-weight: 600; appearance: auto;
    text-overflow: ellipsis;
  }
  .sel:hover { border-color: var(--accent); }

  @media (prefers-color-scheme: dark) {
    .panel { background: #1f1f38; color: #f1f5f9; box-shadow: 0 12px 40px -10px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06); }
    .divider { background: #33335a; }
    .chip { background: #232342; border-color: #33335a; color: #f1f5f9; }
    .chip:hover { background: #2b2b4d; }
    .chip.on { background: rgba(129,140,248,.18); }
    .sel { background: #232342; border-color: #33335a; color: #f1f5f9; }
    .sel option { background: #1f1f38; color: #f1f5f9; }
    .errorText { color: #fca5a5; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ball, .panel { transition: opacity .12s linear !important; }
    .ball .spinner { animation-duration: 1.2s; }
  }

  @media print { .wrap { display: none !important; } }

  .ball:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
  .primary:focus-visible, .chip:focus-visible, .sel:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
`;
