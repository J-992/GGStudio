import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';
import './survival-mobile.css';

/** Controls the touch-first presentation layered over the survival HUD. */
export interface SurvivalMobileHud {
  /** Re-evaluate layout after a resize or orientation change. */
  refresh(): void;
  /** Clear what a blocking card should not be read through. */
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
  private topBand: HTMLDivElement | null = null;
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

  /** Nothing generated here is measured, so a resize needs no repair. */
  refresh(): void {}

  /** Drop the map while a blocking card owns the view. */
  setCompact(compact: boolean): void {
    if (this.disposed || compact === this.compact) return;

    this.compact = compact;
    if (!this.active) return;
    this.syncCompact();
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
    this.active = true;
    this.syncCompact();
  }

  private deactivate(): void {
    if (!this.active) return;

    this.restoreTopBand();
    this.root.removeAttribute('data-mobile-compact');

    if (this.inheritedMobileHudValue === null) {
      this.root.removeAttribute('data-mobile-hud');
    } else {
      this.root.setAttribute('data-mobile-hud', this.inheritedMobileHudValue);
    }
    this.active = false;
  }

  private syncCompact(): void {
    if (this.compact) {
      this.root.setAttribute('data-mobile-compact', 'on');
      return;
    }
    this.root.removeAttribute('data-mobile-compact');
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
    //
    // The map and the emergency prompts join it even though neither sits in
    // the row: the map has to land in the top-right corner the band already
    // owns, and the prompts hang off the band's bottom edge so a boss bar that
    // grows the band pushes them down rather than landing on them.
    for (const selector of [
      '.survival-settings-button',
      '.survival-driver-hud',
      '.survival-boss-hud',
      '.wave-timeline',
      '.survival-cash',
      '.minimap',
      '.survival-buffs',
      '.survival-pickup',
      '.survival-warnings',
      '.survival-prompts',
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
      // A moved readout can be torn down by its own owner first — the minimap
      // disposes ahead of this adapter — and putting a removed element back
      // would resurrect it. Only what is still in the band comes home.
      if (move.element.parentNode === this.topBand) {
        move.placeholder.replaceWith(move.element);
      } else {
        move.placeholder.remove();
      }
    }
    this.topBandMoves.length = 0;
    this.topBand?.remove();
    this.topBand = null;
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
