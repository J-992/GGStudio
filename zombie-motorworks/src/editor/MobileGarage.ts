/** Touch-first garage layout controller. */

import './editor-mobile.css';

import { Collapsible } from '../ui/Collapsible.ts';
import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';

const PALETTE_STORAGE_KEY = 'zm.garage.palette';
const BUILD_CARD_STORAGE_KEY = 'zm.garage.buildcard';
/**
 * Width below which the garage folds by default.
 *
 * Infinite because this controller only ever runs on a coarse pointer, and
 * every such screen is over-subscribed: a phone held in landscape is barely
 * 390 px tall, so the build report expanded means it lands on top of the
 * abilities panel and the hotbar. It stays one tap away instead.
 */
const COMPACT_BREAKPOINT = Number.POSITIVE_INFINITY;
const SWIPE_THRESHOLD_PX = 24;

const COMPACT_BUTTON_GLYPHS: Readonly<Record<string, string>> = {
  'New Garage': '+',
  Menu: '☰',
  'Save & Quit': '⇥',
  Tutorial: '?',
  Help: 'i',
  Share: '↗',
  'Test Drive': '▶',
};

interface RestoredAttribute {
  element: HTMLElement;
  name: string;
  value: string | null;
}

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
  const restoredAttributes: RestoredAttribute[] = [];

  const setTemporaryAttribute = (
    element: HTMLElement,
    name: string,
    value: string,
  ): void => {
    restoredAttributes.push({
      element,
      name,
      value: element.getAttribute(name),
    });
    element.setAttribute(name, value);
  };

  const decorateCompactTopbar = (): void => {
    if (!topbar) return;

    const nameInput = topbar.querySelector<HTMLElement>('.garage-name');
    if (nameInput && !nameInput.hasAttribute('aria-label')) {
      setTemporaryAttribute(nameInput, 'aria-label', 'Vehicle name');
    }

    const viewSelect = topbar.querySelector<HTMLElement>('select');
    if (viewSelect && !viewSelect.hasAttribute('aria-label')) {
      setTemporaryAttribute(viewSelect, 'aria-label', 'Garage view');
    }

    for (const button of topbar.querySelectorAll<HTMLButtonElement>('button')) {
      const label = button.textContent?.trim();
      if (!label) continue;
      if (!button.hasAttribute('aria-label')) {
        setTemporaryAttribute(button, 'aria-label', label);
      }
      const glyph = COMPACT_BUTTON_GLYPHS[label];
      if (glyph) setTemporaryAttribute(button, 'data-mobile-glyph', glyph);
    }
  };

  const restoreTemporaryAttributes = (): void => {
    for (const { element, name, value } of restoredAttributes.reverse()) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    restoredAttributes.length = 0;
  };

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
    // `toggleAttribute` writes an empty value, and every compact rule selects
    // on `[data-density='compact']` — so the whole compact layer silently never
    // applied. The value has to be set explicitly.
    if (narrow) topbar?.setAttribute('data-density', 'compact');
    else topbar?.removeAttribute('data-density');

    // The notice card and anything else pinned below the bar cannot use a fixed
    // offset: the bar wraps to two rows on a narrow screen and to one on a wide
    // one. Publishing its measured height lets the stylesheet follow it.
    if (topbar) {
      root.style.setProperty(
        '--garage-topbar-h',
        `${Math.round(topbar.getBoundingClientRect().height)}px`,
      );
    }

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
    decorateCompactTopbar();

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
      // Choosing a part is the last thing the drawer is for. Leaving it open
      // means the sheet is covering the very grid the player now has to tap,
      // so the drawer gets out of the way the moment a tile is picked.
      palette.addEventListener('click', onPaletteChoice);
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

  /** Close the drawer once a tile hands the player something to place. */
  const onPaletteChoice = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    // Only the part tiles themselves. Category tabs, the search field and the
    // panel header all live in here too and must leave the sheet open.
    if (!event.target.closest('.part-btn')) return;
    // Not persisted: the player asked for a part, not for the drawer to stay
    // shut next time they open the garage.
    setPalettePreference(false, false);
  };

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('orientationchange', scheduleRefresh);
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    refreshFrame = null;
    palette?.removeEventListener('click', onPaletteChoice);
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
    root.style.removeProperty('--garage-topbar-h');
    restoreTemporaryAttributes();
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
