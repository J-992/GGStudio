/** Touch-first garage layout controller. */

import './editor-mobile.css';

import { Collapsible } from '../ui/Collapsible.ts';
import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';

const PALETTE_STORAGE_KEY = 'zm.garage.palette';
const BUILD_CARD_STORAGE_KEY = 'zm.garage.buildcard';
const COMPACT_BREAKPOINT = 720;
const SWIPE_THRESHOLD_PX = 24;

let nextPaletteId = 1;

/** Controls the touch-only presentation layered over the ordinary garage DOM. */
export interface MobileGarage {
  /** Re-applies viewport defaults after the usable width changes. */
  refresh(): void;
  /** Opens or closes the parts drawer without synthesising pointer input. */
  setPaletteOpen(open: boolean): void;
  /** Temporarily folds nonessential panels while a modal owns the screen. */
  setCompact(compact: boolean): void;
  /** Detaches the controller and restores the desktop DOM it inherited. */
  dispose(): void;
}

/**
 * Folds the garage into something a thumb can drive.
 *
 * Hybrid tablets can change their primary pointer while the editor is alive,
 * so the returned controller remains subscribed even when its first install is
 * a no-op. The desktop DOM is restored between transitions rather than rebuilt;
 * editor state and the part tiles' pointer-capture listeners stay untouched.
 */
