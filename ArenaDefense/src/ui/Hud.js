// In-gameplay HUD: hp/energy/coins/wave readouts, the reticle, and the combo,
// boss and wave-progress bars (driven with real numbers by P6/P5/`Game.js`
// respectively). Every element is built in the constructor and appended to
// `#ui` — nothing here runs at module import time.
import { tierFor } from '../core/combo.js';

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

    const coinsRow = document.createElement('div');
    coinsRow.className = 'hud-row hud-coins';
    this._coinsText = document.createElement('span');
    this._coinsText.className = 'hud-text';
    coinsRow.append(svgIcon('icon-coin'), this._coinsText);

    this._waveLabel = document.createElement('div');
    this._waveLabel.className = 'hud-wave';

    this._buildCountdown = document.createElement('div');
    this._buildCountdown.className = 'hud-build-countdown';
    this._buildCountdown.hidden = true;

    // FPS readout, toggled by a settings-screen preference (`Game.js`'s
    // `_applyPrefs` calls `setFpsVisible`; its `_debugTick` calls `setFps`
    // roughly every `DEBUG_REFRESH_S`, same cadence as the `?debug=1`
    // overlay). Unlike `.hud-controls` (mute/pause, see that block's long
    // comment below on why THOSE are a sibling of `.hud`), this is a plain
    // read-only text node — it never needs to receive a tap, so it has no
    // reason to escape `.hud`'s stacking context to beat `.touch-layer`'s
    // zones the way a button does. It lives inside `.hud` as an ordinary
    // child instead, right alongside `.hud-build-countdown` above, which is
    // the same "hidden by default, toggled independently" shape.
    this._fpsReadout = document.createElement('div');
    this._fpsReadout.className = 'hud-fps';
    this._fpsReadout.hidden = true;

    this._statsBox.append(hpRow, energyRow, coinsRow, this._waveLabel);

    this._bossBar = document.createElement('div');
    this._bossBar.className = 'hud-boss';
    this._bossBar.hidden = true;
    this._bossFill = document.createElement('div');
    this._bossFill.className = 'hud-boss__fill';
    this._bossBar.appendChild(this._bossFill);

    // Wave progress bar — same shape as `.hud-boss` above (built once, hidden
    // by default, a `__fill` whose width is a clamped percentage), sitting in
    // its own band just above it. See the layout comment on `.hud-wave-bar`
    // in style.css for why the two never overlap on a boss wave.
    this._waveBar = document.createElement('div');
    this._waveBar.className = 'hud-wave-bar';
    this._waveBar.hidden = true;
    this._waveBarFill = document.createElement('div');
    this._waveBarFill.className = 'hud-wave-bar__fill';
    this._waveBar.appendChild(this._waveBarFill);

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

    this._pausedPanel = document.createElement('div');
    this._pausedPanel.className = 'hud-paused';
    this._pausedPanel.textContent = 'PAUSED';
    this._pausedPanel.hidden = true;

    this._root.append(
      this._statsBox, this._buildCountdown, this._fpsReadout, this._waveBar, this._bossBar, this._comboBar,
      this._reticle, keyboardHint, touchHint, this._toast, this._pausedPanel,
    );
    ui.appendChild(this._root);

    // P7 additions: mute (both input modes) and pause (touch only — keyboard
    // already has Escape). Deliberately appended directly to `#ui`, as a
    // sibling of `.hud`/`.touch-layer` rather than nested inside `.hud` —
    // `.touch-layer`'s own `.touch-zone--move`/`--look` children cover the
    // *entire* left/right halves of the screen at their own higher z-index,
    // and a z-index set on a descendant of `.hud` can never escape `.hud`'s
    // own (lower) stacking context to beat that. Only a sibling with its own
    // higher z-index at the shared `#ui` parent level actually receives taps
    // over that area — see the CSS comment beside `.hud-controls`.
    this._controls = document.createElement('div');
    this._controls.className = 'hud-controls';

    this._muteBtn = document.createElement('button');
    this._muteBtn.type = 'button';
    this._muteBtn.className = 'hud-icon-btn hud-mute-btn';
    this._muteBtn.setAttribute('aria-label', 'Mute');
    this._muteBtn.appendChild(svgIcon('icon-sound'));

    this._pauseBtn = document.createElement('button');
    this._pauseBtn.type = 'button';
    this._pauseBtn.className = 'hud-icon-btn hud-pause-btn';
    this._pauseBtn.setAttribute('aria-label', 'Pause');
    this._pauseBtn.appendChild(svgIcon('icon-pause'));

    this._controls.append(this._muteBtn, this._pauseBtn);
    ui.appendChild(this._controls);

    this.setHp(config.player.hp, config.player.hp);
    this.setEnergy(0);
    this.setCoins(0);
    this.setWave(1, config.run.finalWave);
    this.setBossHp(null);
    this.setWaveProgress(null);
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
   * Running total for the current run (banked + pending coins) — see
   * `Game.js`'s `_syncHud`.
   * @param {number} coins
   */
  setCoins(coins) {
    this._coinsText.textContent = `${Math.floor(coins)}`;
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
   * Shows or hides the FPS readout — driven by a settings-screen preference
   * (`Game.js`'s `_applyPrefs`). Hidden by default until this is called.
   * @param {boolean} visible
   */
  setFpsVisible(visible) {
    this._fpsReadout.hidden = !visible;
  }

  /**
   * @param {number} fps
   */
  setFps(fps) {
    this._fpsReadout.textContent = `${Math.round(fps)} FPS`;
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
    const coins = tierFor(kills, this._config);
    this._comboText.textContent = coins > 0 ? `x${kills} +${coins}` : `x${kills}`;
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
   * Wave progress readout — `Game#_syncHud` calls this every fixed step with
   * `killsThisWave / totalForWave`, or `null` on boss waves and outside
   * `wave` (see the layout comment on `.hud-wave-bar` in style.css for why it
   * coexists with `.hud-boss` on wave 5 without overlapping it).
   * @param {number|null} frac 0..1, or `null` to hide the bar.
   */
  setWaveProgress(frac) {
    if (frac === null || frac === undefined) {
      this._waveBar.hidden = true;
      return;
    }
    this._waveBar.hidden = false;
    this._waveBarFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
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
    // `.hud-controls` (mute/pause) is a separate `#ui` child, not a
    // descendant of `.hud` — see the constructor's doc comment on why — so
    // it needs its own visibility toggle here to actually hide alongside the
    // rest of the HUD during a title/death/run-end screen (pausing makes no
    // sense there anyway; `Game#togglePause()` already no-ops while a screen
    // is open, this just keeps the button from floating uselessly on top).
    this._controls.hidden = !visible;
  }

  /**
   * A simple centred "PAUSED" panel, shown over the (still-visible) HUD
   * while `Game`'s manual pause (Escape / the touch pause button) is active.
   * @param {boolean} paused
   */
  setPaused(paused) {
    this._pausedPanel.hidden = !paused;
  }

  /**
   * @param {() => void} fn Called when the touch-only pause button is tapped.
   */
  onPauseTap(fn) {
    this._pauseBtn.addEventListener('click', fn);
  }

  /**
   * @param {(muted: boolean) => void} fn Called with the NEW muted state
   *   every time the mute button is tapped — the caller applies it (e.g.
   *   `audio.setMuted`, `platform/storage.js#saveMuted`).
   */
  onMuteTap(fn) {
    this._muteBtn.addEventListener('click', () => {
      const muted = !this._muteBtn.classList.contains('is-muted');
      this.setMuted(muted);
      fn(muted);
    });
  }

  /**
   * Sets the mute button's visual state without firing its own tap callback
   * — used to reflect a saved preference at boot.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._muteBtn.classList.toggle('is-muted', !!muted);
    this._muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }
}
