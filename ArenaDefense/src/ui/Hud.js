// In-gameplay HUD: hp/energy/wave readouts, the reticle, and placeholders
// (combo bar, boss bar) that later work packages (P5/P6) drive with real
// numbers. Every element is built in the constructor and appended to `#ui` —
// nothing here runs at module import time.
const SVG_NS = 'http://www.w3.org/2000/svg';
const TOAST_VISIBLE_MS = 2200;

/**
 * @param {string} id Icon symbol id, without the leading `#`.
 * @returns {SVGSVGElement}
 */
function svgIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon hud-icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

export class Hud {
  /**
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(config) {
    this._config = config;
    this._toastTimer = null;

    const ui = document.getElementById('ui');
    this._root = document.createElement('div');
    this._root.className = 'hud';

    this._statsBox = document.createElement('div');
    this._statsBox.className = 'hud-stats';

    const hpRow = document.createElement('div');
    hpRow.className = 'hud-row hud-hp';
    this._hpBarFill = document.createElement('div');
    this._hpBarFill.className = 'hud-bar__fill';
    const hpBarOuter = document.createElement('div');
    hpBarOuter.className = 'hud-bar hud-bar--hp';
    hpBarOuter.appendChild(this._hpBarFill);
    this._hpText = document.createElement('span');
    this._hpText.className = 'hud-text';
    hpRow.append(svgIcon('icon-heart'), hpBarOuter, this._hpText);

    const energyRow = document.createElement('div');
    energyRow.className = 'hud-row hud-energy';
    this._energyText = document.createElement('span');
    this._energyText.className = 'hud-text';
    energyRow.append(svgIcon('icon-plus'), this._energyText);

    this._waveLabel = document.createElement('div');
    this._waveLabel.className = 'hud-wave';

    this._buildCountdown = document.createElement('div');
    this._buildCountdown.className = 'hud-build-countdown';
    this._buildCountdown.hidden = true;

    this._statsBox.append(hpRow, energyRow, this._waveLabel);

    this._bossBar = document.createElement('div');
    this._bossBar.className = 'hud-boss';
    this._bossBar.hidden = true;
    this._bossFill = document.createElement('div');
    this._bossFill.className = 'hud-boss__fill';
    this._bossBar.appendChild(this._bossFill);

    this._comboBar = document.createElement('div');
    this._comboBar.className = 'hud-combo';
    this._comboBar.hidden = true;
    this._comboFill = document.createElement('div');
    this._comboFill.className = 'hud-combo__fill';
    this._comboText = document.createElement('span');
    this._comboText.className = 'hud-combo__text';
    this._comboBar.append(this._comboFill, this._comboText);

    this._reticle = document.createElement('div');
    this._reticle.className = 'hud-reticle';
    const reticleRing = document.createElement('div');
    reticleRing.className = 'hud-reticle__ring';
    const reticleDot = document.createElement('div');
    reticleDot.className = 'hud-reticle__dot';
    this._reticle.append(reticleRing, reticleDot);

    const keyboardHint = document.createElement('div');
    keyboardHint.className = 'hud-hint hud-hint--keyboard';
    keyboardHint.textContent = 'WASD move • mouse look • click to fire • 1/2/3 build';

    const touchHint = document.createElement('div');
    touchHint.className = 'hud-hint hud-hint--touch';
    touchHint.textContent = 'Stick to move • drag to look • auto-fire in reticle';

    this._toast = document.createElement('div');
    this._toast.className = 'hud-toast';

    this._root.append(
      this._statsBox, this._buildCountdown, this._bossBar, this._comboBar, this._reticle,
      keyboardHint, touchHint, this._toast,
    );
    ui.appendChild(this._root);

    this.setHp(config.player.hp, config.player.hp);
    this.setEnergy(0);
    this.setWave(1, config.run.finalWave);
    this.setBossHp(null);
    this.setCombo(0, 0);
    this.setReticle(false);
  }

  /**
   * @param {number} hp
   * @param {number} hpMax
   */
  setHp(hp, hpMax) {
    const frac = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0;
    this._hpBarFill.style.width = `${frac * 100}%`;
    this._hpText.textContent = `${Math.max(0, Math.ceil(hp))}`;
  }

  /**
   * @param {number} energy
   */
  setEnergy(energy) {
    this._energyText.textContent = `${Math.floor(energy)}`;
  }

  /**
   * @param {number} n
   * @param {number} total
   */
  setWave(n, total) {
    this._waveLabel.textContent = `WAVE ${n}/${total}`;
  }

  /**
   * Build-phase countdown readout, shown above the stats box. Not part of
   * the frozen P2/P3/P4 contract list in the brief but needed to satisfy
   * "a visible countdown in the HUD" during `build` — documented in
   * `docs/INTERFACES.md`.
   * @param {number|null} secondsLeft Whole seconds remaining, or `null` to hide it.
   */
  setBuildCountdown(secondsLeft) {
    if (secondsLeft === null || secondsLeft === undefined) {
      this._buildCountdown.hidden = true;
      return;
    }
    this._buildCountdown.hidden = false;
    this._buildCountdown.textContent = `BUILD ${Math.max(0, Math.ceil(secondsLeft))}s`;
  }

  /**
   * @param {boolean} hasTarget
   */
  setReticle(hasTarget) {
    this._reticle.classList.toggle('is-target', !!hasTarget);
  }

  /**
   * @param {number} kills
   * @param {number} fraction 0..1 of the combo window remaining.
   */
  setCombo(kills, fraction) {
    if (kills <= 0) {
      this._comboBar.hidden = true;
      return;
    }
    this._comboBar.hidden = false;
    this._comboFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    this._comboText.textContent = `x${kills}`;
  }

  /**
   * @param {number|null} frac 0..1, or `null` to hide the bar.
   */
  setBossHp(frac) {
    if (frac === null || frac === undefined) {
      this._bossBar.hidden = true;
      return;
    }
    this._bossBar.hidden = false;
    this._bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  /**
   * @param {string} text
   */
  toast(text) {
    this._toast.textContent = text;
    this._toast.classList.add('is-visible');
    if (this._toastTimer !== null) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toast.classList.remove('is-visible'), TOAST_VISIBLE_MS);
  }

  /**
   * @param {boolean} visible
   */
  show(visible) {
    this._root.hidden = !visible;
  }
}
