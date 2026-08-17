/**
 * The signature strike's recharge, drawn as a bar instead of a reticle.
 *
 * On desktop the gauge is the scope cursor: the brackets fill as the strike
 * recharges, so the cadence is read off the thing the eye is already on. Touch
 * has no cursor to hang that on — the reticle is hidden outright on a phone —
 * which left the one weapon the player fires by hand with no readout at all
 * and no way to tell a strike on cooldown from a tap the game had missed.
 *
 * So the same number becomes a bar, sat directly above the ability row: fills
 * left to right as it charges, goes live when it is ready, and kicks sideways
 * in red when a tap is refused. It is decoration on desktop — the CSS only
 * shows it under the touch HUD.
 */
export class StrikeGauge {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private denyTimer: number | null = null;
  /** Last fraction written, so a steady bar costs no style writes per frame. */
  private appliedFill = -1;
  private ready = true;
  /** The combat HUD is up (countdown or wave), rather than a results card. */
  private phaseVisible = false;
  /** The rig actually carries a signature block. */
  private available = false;

  private readonly finishDenyFlash = (): void => {
    this.root.classList.remove('is-denied');
    this.denyTimer = null;
  };

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'survival-strike-gauge is-ready';
    // A bar that only ever restates a cooldown the ability boxes already
    // announce is noise to a screen reader.
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;

    const label = document.createElement('span');
    label.className = 'survival-strike-gauge__label';
    label.textContent = 'Strike';
    const track = document.createElement('span');
    track.className = 'survival-strike-gauge__track';
    const fill = document.createElement('span');
    fill.className = 'survival-strike-gauge__fill';
    track.appendChild(fill);

    root.append(label, track);
    parent.appendChild(root);
    this.root = root;
    this.fill = fill;
  }

  /** Show or hide with the rest of the fighting HUD. */
  setVisible(visible: boolean): void {
    if (this.phaseVisible === visible) return;
    this.phaseVisible = visible;
    this.syncHidden();
  }

  /**
   * Set how full the bar reads, 0 (just fired) to 1 (ready).
   *
   * Quantised to whole percent before it is written, so a cooldown ticking
   * every frame costs at most one style write per visible step.
   */
  setCooldown(fraction: number): void {
    if (!this.available) {
      this.available = true;
      this.syncHidden();
    }
    const clamped = Math.max(0, Math.min(1, fraction));
    const stepped = Math.round(clamped * 100) / 100;
    if (stepped === this.appliedFill) return;
    this.appliedFill = stepped;
    this.fill.style.transform = `scaleX(${stepped})`;
    const ready = stepped >= 1;
    if (ready === this.ready) return;
    this.ready = ready;
    this.root.classList.toggle('is-ready', ready);
  }

  /**
   * Drop the bar entirely, for a rig carrying no signature block. A
   * permanently full gauge would read as a weapon the player has and cannot
   * find the button for.
   */
  clearCooldown(): void {
    if (!this.available) return;
    this.available = false;
    this.syncHidden();
  }

  /** Refuse a tap: the bar goes red and kicks sideways for a moment. */
  flashDenied(): void {
    if (this.denyTimer !== null) {
      window.clearTimeout(this.denyTimer);
      this.denyTimer = null;
    }
    this.root.classList.remove('is-denied');
    // Same keyframe restart the reticle uses, so mashing a strike on cooldown
    // kicks once per tap rather than reading as one long wobble.
    void this.root.offsetWidth;
    this.root.classList.add('is-denied');
    this.denyTimer = window.setTimeout(this.finishDenyFlash, 240);
  }

  dispose(): void {
    if (this.denyTimer !== null) window.clearTimeout(this.denyTimer);
    this.denyTimer = null;
    this.root.remove();
  }

  private syncHidden(): void {
    this.root.hidden = !(this.phaseVisible && this.available);
  }
}
