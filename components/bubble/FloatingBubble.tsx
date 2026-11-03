import { createSignal, For, onCleanup, Show, onMount as solidOnMount } from 'solid-js';
import type { ProviderId } from '../../src/engine/providers/descriptors';
import { isProviderAvailable, providerDescriptors } from '../../src/engine/providers/descriptors';
import { applyListPatch, readListsSnapshot } from '../../src/platform/configMutations';
import { configStore } from '../../src/platform/configStore';
import { sendMessage } from '../../src/platform/messaging/protocol';
import {
  BALL_SIZE,
  type BubblePosition,
  clampDragPoint,
  computePanelPosition,
  exceededDragThreshold,
  isRightEdge,
  LONG_PRESS_MS,
  normalizeBubblePosition,
  type Point,
  positionFromDragPoint,
  resolveDockedPoint,
} from '../../src/shared/bubble/bubblePosition';
import {
  addSiteToAlwaysTranslate,
  removeSiteFromAlwaysTranslate,
  siteListIncludesHostname,
} from '../../src/shared/config/listMutations';
import { missingProviderSetup, type ProviderSetupFields } from '../../src/shared/config/providerSetup';
import {
  resolveSourceLanguageForHost,
  setBubbleVisibilityForHost,
  setSourceLanguageForHost,
} from '../../src/shared/config/siteOverrides';
import { COMMON_LANGUAGES, languageName, translationDirection } from '../../src/shared/languages';
import { TRANSLATE_ICON_PATH } from '../../src/shared/ui/icons';
import type { BubbleViewState } from './bubbleState';

/**
 * The always-on floating translate bubble: draggable, edge-docked, with a
 * hover/long-press panel. The failed state (`props.state.errorMessage`) wins
 * over "translated", so a failing batch never shows false success.
 *
 * Rendered once by `mountBubble.ts`; `props.state` is the reactive store
 * itself, so each `update()` re-renders fine-grained. All other state is local
 * signals seeded from `configStore` and kept live via `onChanged`, never a
 * `configStore.get()` read inside JSX (see `scripts/check-solid-reactivity.mjs`).
 */

export interface FloatingBubbleProps {
  state: BubbleViewState;
  hostname: string;
  shadowHost: HTMLElement;
  /**
   * `sourceLanguage` forces that language for this one retranslate (the From
   * picker); it is not carried into later requests (see `onSourceLanguageChange`).
   */
  onTranslate(targetLanguage: string, sourceLanguage?: string): void;
  onRestore(): void;
  onClose(): void;
}

function vw(): number {
  return window.visualViewport?.width || window.innerWidth;
}
function vh(): number {
  return window.visualViewport?.height || window.innerHeight;
}
function viewport() {
  return { width: vw(), height: vh() };
}

