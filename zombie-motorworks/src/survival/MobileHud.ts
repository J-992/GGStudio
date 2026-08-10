import { Collapsible } from '../ui/Collapsible.ts';
import {
  onTouchControlsChange,
  shouldUseTouchControls,
} from '../ui/device.ts';
import './survival-mobile.css';

const DRIVER_STORAGE_KEY = 'zm.hud.driver';
const MINIMAP_STORAGE_KEY = 'zm.hud.minimap';
/**
 * A phone in landscape is barely 400 px tall, and an expanded map immediately
 * collides with the ability rail on the same edge. It starts folded on every
 * touch layout and unfolds on a tap — glancing at the arena is a deliberate
 * act, not something worth surrendering a permanent corner to.
 */
const NARROW_MINIMAP_WIDTH_PX = Number.POSITIVE_INFINITY;

interface MobilePanel {
  readonly collapsible: Collapsible;
  readonly storageKey: string;
}

/** Controls the touch-first presentation layered over the survival HUD. */
export interface SurvivalMobileHud {
  /** Re-evaluate layout after a resize or orientation change. */
  refresh(): void;
  /** Collapse everything collapsible — used when a modal opens. */
  setCompact(compact: boolean): void;
  /** Remove mobile-only controls, attributes, and global listeners. */
  dispose(): void;
}

/**
 * Owns the optional touch layout without making SurvivalMode care when the
 * primary pointer changes. Convertible tablets can switch between mouse and
 * touch during a run, so activation is deliberately reversible.
 */
class SurvivalMobileHudController implements SurvivalMobileHud {
  private readonly view: Window | null;
  private readonly panels: MobilePanel[] = [];
  private minimapPanel: MobilePanel | null = null;
  private compactRestore: ReadonlyMap<MobilePanel, boolean> | null = null;
  private unsubscribeTouchControls: (() => void) | null = null;
  private resizeFrame: number | null = null;
  private active = false;
  private compact = false;
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    this.view = root.ownerDocument.defaultView;

