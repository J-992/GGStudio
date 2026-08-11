import { Collapsible } from '../ui/Collapsible.ts';
import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';
import './survival-mobile.css';

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
  private readonly inheritedMobileHudValue: string | null;
  private readonly topBandMoves: Array<{
    element: HTMLElement;
    placeholder: Comment;
  }> = [];
  private minimapPanel: Collapsible | null = null;
  private minimapBackdrop: HTMLDivElement | null = null;
  private minimapToggle: HTMLButtonElement | null = null;
  private topBand: HTMLDivElement | null = null;
  private compactRestore: boolean | null = null;
  private unsubscribeTouchControls: (() => void) | null = null;
  private active = false;
  private compact = false;
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    this.inheritedMobileHudValue = root.getAttribute('data-mobile-hud');

    // Desktop pays only for the device-change subscription. DOM mutations stay
    // untouched until touch controls are actually in use.
    this.setTouchLayoutEnabled(shouldUseTouchControls());
    this.unsubscribeTouchControls = onTouchControlsChange(
      this.handleTouchControlsChange,
    );
  }

  /** Keep generated controls in sync after SurvivalMode's viewport refresh. */
  refresh(): void {
    if (!this.active) return;
    this.syncMinimapPresentation(this.minimapPanel?.collapsed ?? true);
  }

  /** Temporarily clear the map while a blocking card owns the view. */
  setCompact(compact: boolean): void {
    if (this.disposed || compact === this.compact) return;

    this.compact = compact;
    if (!this.active) return;

    if (compact) {
      this.compactRestore = this.minimapPanel?.collapsed ?? true;
      this.minimapPanel?.setCollapsed(true);
      return;
    }

    const restore = this.compactRestore;
    this.compactRestore = null;
    if (restore !== null) this.minimapPanel?.setCollapsed(restore);
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

  private readonly handleMinimapBackdropClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.minimapPanel?.setCollapsed(true);
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
    this.installTopBand();

    const minimap = this.root.querySelector<HTMLElement>('.minimap');
    if (minimap !== null) {
      // The dimmer is a sibling so the map can stay above it and every point
      // outside the map remains a one-tap close target.
      const backdrop = this.root.ownerDocument.createElement('div');
      backdrop.className = 'survival-minimap-backdrop';
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.addEventListener('click', this.handleMinimapBackdropClick);
      minimap.before(backdrop);
      this.minimapBackdrop = backdrop;

      const panel = new Collapsible({
        panel: minimap,
        label: 'Open minimap',
        startCollapsed: true,
        onToggle: (collapsed) => this.syncMinimapPresentation(collapsed),
      });
      this.minimapPanel = panel;
      this.minimapToggle = minimap.querySelector<HTMLButtonElement>(
        ':scope > .collapsible-toggle',
      );
      this.syncMinimapPresentation(panel.collapsed);
    }

    this.active = true;
    if (this.compact) {
      this.compactRestore = this.minimapPanel?.collapsed ?? true;
      this.minimapPanel?.setCollapsed(true);
    }
  }

  private deactivate(): void {
    if (!this.active) return;

    this.minimapPanel?.dispose();
    this.minimapPanel = null;
    this.minimapToggle = null;

    this.minimapBackdrop?.removeEventListener(
      'click',
      this.handleMinimapBackdropClick,
    );
    this.minimapBackdrop?.remove();
    this.minimapBackdrop = null;
    this.compactRestore = null;
    this.restoreTopBand();

    if (this.inheritedMobileHudValue === null) {
      this.root.removeAttribute('data-mobile-hud');
    } else {
      this.root.setAttribute('data-mobile-hud', this.inheritedMobileHudValue);
    }
    this.active = false;
  }

  private installTopBand(): void {
    const band = this.root.ownerDocument.createElement('div');
    band.className = 'survival-mobile-top-band';
    band.setAttribute('aria-label', 'Driving and wave status');
    band.setAttribute('role', 'group');
    this.root.prepend(band);
    this.topBand = band;

    // Moving the existing readouts makes one real band instead of several
    // independently positioned panels. Placeholders make the move reversible.
    for (const selector of [
      '.survival-settings-button',
      '.survival-driver-hud',
      '.survival-boss-hud',
      '.wave-timeline',
      '.survival-cash',
      '.survival-buffs',
      '.survival-pickup',
      '.survival-warnings',
      '.survival-scuttle-banner',
    ]) {
      const element = this.root.querySelector<HTMLElement>(
        `:scope > ${selector}`,
      );
      if (element === null) continue;

      const placeholder = this.root.ownerDocument.createComment(
        'survival-mobile-top-band',
      );
      element.before(placeholder);
      band.appendChild(element);
      this.topBandMoves.push({ element, placeholder });
    }
  }

  private restoreTopBand(): void {
    for (const move of this.topBandMoves) {
      move.placeholder.replaceWith(move.element);
    }
    this.topBandMoves.length = 0;
    this.topBand?.remove();
    this.topBand = null;
  }

  private syncMinimapPresentation(collapsed: boolean): void {
    if (this.minimapBackdrop !== null) {
      this.minimapBackdrop.hidden = collapsed;
    }
    if (this.minimapToggle !== null) {
      const label = collapsed ? 'Open minimap' : 'Close minimap';
      this.minimapToggle.setAttribute('aria-label', label);
      this.minimapToggle.title = label;
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
export function installSurvivalMobileHud(root: HTMLElement): SurvivalMobileHud {
  return new SurvivalMobileHudController(root);
}