function uniq(codes: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

function displayLanguageName(code: string): string {
  return code === 'auto' ? 'Detect' : languageName(code);
}

// Touch browsers keep `:hover` stuck on the last tapped element, which would
// leave the panel open. Only trust `:hover` where the primary pointer hovers.
const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

export function FloatingBubble(props: FloatingBubbleProps) {
  let wrap!: HTMLDivElement;
  let ball!: HTMLButtonElement;
  let panel!: HTMLDivElement;

  const [pinned, setPinned] = createSignal(false);

  const [targetLanguage, setTargetLanguageSignal] = createSignal(configStore.get('targetLanguage'));
  const [service, setServiceSignal] = createSignal(configStore.get('pageTranslatorProvider'));
  function readSetupFields(): ProviderSetupFields {
    return {
      googleCloudTranslateApiKey: configStore.get('googleCloudTranslateApiKey'),
    };
  }
  const [setupFields, setSetupFields] = createSignal(readSetupFields());
  /** What a provider still needs, or null — see missingProviderSetup. */
  const providerGaps = (id: ProviderId) => missingProviderSetup(id, setupFields());
  const [alwaysOn, setAlwaysOn] = createSignal(
    siteListIncludesHostname(configStore.get('alwaysTranslateSites'), props.hostname),
  );
  const [sourceLanguage, setSourceLanguageSignal] = createSignal(
    resolveSourceLanguageForHost(configStore.get('sourceLanguageByHost'), props.hostname, 'auto'),
  );

  const targetLangOptions = () => uniq([targetLanguage(), ...COMMON_LANGUAGES.map((l) => l.code)]);
  const sourceLangOptions = () => uniq(['auto', sourceLanguage(), ...COMMON_LANGUAGES.map((l) => l.code)]);
  const serviceOptions = () => providerDescriptors.filter((d) => isProviderAvailable(d.id));

  // Position is stored as a dock side + vertical fraction, so the ball
  // stays pinned to a screen edge regardless of viewport size, device, or
  // orientation, instead of drifting off-edge on resize/rotation.
  let dockState: BubblePosition = normalizeBubblePosition(configStore.get('bubblePosition'));
  let pos: Point = { x: 0, y: 0 };

  function positionPanelNow(): void {
    const r = ball.getBoundingClientRect();
    const point = computePanelPosition({
      ballRect: { left: r.left, top: r.top, width: r.width, height: r.height },
      panelSize: { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: viewport(),
    });
    panel.style.left = `${point.x}px`;
    panel.style.top = `${point.y}px`;
  }

  /** Open by any of its three routes: pinned (long-press/ArrowDown), hovered, or holding keyboard focus. */
  function isPanelOpen(): boolean {
    return pinned() || (canHover() && wrap.matches(':hover')) || panel.matches(':focus-within');
  }

  function applyState(): Point {
    const point = resolveDockedPoint(dockState, viewport(), BALL_SIZE);
    wrap.style.left = `${point.x}px`;
    wrap.style.top = `${point.y}px`;
    wrap.classList.toggle('right', isRightEdge(point.x, vw(), BALL_SIZE));
    // Measuring the panel forces layout, so only do it while it's showing;
    // every way of opening it re-measures right before it appears.
    if (isPanelOpen()) positionPanelNow();
    return point;
  }

  function previewAt(x: number, y: number): Point {
    const point = clampDragPoint({ x, y }, viewport(), BALL_SIZE);
    wrap.style.left = `${point.x}px`;
    wrap.style.top = `${point.y}px`;
    wrap.classList.toggle('right', isRightEdge(point.x, vw(), BALL_SIZE));
    positionPanelNow();
    return point;
  }

  /**
   * Coalesces resize and visualViewport resize/scroll (continuous on iOS
   * during pinch-zoom) to one layout-reading applyState() per frame.
   */
  let reflowFrame: number | null = null;
  function reflow(): void {
    if (reflowFrame !== null) return;
    reflowFrame = requestAnimationFrame(() => {
      reflowFrame = null;
      pos = applyState();
    });
  }

  function handlePrimaryAction(): void {
    // No-op offline: translateLoop.ts auto-resumes when connectivity returns
    // (see connectivity.ts). The button is disabled too; this guards other callers.
    if (props.state.errorKind === 'offline') return;
    if (props.state.errorMessage) {
      props.onTranslate(targetLanguage());
      return;
    }
    if (props.state.pageState === 'translated') {
      props.onRestore();
    } else {
      props.onTranslate(targetLanguage());
    }
  }

  let actionBusy = false;
  function toggleTranslate(): void {
    // actionBusy (600ms) stops a double tap; props.state.busy covers a long
    // translation. The ball can't use `disabled` like .primary does, because
    // that would also block its drag handlers.
    if (actionBusy || props.state.busy) return;
    actionBusy = true;
    setTimeout(() => {
      actionBusy = false;
    }, 600);
    handlePrimaryAction();
  }

  solidOnMount(() => {
    pos = applyState();

    wrap.addEventListener('pointerenter', positionPanelNow);
    wrap.addEventListener('focusin', positionPanelNow);
    window.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('scroll', reflow);
    const onOrientationChange = () => setTimeout(reflow, 250);
    window.addEventListener('orientationchange', onOrientationChange);

    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressFired = false;

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isTrusted) return;
      // Right-click and other non-primary buttons are not a translate gesture;
      // touch and pen report button 0, so they still work.
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      longPressFired = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = pos.x;
      oy = pos.y;
      try {
        ball.setPointerCapture(e.pointerId);
      } catch {
        // ignore — pointer capture is best-effort
      }
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        positionPanelNow();
        setPinned(true);
      }, LONG_PRESS_MS);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && exceededDragThreshold(dx, dy)) {
        moved = true;
        if (longPressTimer) clearTimeout(longPressTimer);
      }
      if (moved) pos = previewAt(ox + dx, oy + dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!e.isTrusted || e.button !== 0) return;
      dragging = false;
      if (longPressTimer) clearTimeout(longPressTimer);
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (moved) {
        const previousDockState = dockState;
        dockState = positionFromDragPoint(pos, viewport(), BALL_SIZE);
        pos = applyState();
        configStore.set('bubblePosition', dockState).catch(() => {
          // Save failed: revert to the last persisted position rather than
          // show one that would silently reset on the next page load.
          dockState = previousDockState;
          pos = applyState();
        });
      } else if (!longPressFired) {
        // A long-press already opened the panel; releasing it must not also translate.
        // With the panel pinned open, a tap on the ball closes it.
        if (pinned()) setPinned(false);
        else toggleTranslate();
      }
    };
    /**
     * The browser can claim the pointer mid-drag (e.g. an edge back-swipe)
     * without a `pointerup`: reset the drag state and snap back from the
     * unsaved preview to the last committed position.
     */
    const onPointerCancel = (e: PointerEvent) => {
      dragging = false;
      moved = false;
      if (longPressTimer) clearTimeout(longPressTimer);
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      pos = applyState();
    };
    ball.addEventListener('pointerdown', onPointerDown);
    ball.addEventListener('pointermove', onPointerMove);
    ball.addEventListener('pointerup', onPointerUp);
    ball.addEventListener('pointercancel', onPointerCancel);

    const onDocPointerDown = (e: PointerEvent) => {
      if (pinned() && !e.composedPath().includes(props.shadowHost)) setPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    const onKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTranslate();
      } else if (e.key === 'ArrowDown') {
        // The keyboard way in: hover and long-press are pointer-only, and the
        // hidden panel's controls aren't in the tab order. ArrowDown is the
        // disclosure-widget convention for "open and move into it".
        e.preventDefault();
        setPinned(true);
        positionPanelNow();
        const firstControl = panel.querySelector<HTMLElement>('select, button, input, [tabindex]');
        firstControl?.focus();
      }
    };
    ball.addEventListener('keydown', onKeydown);

    // Escape anywhere in the bubble (focus may be inside the panel) closes it
    // and returns focus to the ball. The panel opens on `.panel:focus-within`,
    // so focus on the ball doesn't hold it open (see bubbleStyles.ts).
    const onWrapKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.key !== 'Escape') return;
      setPinned(false);
      ball.focus();
    };
    wrap.addEventListener('keydown', onWrapKeydown);

    // Tabbing out of the bubble closes a panel ArrowDown pinned open.
    // `relatedTarget` is where focus is going; inside the bubble keeps it open.
    const onWrapFocusOut = (e: FocusEvent) => {
      if (!wrap.contains(e.relatedTarget as Node | null)) setPinned(false);
    };
    wrap.addEventListener('focusout', onWrapFocusOut);

    const onFsChange = () => {
      const fs = document.fullscreenElement;
      wrap.style.display = fs ? 'none' : '';
    };
    document.addEventListener('fullscreenchange', onFsChange, false);

    const unsubConfig = configStore.onChanged((name, value) => {
      if (name === 'targetLanguage') setTargetLanguageSignal(value as string);
      else if (name === 'pageTranslatorProvider') setServiceSignal(value as ProviderId);
      else if (name === 'googleCloudTranslateApiKey') setSetupFields(readSetupFields());
      else if (name === 'alwaysTranslateSites')
        setAlwaysOn(siteListIncludesHostname(value as string[], props.hostname));
      else if (name === 'sourceLanguageByHost') {
        setSourceLanguageSignal(resolveSourceLanguageForHost(value as Record<string, string>, props.hostname, 'auto'));
      } else if (name === 'bubblePosition') {
        // Keeps other tabs' bubbles in sync after a drag; also fires
        // (idempotently) for this instance's own write in onPointerUp.
        dockState = normalizeBubblePosition(value as BubblePosition);
        pos = applyState();
      }
    });

    onCleanup(() => {
      wrap.removeEventListener('pointerenter', positionPanelNow);
      wrap.removeEventListener('focusin', positionPanelNow);
      window.removeEventListener('resize', reflow);
      window.visualViewport?.removeEventListener('resize', reflow);
      window.visualViewport?.removeEventListener('scroll', reflow);
      window.removeEventListener('orientationchange', onOrientationChange);
      if (reflowFrame !== null) cancelAnimationFrame(reflowFrame);
      ball.removeEventListener('pointerdown', onPointerDown);
      ball.removeEventListener('pointermove', onPointerMove);
      ball.removeEventListener('pointerup', onPointerUp);
      ball.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      ball.removeEventListener('keydown', onKeydown);
      wrap.removeEventListener('keydown', onWrapKeydown);
      wrap.removeEventListener('focusout', onWrapFocusOut);
      document.removeEventListener('fullscreenchange', onFsChange, false);
      unsubConfig();
    });
  });

  function onPrimaryClick(e: MouseEvent): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    handlePrimaryAction();
  }

  function onAlwaysClick(e: MouseEvent): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    const snapshot = readListsSnapshot(configStore);
    if (!alwaysOn()) {
      void applyListPatch(configStore, addSiteToAlwaysTranslate(snapshot, props.hostname));
      if (props.state.pageState !== 'translated') props.onTranslate(targetLanguage());
    } else {
      void applyListPatch(configStore, removeSiteFromAlwaysTranslate(snapshot, props.hostname));
    }
    setAlwaysOn(!alwaysOn());
  }

  /**
   * Rejection handled, not `void`ed: when nothing answers (restarting service
   * worker, context invalidated by an update) it would otherwise show up as
   * "Uncaught (in promise)" in the host page's console.
   */
  function openSettings(section?: string): void {
    sendMessage('openOptionsPage', section ? { section } : undefined).catch((e) => {
      console.warn('[prism] could not open Settings', e);
    });
  }

  function onSettingsClick(e: MouseEvent): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    openSettings();
  }

  function onHideClick(e: MouseEvent): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    // onClose() hides the bubble now regardless; a failed persist only means
    // it can reappear on the next page load, so there is nothing to roll back.
    configStore
      .set('bubbleByHost', setBubbleVisibilityForHost(configStore.get('bubbleByHost'), props.hostname, false))
      .catch((e2) => console.warn('[prism] failed to save bubble-hidden preference', e2));
    props.onClose();
  }

  /**
   * One-off retranslate from `code`, to correct bad auto-detection. `code` is
   * saved to `sourceLanguageByHost` (picker display, auto-translate-on-load)
   * but not sent on later requests: a forced source on text already in another
   * language mistranslates it (Google: "History" with source=vi → "Association").
   */
  function onSourceLanguageChange(e: Event): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    const code = (e.currentTarget as HTMLSelectElement).value;
    const previous = sourceLanguage();
    configStore
      .set(
        'sourceLanguageByHost',
        setSourceLanguageForHost(configStore.get('sourceLanguageByHost'), props.hostname, code),
      )
      .catch((e2) => {
        console.warn('[prism] failed to save source-language override', e2);
        setSourceLanguageSignal(previous);
      });
    setSourceLanguageSignal(code);
    props.onTranslate(targetLanguage(), code);
  }

  function onTargetLanguageChange(e: Event): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    const code = (e.currentTarget as HTMLSelectElement).value;
    const previous = targetLanguage();
    configStore.set('targetLanguage', code).catch((e2) => {
      console.warn('[prism] failed to save target language', e2);
      setTargetLanguageSignal(previous);
    });
    setTargetLanguageSignal(code);
    props.onTranslate(code);
  }

  function onServiceChange(e: Event): void {
    if (!e.isTrusted) return;
    e.stopPropagation();
    const select = e.currentTarget as HTMLSelectElement;
    const id = select.value as ProviderId;
    const previous = service();
    // A provider that still needs setup is not switched to (every page would
    // fail until its key is entered); Settings opens where it is set up.
    if (providerGaps(id)) {
      select.value = previous;
      openSettings('page');
      return;
    }
    configStore.set('pageTranslatorProvider', id).catch((e2) => {
      console.warn('[prism] failed to save translation service', e2);
      setServiceSignal(previous);
    });
    setServiceSignal(id);
    props.onTranslate(targetLanguage());
  }

  // `pageState` can turn 'translated' before any work is done, so `busy`
  // (translateLoop.ts's `onWorkingChange`, via content.ts) must also be clear.
  const translated = () => !props.state.errorMessage && props.state.pageState === 'translated' && !props.state.busy;
  const errored = () => Boolean(props.state.errorMessage);
  const offline = () => errored() && props.state.errorKind === 'offline';
  /** The ball's accessible name: what a click will do. Mirrors handlePrimaryAction. */
  const ballLabel = () => {
    if (offline()) return 'Offline — waiting for connection';
    if (errored()) return props.state.busy ? 'Retrying…' : 'Retry translation';
    if (props.state.busy) return props.state.pageState === 'translated' ? 'Working…' : 'Translating…';
    return translated() ? 'Show original' : 'Translate this page';
  };
  const headTitle = () => {
    if (offline()) return 'Offline';
    if (errored()) return 'Translation failed';
    if (!translated()) return 'Translate this page';
    // A source the user forced with the From picker is what the page was
    // actually translated from; otherwise the detected language.
    const from = sourceLanguage() !== 'auto' ? sourceLanguage() : props.state.originalLanguage;
    return translationDirection(from, targetLanguage()) ?? 'Page translated';
  };
  const primaryLabel = () => {
    // No "Retry" offline: translateLoop.ts auto-resumes on reconnect.
    if (offline()) return 'Waiting for connection…';
    if (errored()) return props.state.busy ? 'Retrying…' : 'Retry';
    if (translated()) return props.state.busy ? 'Restoring…' : 'Show original';
    return props.state.busy ? 'Translating…' : 'Translate page';
  };
  // `progress` is null until the cycle knows its total. Hide on `busy` going
  // false, not on reaching 1: `progress` can settle short of 1 on a finished
  // translate (see `onProgressChange` in translateLoop.ts).
  const showProgress = () => props.state.busy && props.state.progress !== null && props.state.progress < 1;

  return (
    <div class="wrap" classList={{ translated: translated(), error: errored(), offline: offline() }} ref={wrap}>
      <button
        type="button"
        class="ball"
        classList={{ busy: props.state.busy }}
        ref={ball}
        aria-label={ballLabel()}
        aria-haspopup="true"
        aria-expanded={pinned()}
        title="Click to translate · drag to move · Arrow Down to open settings"
      >
        <svg class="ic ic-tr" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={TRANSLATE_ICON_PATH} />
        </svg>
        <svg
          class="ic ic-or"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 4v4h4" />
        </svg>
        <span class="spinner" />
      </button>
      {/* Outside the panel on purpose: the panel is visibility:hidden most of
          the time, and screen readers don't announce changes inside a hidden
          region. Visually hidden, but read out when the status changes. */}
      <span class="srOnly" role="status" aria-live="polite">
        {headTitle()}
      </span>
      <div class="panel" classList={{ pinned: pinned() }} ref={panel}>
        <div class="head">
          <svg class="hicon" viewBox="0 0 128 128" aria-hidden="true">
            <polygon points="56.3,29.2 32.6,72 80,72" fill="#fff" />
          </svg>
          <div>
            <div class="htitle">{headTitle()}</div>
            <div class="hsub">Prism</div>
          </div>
        </div>
        <Show when={showProgress()}>
          <div class="progressTrack" aria-hidden="true">
            <div class="progressFill" style={{ width: `${Math.round((props.state.progress ?? 0) * 100)}%` }} />
          </div>
        </Show>
        <div class="body">
          <button type="button" class="primary" disabled={props.state.busy || offline()} on:click={onPrimaryClick}>
            {primaryLabel()}
          </button>
          <Show when={props.state.errorMessage && !offline()}>
            <p class="errorText">{props.state.errorMessage}</p>
          </Show>
          <div class="selrow">
            <label class="selcol">
              <span class="sellbl">From</span>
              <select
                class="sel"
                on:click={(e) => e.stopPropagation()}
                on:change={onSourceLanguageChange}
                title={
                  sourceLanguage() === 'auto'
                    ? 'Detect each request automatically (recommended for mixed-language pages)'
                    : 'Force-retranslates this page from this language right now — a one-off correction for when auto-detection got it wrong, not a standing rule. A fresh page load goes back to Auto.'
                }
              >
                <For each={sourceLangOptions()}>
                  {(code) => (
                    <option value={code} selected={code === sourceLanguage()}>
                      {displayLanguageName(code)}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <label class="selcol">
              <span class="sellbl">To</span>
              <select class="sel" on:click={(e) => e.stopPropagation()} on:change={onTargetLanguageChange}>
                <For each={targetLangOptions()}>
                  {(code) => (
                    <option value={code} selected={code === targetLanguage()}>
                      {displayLanguageName(code)}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <label class="selcol">
              <span class="sellbl">Service</span>
              <select class="sel" on:click={(e) => e.stopPropagation()} on:change={onServiceChange}>
                <For each={serviceOptions()}>
                  {(d) => (
                    <option value={d.id} selected={d.id === service()}>
                      {d.displayName}
                      {providerGaps(d.id) ? ' — needs setup' : ''}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </div>
          <div class="row">
            <button
              type="button"
              class="chip"
              classList={{ on: alwaysOn() }}
              aria-pressed={alwaysOn()}
              on:click={onAlwaysClick}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <span>Always</span>
            </button>
            <button type="button" class="chip" on:click={onSettingsClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5H9.5L9 4.4a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
              </svg>
              <span>Settings</span>
            </button>
            <button type="button" class="chip" on:click={onHideClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span>Hide</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
