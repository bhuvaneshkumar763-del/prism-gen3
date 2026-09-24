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
 * The always-on floating translate bubble. Full parity with the
 * pre-rewrite fork's version (draggable, edge-docked, a hover/long-press
 * panel with From/To/Service pickers and Always/Settings/Hide chips) plus
 * one state the fork never had: a "Translation failed" state (see
 * `props.state.errorMessage`) that takes priority over the normal
 * translated/original rendering so a false "Translated" success is never
 * shown while a batch has actually been failing (see
 * `src/engine/pageTranslator/translateLoop.ts`'s `onError` doc comment).
 *
 * Rendered exactly once by `mountBubble.ts` into a shadow root — `props.state`
 * is the reactive store itself (not spread primitives), so this component's
 * JSX re-renders fine-grained on every `mountBubble.ts` `update()` without
 * this component ever being torn down and recreated. Everything else here
 * (drag position, pinned/panel, target/source language, service, always-on)
 * is local `createSignal` state seeded once from `configStore` in the
 * component body and kept live via `configStore.onChanged` — never a direct
 * `configStore.get()` read inside JSX (see `scripts/check-solid-reactivity.mjs`).
 */

export interface FloatingBubbleProps {
  state: BubbleViewState;
  hostname: string;
  shadowHost: HTMLElement;
  /**
   * `sourceLanguage`, when passed, forces that language for this one
   * retranslate — the From picker's use — rather than persisting into
   * every future request the way it used to (real bug: that forced
   * mistranslation of already-correct content, see `onSourceLanguageChange`
   * below).
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
      llmBaseUrl: configStore.get('llmBaseUrl'),
      llmApiKey: configStore.get('llmApiKey'),
      llmModel: configStore.get('llmModel'),
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
    return pinned() || wrap.matches(':hover') || panel.matches(':focus-within');
  }

  function applyState(): Point {
    const point = resolveDockedPoint(dockState, viewport(), BALL_SIZE);
    wrap.style.left = `${point.x}px`;
    wrap.style.top = `${point.y}px`;
    wrap.classList.toggle('right', isRightEdge(point.x, vw(), BALL_SIZE));
    // Only measure the panel while it's actually showing — the measurement
    // is a forced layout read, and the panel is hidden nearly all the time.
    // Every way of opening it (pointerenter, focusin, long-press, ArrowDown)
    // already re-measures right before it appears, so nothing goes stale.
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
   * Speed fix, found via a UI audit: resize and visualViewport resize/scroll
   * used to run applyState() synchronously on every event, each one a
   * forced layout read — and on iOS visualViewport fires continuously during
   * pinch-zoom and as the toolbar collapses. Now at most once per frame.
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
    // No-op while offline — translateLoop.ts already auto-resumes the
    // instant connectivity returns (see connectivity.ts), and the button
    // is disabled in this state anyway (see the JSX below); this guard is
    // the belt-and-braces version in case handlePrimaryAction is ever
    // reachable some other way.
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
    // actionBusy alone (a fixed 600ms local guard) only protects against a
    // rapid double click/tap — a real translation on a slow page/provider
    // easily outlasts 600ms, and the ball button (unlike the panel's
    // .primary button) has no `disabled` binding, since disabling it would
    // also block the pointerdown/pointermove/pointerup drag handlers this
    // same element uses to reposition the bubble. Checking the real
    // props.state.busy here closes that gap without losing drag-while-busy.
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

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isTrusted) return;
      dragging = true;
      moved = false;
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
      if (!e.isTrusted) return;
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
          // Save failed — revert to the last-persisted position instead of
          // leaving the ball wherever it visually landed but never saved,
          // which would silently reset to the old spot on next page load.
          dockState = previousDockState;
          pos = applyState();
        });
      } else {
        toggleTranslate();
      }
    };
    /**
     * A drag interrupted by the browser taking over (e.g. this ball sits
     * near a screen edge and an OS/browser edge gesture — like Chrome's own
     * back-swipe — claims the pointer sequence mid-drag) used to leave
     * `dragging`/`moved` stuck true with no `pointerup` ever firing:
     * `previewAt()`'s last call is left applied as the *visual* position
     * (drawn directly via style, not persisted), so the ball can render at
     * a stale, never-saved spot until something else repositions it, and a
     * later click can be misread as "moved" from `onDocPointerDown`'s
     * pinned-state check. Snap back to the last real committed position.
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
      if (pinned() && e.target !== props.shadowHost) setPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    const onKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTranslate();
      } else if (e.key === 'ArrowDown') {
        // Real gap: the panel's only "open" triggers were :hover (mouse)
        // and a 450ms pointer long-press (touch) — a keyboard/screen-reader
        // user could reach the ball but had no way to open the panel at
        // all, since its controls sit at visibility:hidden until one of
        // those two fires and aren't in the tab order until then either.
        // ArrowDown is the standard disclosure-widget convention for "open
        // and move into the revealed content."
        e.preventDefault();
        setPinned(true);
        positionPanelNow();
        const firstControl = panel.querySelector<HTMLElement>('select, button, input, [tabindex]');
        firstControl?.focus();
      }
    };
    ball.addEventListener('keydown', onKeydown);

    // Escape from ANYWHERE in the bubble, not just the ball — real gap,
    // found via a UI audit: this used to live in the ball's own handler, so
    // once ArrowDown had moved focus into the panel (see above), Escape did
    // nothing. Returning focus to the ball is the standard disclosure
    // pattern, and now actually closes it: the panel is shown on
    // `.panel:focus-within`, not `.wrap:focus-within`, so focus resting on
    // the ball no longer holds it open (see bubbleStyles.ts).
    const onWrapKeydown = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.key !== 'Escape') return;
      setPinned(false);
      ball.focus();
    };
    wrap.addEventListener('keydown', onWrapKeydown);

    // Tabbing out of the bubble entirely closes a panel ArrowDown pinned
    // open. Previously only a pointer press elsewhere did, so a keyboard
    // user who tabbed away left it floating over the page. `relatedTarget`
    // is where focus is going; still inside the bubble means keep it open.
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
      else if (
        name === 'googleCloudTranslateApiKey' ||
        name === 'llmBaseUrl' ||
        name === 'llmApiKey' ||
        name === 'llmModel'
      )
        setSetupFields(readSetupFields());
      else if (name === 'alwaysTranslateSites')
        setAlwaysOn(siteListIncludesHostname(value as string[], props.hostname));
      else if (name === 'sourceLanguageByHost') {
        setSourceLanguageSignal(resolveSourceLanguageForHost(value as Record<string, string>, props.hostname, 'auto'));
      } else if (name === 'bubblePosition') {
        // Real gap: this header comment always claimed position stayed
        // live-synced via onChanged, but nothing here actually handled the
        // key — dragging the bubble in one tab left every other open tab's
        // bubble stale until its next reload. Also fires (harmlessly,
        // idempotently) for this instance's own writes in onPointerUp.
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
   * Handled, not fired with `void` — real bug, caught by CI: when nothing
   * answers (a restarting service worker, an extension context invalidated
   * by an update) an unhandled rejection surfaces as an "Uncaught (in
   * promise)" error in the host page's own console.
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
    // props.onClose() below hides the bubble in this session's DOM
    // immediately regardless — that's the correct, expected UX for the
    // click itself. A failed persist just means it can reappear on the
    // next page load instead of staying hidden; nothing else to roll back
    // here since this component holds no local "hidden" signal of its own.
    configStore
      .set('bubbleByHost', setBubbleVisibilityForHost(configStore.get('bubbleByHost'), props.hostname, false))
      .catch((e2) => console.warn('[prism] failed to save bubble-hidden preference', e2));
    props.onClose();
  }

  /**
   * Force-retranslates the current page from `code` right now — a one-off
   * correction for when auto-detection got the whole page wrong, not a
   * standing rule. `code` is still persisted to `sourceLanguageByHost` (so
   * the picker shows what you last chose, and it still feeds the
   * auto-translate-on-load decision), but it's no longer sent as the
   * source language on every future request the way it used to be: real
   * bug, confirmed against the live Google endpoint — a forced source
   * language on an already-correct-language fragment ("History" sent as
   * source=vi) came back mistranslated ("Association"), while the same
   * text sent as source=auto came back unchanged. A fresh page load goes
   * back to auto regardless of what's picked here.
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
    const id = (e.currentTarget as HTMLSelectElement).value as ProviderId;
    const previous = service();
    configStore.set('pageTranslatorProvider', id).catch((e2) => {
      console.warn('[prism] failed to save translation service', e2);
      setServiceSignal(previous);
    });
    setServiceSignal(id);
    // A provider that still needs setup opens Settings at its fields instead
    // of retranslating straight into a failure — see missingProviderSetup.
    if (providerGaps(id)) {
      openSettings('page');
      return;
    }
    props.onTranslate(targetLanguage());
  }

  // Real bug this replaced: `pageState` used to flip to 'translated'
  // (turning the bubble green) the instant a translate was requested, well
  // before any actual translation happened — `busy` (now driven by
  // translateLoop.ts's real `isWorking`/`onWorkingChange` activity signal,
  // see content.ts) must also have cleared before this counts as done.
  const translated = () => !props.state.errorMessage && props.state.pageState === 'translated' && !props.state.busy;
  const errored = () => Boolean(props.state.errorMessage);
  const offline = () => errored() && props.state.errorKind === 'offline';
  /**
   * What clicking the ball will actually do — real gap, found via a UI
   * audit: its accessible name was hard-coded to "Translate this page", so a
   * screen-reader user heard that even on a translated page (where a click
   * RESTORES it), a failed one (retries), or offline (does nothing). Mirrors
   * handlePrimaryAction's own branching above.
   */
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
    // No "Retry" while offline — translateLoop.ts already auto-resumes the
    // instant connectivity returns (see handlePrimaryAction above), so a
    // retry button here would just be a no-op the user has to notice does
    // nothing.
    if (offline()) return 'Waiting for connection…';
    if (errored()) return props.state.busy ? 'Retrying…' : 'Retry';
    if (translated()) return props.state.busy ? 'Restoring…' : 'Show original';
    return props.state.busy ? 'Translating…' : 'Translate page';
  };
  // Perceived-speed fix: shown only while genuinely busy AND there's a real
  // fraction to show — `progress` is `null` before the current cycle knows
  // its total yet (the brief gap the existing spinner already covers), and
  // this hides on `busy` going `false`, not on `progress` reaching `1` (see
  // `onProgressChange`'s doc comment, translateLoop.ts, for why `progress`
  // can legitimately settle short of `1` even on a fully finished translate).
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