    // Desktop pays only for the device-change subscription. DOM and viewport
    // listeners stay untouched until touch controls are actually in use.
    this.setTouchLayoutEnabled(shouldUseTouchControls());
    this.unsubscribeTouchControls = onTouchControlsChange(
      this.handleTouchControlsChange,
    );
  }

  /** Re-apply responsive defaults that are not already a player preference. */
  refresh(): void {
    if (!this.active || this.compact) return;

    const minimapPanel = this.minimapPanel;
    if (
      minimapPanel === null ||
      this.hasStoredPreference(minimapPanel.storageKey)
    ) {
      return;
    }

    // Width is the useful constraint even in portrait: a tall, narrow screen
    // has vertical room but not enough arena width for a permanently open map.
    const viewportWidth = this.view?.innerWidth ?? this.root.clientWidth;
    this.setCollapsedWithoutPersisting(
      minimapPanel,
      viewportWidth < NARROW_MINIMAP_WIDTH_PX,
    );
  }

  /** Temporarily clear peripheral panels while a blocking card owns the view. */
  setCompact(compact: boolean): void {
    if (this.disposed || compact === this.compact) return;

    this.compact = compact;
    if (!this.active) return;

    if (compact) {
      this.collapseForCompactMode();
    } else {
      this.restoreFromCompactMode();
    }
  }

  /** Release every listener and DOM mutation owned by this adapter. */
  dispose(): void {
    if (this.disposed) return;

    this.unsubscribeTouchControls?.();
    this.unsubscribeTouchControls = null;
    this.deactivate();
    this.disposed = true;
  }

  private readonly handleTouchControlsChange = (enabled: boolean): void => {
    this.setTouchLayoutEnabled(enabled);
  };

  private readonly scheduleRefresh = (): void => {
    if (this.resizeFrame !== null || this.view === null) return;

    // Resize and orientationchange often arrive together. One animation-frame
    // boundary lets browser viewport and safe-area values settle before layout.
    this.resizeFrame = this.view.requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.refresh();
    });
  };

  private setTouchLayoutEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.active) return;

    if (enabled) {
      this.activate();
    } else {
      this.deactivate();
    }
  }

  private activate(): void {
    this.root.setAttribute('data-mobile-hud', 'on');

    const driverHud =
      this.root.querySelector<HTMLElement>('.survival-driver-hud');
    if (driverHud !== null) {
      this.panels.push({
        collapsible: new Collapsible({
          panel: driverHud,
          label: 'Driver HUD',
          storageKey: DRIVER_STORAGE_KEY,
        }),
        storageKey: DRIVER_STORAGE_KEY,
      });
    }

    const minimap = this.root.querySelector<HTMLElement>('.minimap');
    if (minimap !== null) {
      const minimapPanel = {
        collapsible: new Collapsible({
          panel: minimap,
          label: 'Minimap',
          startCollapsed: this.viewportIsNarrow(),
          storageKey: MINIMAP_STORAGE_KEY,
        }),
        storageKey: MINIMAP_STORAGE_KEY,
      };
      this.minimapPanel = minimapPanel;
      this.panels.push(minimapPanel);
    }

    this.view?.addEventListener('resize', this.scheduleRefresh);
    this.view?.addEventListener('orientationchange', this.scheduleRefresh);
    this.active = true;
    this.refresh();

    if (this.compact) this.collapseForCompactMode();
  }

  private deactivate(): void {
    if (!this.active) return;

    this.view?.removeEventListener('resize', this.scheduleRefresh);
    this.view?.removeEventListener('orientationchange', this.scheduleRefresh);
    if (this.resizeFrame !== null && this.view !== null) {
      this.view.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }

    // Collapsible.dispose expands the original node and removes any ID it had
    // to synthesize, returning the desktop DOM to exactly its pre-mobile shape.
    for (const panel of this.panels) panel.collapsible.dispose();
    this.panels.length = 0;
    this.minimapPanel = null;
    this.compactRestore = null;
    this.root.removeAttribute('data-mobile-hud');
    this.active = false;
  }

  private collapseForCompactMode(): void {
    const restore = new Map<MobilePanel, boolean>();
    for (const panel of this.panels) {
      restore.set(panel, panel.collapsible.collapsed);
      this.setCollapsedWithoutPersisting(panel, true);
    }
    this.compactRestore = restore;
  }

  private restoreFromCompactMode(): void {
    const restore = this.compactRestore;
    this.compactRestore = null;
    if (restore === null) return;

    for (const panel of this.panels) {
      const collapsed = restore.get(panel);
      if (collapsed !== undefined) {
        this.setCollapsedWithoutPersisting(panel, collapsed);
      }
    }
  }

  private viewportIsNarrow(): boolean {
    const viewportWidth = this.view?.innerWidth ?? this.root.clientWidth;
    return viewportWidth < NARROW_MINIMAP_WIDTH_PX;
  }

  private hasStoredPreference(storageKey: string): boolean {
    try {
      const stored = this.view?.localStorage.getItem(storageKey);
      return stored === 'true' || stored === 'false';
    } catch {
      // Sandboxed embeds and private modes may deny storage altogether. In that
      // case the responsive fallback remains useful for the current run.
      return false;
    }
  }

  private setCollapsedWithoutPersisting(
    panel: MobilePanel,
    collapsed: boolean,
  ): void {
    let storage: Storage | null = null;
    let previousValue: string | null = null;
    let canRestoreStorage = false;

    try {
      storage = this.view?.localStorage ?? null;
      if (storage !== null) {
        previousValue = storage.getItem(panel.storageKey);
        canRestoreStorage = true;
      }
    } catch {
      // Collapsible already treats unavailable storage as non-fatal.
    }

    panel.collapsible.setCollapsed(collapsed);

    if (!canRestoreStorage || storage === null) return;
    try {
      if (previousValue === null) {
        storage.removeItem(panel.storageKey);
      } else {
        storage.setItem(panel.storageKey, previousValue);
      }
    } catch {
      // A failed restoration must not strand the HUD in the wrong visual state.
    }
  }
}

/**
 * Make the survival HUD survive a phone screen.
 *
 * Pointer-precise sessions receive no DOM changes. The returned controller
 * still watches the primary input because a tablet can gain or lose a mouse
 * without SurvivalMode being reconstructed.
 */
export function installSurvivalMobileHud(
  root: HTMLElement,
): SurvivalMobileHud {
  return new SurvivalMobileHudController(root);
}
