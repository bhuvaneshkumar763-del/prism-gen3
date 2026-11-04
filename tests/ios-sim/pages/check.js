// Each page watches its own text and Prism's on-page UI, and reports what it
// sees to the server, so the UI test can wait on facts instead of pixels.
// Pages set window.CHECK = { page, leftover: RegExp } before loading this.
(() => {
  const { page, leftover } = window.CHECK;
  const frames = () => [document, ...Array.from(document.querySelectorAll('iframe'), (f) => f.contentDocument)];
  const paragraphs = () => frames().flatMap((d) => (d ? Array.from(d.querySelectorAll('.c')) : []));
  let original = null;
  let everAllTranslated = false;
  let wasTranslated = false;
  let flips = 0;
  let last = '';

  function shadow(id) {
    return document.getElementById(id)?.shadowRoot ?? null;
  }

  function snapshot() {
    const ps = paragraphs();
    if (!original || original.length !== ps.length) original = ps.map((p) => p.textContent);
    const texts = ps.map((p) => p.textContent);
    const translated = texts.filter((t) => !leftover.test(t)).length;
    const anyTranslated = translated > 0;
    if (anyTranslated !== wasTranslated) {
      flips++;
      wasTranslated = anyTranslated;
    }
    if (ps.length > 0 && translated === ps.length) everAllTranslated = true;
    const body = frames()
      .map((d) => d?.body?.textContent ?? '')
      .join('\n');
    const bubble = shadow('prism-bubble-host');
    const from = bubble?.querySelector('.sel');
    const selection = shadow('prism-selection-popup-host');
    return {
      page,
      visit: location.search,
      bubblePresent: !!bubble,
      bubbleError: bubble?.querySelector('.errorText')?.textContent ?? null,
      panelPinned: !!bubble?.querySelector('.panel.pinned'),
      fromValue: from ? from.value : null,
      total: ps.length,
      translated,
      everAllTranslated,
      restoredExact: everAllTranslated && texts.every((t, i) => t === original[i]),
      doubledBracket: /（\(|\(\(/.test(body),
      flips,
      selectionTrigger: !!selection?.querySelector('.trigger'),
      selectionResult: selection?.querySelector('.result')?.textContent ?? null,
      sample: texts[texts.length - 1]?.slice(-80) ?? '',
      frameAsks,
      frameSyncs: Array.from(document.querySelectorAll('iframe'), (f) => f.contentWindow?.__prismSyncs ?? null),
    };
  }

  function tick() {
    const state = snapshot();
    const key = JSON.stringify(state);
    const status = document.getElementById('status');
    if (status) status.textContent = `${state.translated}/${state.total} translated · flips ${state.flips}`;
    if (key === last) return;
    last = key;
    fetch('/report', { method: 'POST', body: key }).catch(() => {});
  }

  // Prism's frames signal each other with window messages: the top frame tells
  // sub-frames a decision is ready, and a sub-frame with none asks the top.
  let frameAsks = 0;
  window.addEventListener('message', (event) => {
    if (event.data?.prismFrameAsk === true) frameAsks++;
  });
  window.__prismCheck = { frameAsks: () => frameAsks };

  setInterval(tick, 500);
  tick();
})();