export function installMobileGarage(root: HTMLElement): MobileGarage {
  let installed = false;
  let disposed = false;
  let compact = false;
  let paletteOpenPreference = false;
  let buildCardCollapsedPreference = false;
  let buildCardHasPreference = false;
  let applyingBuildCardState = false;
  let refreshFrame: number | null = null;
  let palette: HTMLElement | null = null;
  let buildCard: HTMLElement | null = null;
  let topbar: HTMLElement | null = null;
  let handle: HTMLButtonElement | null = null;
  let buildCardCollapsible: Collapsible | null = null;
  let generatedPaletteId: string | null = null;
  let originalBuildCardCollapsed = false;
  let originalBuildCardDataCollapsed: string | null = null;
  let activePointerId: number | null = null;
  let pointerStartY = 0;
  let pointerLastY = 0;
  let pointerSwiped = false;
  let suppressNextClick = false;
  let suppressClickTimer: number | null = null;

  const readStoredBoolean = (key: string): boolean | null => {
    try {
      const value = localStorage.getItem(key);
      if (value === 'true') return true;
      if (value === 'false') return false;
    } catch {
      // Sandboxed frames and Safari private mode may reject storage outright.
    }
    return null;
  };

  const readStoredValue = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const writeStoredBoolean = (key: string, value: boolean): void => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Persistence is optional; the in-memory drawer must remain usable.
    }
  };

  const restoreStoredValue = (key: string, value: string | null): void => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Restoring a preference is best-effort for the same storage constraints.
    }
  };

  const applyPaletteState = (): void => {
    const open = !compact && paletteOpenPreference;
    root.setAttribute('data-palette-open', open ? 'true' : 'false');
    palette?.classList.toggle('is-drawer-closed', !open);
    handle?.setAttribute('aria-expanded', String(open));
    handle?.setAttribute(
      'aria-label',
      `${open ? 'Close' : 'Open'} parts drawer`,
    );
  };

  const setPalettePreference = (open: boolean, persist: boolean): void => {
    paletteOpenPreference = open;
    if (persist) writeStoredBoolean(PALETTE_STORAGE_KEY, open);
    applyPaletteState();
  };

  // Collapsible persists ordinary user toggles. Layout-only folds preserve the
  // prior raw value so opening a modal or rotating a phone is not a preference.
  const applyBuildCardState = (collapsed: boolean): void => {
    if (!buildCardCollapsible) return;
    const storedValue = readStoredValue(BUILD_CARD_STORAGE_KEY);
    applyingBuildCardState = true;
    try {
      buildCardCollapsible.setCollapsed(collapsed);
    } finally {
      applyingBuildCardState = false;
      restoreStoredValue(BUILD_CARD_STORAGE_KEY, storedValue);
    }
  };

  const updateBuildCardState = (): void => {
    applyBuildCardState(compact ? true : buildCardCollapsedPreference);
  };

  const refresh = (): void => {
    if (!installed) return;

    const narrow = root.getBoundingClientRect().width < COMPACT_BREAKPOINT;
    topbar?.toggleAttribute('data-density', narrow);

    if (!buildCardHasPreference) {
      buildCardCollapsedPreference = narrow;
      updateBuildCardState();
    }

    // The report only renders one blocking issue, marked by ui.ts structurally.
    // Mirroring that class avoids brittle copies of user-facing validation text.
    const hasBlockingIssue = buildCard?.querySelector('.issue-error') !== null;
    const buildToggle = buildCard?.querySelector<HTMLElement>(
      '.collapsible-toggle',
    );
    buildToggle?.toggleAttribute('data-alert', hasBlockingIssue);
  };

  const scheduleRefresh = (): void => {
    if (refreshFrame !== null) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      refresh();
    });
  };

  const finishHandlePointer = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId || !handle) return;
    pointerLastY = event.clientY;
    const deltaY = pointerLastY - pointerStartY;
    if (!pointerSwiped && Math.abs(deltaY) > SWIPE_THRESHOLD_PX) {
      pointerSwiped = true;
      setPalettePreference(deltaY < 0, true);
    }

    const releasedPointerId = activePointerId;
    activePointerId = null;
    if (handle.hasPointerCapture(releasedPointerId)) {
      handle.releasePointerCapture(releasedPointerId);
    }

    if (!pointerSwiped) return;
    suppressNextClick = true;
    if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = window.setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = null;
    }, 0);
  };

  const onHandlePointerDown = (event: PointerEvent): void => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      activePointerId !== null ||
      !handle
    ) {
      return;
    }
    activePointerId = event.pointerId;
    pointerStartY = event.clientY;
    pointerLastY = event.clientY;
    pointerSwiped = false;
    handle.setPointerCapture(event.pointerId);
  };

  const onHandlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    pointerLastY = event.clientY;
    const deltaY = pointerLastY - pointerStartY;
    if (pointerSwiped || Math.abs(deltaY) <= SWIPE_THRESHOLD_PX) return;
    pointerSwiped = true;
    setPalettePreference(deltaY < 0, true);
  };

  const onHandleClick = (event: MouseEvent): void => {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }
    setPalettePreference(!paletteOpenPreference, true);
  };

  const install = (): void => {
    if (installed || disposed) return;
    installed = true;
    root.setAttribute('data-mobile-garage', 'on');

    // ui.ts currently calls these panels garage-dock and vehicle-stats. The
    // legacy names remain supported so the controller survives their rename.
    palette = root.querySelector<HTMLElement>('.palette, .garage-dock');
    buildCard = root.querySelector<HTMLElement>('.build-card, .vehicle-stats');
    topbar = root.querySelector<HTMLElement>('.topbar');

    paletteOpenPreference = readStoredBoolean(PALETTE_STORAGE_KEY) ?? false;

    if (palette) {
      if (!palette.id) {
        let candidate: string;
        do {
          candidate = `garage-parts-drawer-${nextPaletteId}`;
          nextPaletteId += 1;
        } while (document.getElementById(candidate));
        palette.id = candidate;
        generatedPaletteId = candidate;
      }

      handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'garage-drawer-handle';
      handle.textContent = 'PARTS';
      handle.setAttribute('data-touch-passthrough', '');
      handle.setAttribute('aria-controls', palette.id);
      handle.setAttribute('aria-label', 'Open parts drawer');
      handle.addEventListener('pointerdown', onHandlePointerDown);
      handle.addEventListener('pointermove', onHandlePointerMove);
      handle.addEventListener('pointerup', finishHandlePointer);
      handle.addEventListener('pointercancel', finishHandlePointer);
      handle.addEventListener('click', onHandleClick);
      root.appendChild(handle);
    }

    if (buildCard) {
      originalBuildCardCollapsed = buildCard.classList.contains('is-collapsed');
      originalBuildCardDataCollapsed = buildCard.getAttribute('data-collapsed');
      const storedBuildCardState = readStoredBoolean(BUILD_CARD_STORAGE_KEY);
      buildCardHasPreference = storedBuildCardState !== null;
      buildCardCollapsedPreference =
        storedBuildCardState ??
        root.getBoundingClientRect().width < COMPACT_BREAKPOINT;
      buildCardCollapsible = new Collapsible({
        panel: buildCard,
        label: 'Build report',
        startCollapsed: buildCardCollapsedPreference,
        storageKey: BUILD_CARD_STORAGE_KEY,
        onToggle: (collapsed) => {
          if (applyingBuildCardState) return;
          buildCardHasPreference = true;
          buildCardCollapsedPreference = collapsed;
        },
      });
    }

    applyPaletteState();
    updateBuildCardState();
    refresh();
    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('orientationchange', scheduleRefresh);
  };

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('orientationchange', scheduleRefresh);
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    refreshFrame = null;
    if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = null;

    if (handle) {
      handle.removeEventListener('pointerdown', onHandlePointerDown);
      handle.removeEventListener('pointermove', onHandlePointerMove);
      handle.removeEventListener('pointerup', finishHandlePointer);
      handle.removeEventListener('pointercancel', finishHandlePointer);
      handle.removeEventListener('click', onHandleClick);
      handle.remove();
    }
    handle = null;
    activePointerId = null;

    buildCardCollapsible?.dispose();
    buildCardCollapsible = null;
    if (buildCard) {
      buildCard.classList.toggle('is-collapsed', originalBuildCardCollapsed);
      if (originalBuildCardDataCollapsed === null) {
        buildCard.removeAttribute('data-collapsed');
      } else {
        buildCard.setAttribute(
          'data-collapsed',
          originalBuildCardDataCollapsed,
        );
      }
    }

    if (palette) {
      palette.classList.remove('is-drawer-closed');
      if (generatedPaletteId && palette.id === generatedPaletteId) {
        palette.removeAttribute('id');
      }
    }
    topbar?.removeAttribute('data-density');
    root.removeAttribute('data-palette-open');
    root.removeAttribute('data-mobile-garage');

    palette = null;
    buildCard = null;
    topbar = null;
    generatedPaletteId = null;
  };

  const unsubscribe = onTouchControlsChange((enabled) => {
    if (enabled) install();
    else uninstall();
  });
  if (shouldUseTouchControls()) install();

  return {
    refresh,
    setPaletteOpen: (open) => {
      if (!installed) return;
      setPalettePreference(open, true);
    },
    setCompact: (nextCompact) => {
      if (compact === nextCompact) return;
      compact = nextCompact;
      if (!installed) return;
      applyPaletteState();
      updateBuildCardState();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      uninstall();
    },
  };
}
