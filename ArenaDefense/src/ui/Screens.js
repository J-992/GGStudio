// Menu / weapon-select / pause / settings / death / run-end screens:
// full-viewport panels mounted into `#ui`.
// Each `show*` call freezes input and releases pointer lock for as long as
// the screen is up; `hide()` (called automatically at the start of the next
// `show*`, and by `Game.js` once a screen's outcome has been acted on)
// reverses both. `showMenu` takes callbacks since the menu stays up
// indefinitely until the player acts; every other screen returns a Promise
// that resolves once a button (or a key) picks an outcome, since `Game.js`
// needs to `await` the choice before deciding what happens next (which
// weapon to equip, revive vs. run-end, play-again vs. title).
import { assetUrl } from '../game/assets.js';
import { SENS_MIN, SENS_MAX } from '../core/prefs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// The four brainrot portraits actually shipped in `public/assets/sprites/`
// (see `manifest.json`'s `sprites.portraits` — bombardiro/tralalero are
// stub bosses in `cfg.bosses` but still get a portrait so the title screen
// can tease them; assassino/lirili have sprite atlas cells but no portrait
// crop yet).
const TITLE_PORTRAITS = ['patapim', 'tungtung', 'bombardiro', 'tralalero'];

/**
 * @param {string} id Icon symbol id (from `index.html`'s inline sprite sheet), without the leading `#`.
 * @returns {SVGSVGElement}
 */
function svgIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon screen-icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

/**
 * A labelled 0..1 bar, used to compare weapons at a glance.
 *
 * @param {string} label
 * @param {number} value
 * @param {number} max Value that fills the bar; larger values simply cap it.
 * @returns {HTMLElement}
 */
function statBar(label, value, max) {
  const row = document.createElement('span');
  row.className = 'weapon-stat';
  const name = document.createElement('span');
  name.className = 'weapon-stat-label';
  name.textContent = label;
  const track = document.createElement('span');
  track.className = 'weapon-stat-track';
  const fill = document.createElement('span');
  fill.className = 'weapon-stat-fill';
  fill.style.width = `${Math.round(Math.min(1, value / max) * 100)}%`;
  track.appendChild(fill);
  row.append(name, track);
  return row;
}

/**
 * @param {string} label
 * @param {number} value Multiplier, in `core/prefs.js`'s [SENS_MIN, SENS_MAX].
 * @param {(v: number) => void} onChange
 * @returns {HTMLElement}
 */
function slider(label, value, onChange) {
  const row = document.createElement('label');
  row.className = 'settings-row';
  const name = document.createElement('span');
  name.className = 'settings-label';
  name.textContent = label;
  const readout = document.createElement('span');
  readout.className = 'settings-value';
  readout.textContent = `${value.toFixed(2)}x`;

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'settings-slider';
  input.min = String(SENS_MIN);
  input.max = String(SENS_MAX);
  input.step = '0.05';
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    readout.textContent = `${v.toFixed(2)}x`;
    onChange(v);
  });

  row.append(name, input, readout);
  return row;
}

/**
 * @param {string} label
 * @param {boolean} on
 * @param {(on: boolean) => void} onChange
 * @returns {HTMLElement}
 */
function toggle(label, on, onChange) {
  const row = document.createElement('label');
  row.className = 'settings-row';
  const name = document.createElement('span');
  name.className = 'settings-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'settings-toggle';
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(name, input);
  return row;
}

export class Screens {
  /**
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('./input.js').Input} input
   * @param {import('../platform/audio.js').Audio} audio
   * @param {{ hasAds: boolean }} [platform] P7 addition — governs whether the
   *   revive/doubler buttons below show at all. Defaults to `{ hasAds: true }`
   *   (both buttons show, matching pre-P7 behaviour) so any caller that
   *   doesn't pass one — a future standalone use, a test — sees no change.
   */
  constructor(cfg, input, audio, platform = { hasAds: true }) {
    this._cfg = cfg;
    this._input = input;
    this._audio = audio;
    this._platform = platform;
    /** @type {HTMLElement|null} Currently mounted screen root, if any. */
    this._root = null;
  }

  /** @returns {boolean} True while a screen is mounted. */
  get isOpen() {
    return this._root !== null;
  }

  /**
   * Removes any mounted screen and restores input + pointer-lock state.
   * Idempotent — safe to call with nothing up.
   */
  hide() {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
    this._input.freeze(false);
    this._releasePointerLock();
  }

  _releasePointerLock() {
    if (!document.pointerLockElement) return;
    try {
      document.exitPointerLock();
    } catch {
      // Already unlocked, or the browser refused — either way there's
      // nothing left to release.
    }
  }

  /**
   * @param {string} className
   * @returns {HTMLDivElement} A fresh full-viewport panel mounted into
   *   `#ui`, with input frozen and pointer lock released for as long as it
   *   stays up.
   */
  _open(className) {
    this.hide();
    this._input.freeze(true);
    this._releasePointerLock();
    const root = document.createElement('div');
    root.className = `screen ${className}`;
    document.getElementById('ui').appendChild(root);
    this._root = root;
    return root;
  }

  /**
   * @param {string} label
   * @param {string} [extraClass]
   * @returns {HTMLButtonElement}
   */
  _makeButton(label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `screen-btn ${extraClass}` : 'screen-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => this._audio.play('ui-click'));
    return btn;
  }

  /**
   * @param {HTMLElement} root
   */
  _disableButtons(root) {
    for (const btn of root.querySelectorAll('button')) btn.disabled = true;
  }

  /**
   * The main menu. Callback style rather than a Promise: it stays up
   * indefinitely, and its buttons lead to other screens that come back here.
   *
   * @param {{bestWave:number, coins:number, credits:string, weaponName:string,
   *          onPlay:() => void, onWeapons:() => void, onSettings:() => void}} opts
   */
  showMenu({ bestWave, coins, credits, weaponName, onPlay, onWeapons, onSettings }) {
    const root = this._open('screen--title');

    const heading = document.createElement('h1');
    heading.className = 'screen-heading';
    heading.textContent = 'ARENA DEFENSE';

    const portraitsWrap = document.createElement('div');
    portraitsWrap.className = 'screen-portraits';
    for (const name of TITLE_PORTRAITS) {
      const img = document.createElement('img');
      img.className = 'screen-portrait';
      img.src = assetUrl(`assets/sprites/portrait-${name}.webp`);
      img.alt = name;
      img.draggable = false;
      portraitsWrap.appendChild(img);
    }
    const portraitsCaption = document.createElement('p');
    portraitsCaption.className = 'screen-portraits-caption';
    portraitsCaption.textContent = 'BOSSES';

    const stats = document.createElement('div');
    stats.className = 'screen-stats';
    const bestRow = document.createElement('div');
    bestRow.className = 'screen-stat';
    bestRow.append(svgIcon('icon-target'), document.createTextNode(` BEST WAVE ${bestWave}`));
    const coinsRow = document.createElement('div');
    coinsRow.className = 'screen-stat';
    coinsRow.append(svgIcon('icon-coin'), document.createTextNode(` ${coins}`));
    stats.append(bestRow, coinsRow);

    const playBtn = this._makeButton('PLAY', 'screen-btn--primary');
    const weaponsBtn = this._makeButton(`WEAPON: ${weaponName}`);
    const settingsBtn = this._makeButton('SETTINGS');

    const creditsEl = document.createElement('p');
    creditsEl.className = 'screen-credits';
    creditsEl.textContent = credits;

    root.append(heading, portraitsWrap, portraitsCaption, stats, playBtn, weaponsBtn, settingsBtn, creditsEl);

    // Unlike the old single-button title, tapping the backdrop does NOT start
    // a run — with three buttons here a stray tap next to SETTINGS starting
    // the game would be an unpleasant surprise. Enter/Space still play.
    let acted = false;
    const once = (fn) => () => {
      if (acted) return;
      acted = true;
      cleanup();
      fn();
    };
    const start = once(onPlay);
    const onKeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') start();
    };
    const cleanup = () => window.removeEventListener('keydown', onKeydown);

    playBtn.addEventListener('click', start);
    weaponsBtn.addEventListener('click', once(onWeapons));
    settingsBtn.addEventListener('click', once(onSettings));
    window.addEventListener('keydown', onKeydown);
  }

  /**
   * Weapon select. Picking a card only highlights it — a second, explicit
   * action equips it, so the player can read what each one does before
   * committing (the see-before-you-commit idea behind any decent weapon menu).
   *
   * @param {{weapons: {id:string, def:object, icon?:string|null}[], current:string, confirmLabel?:string}} opts
   * @returns {Promise<string>} The chosen weapon id; the current one if cancelled.
   */
  showWeaponSelect({ weapons, current, confirmLabel = 'START' }) {
    return new Promise((resolve) => {
      const root = this._open('screen--weapons');

      const heading = document.createElement('h1');
      heading.className = 'screen-heading';
      heading.textContent = 'CHOOSE YOUR WEAPON';

      const sub = document.createElement('p');
      sub.className = 'screen-sub';
      sub.textContent = 'All six are unlocked. None is strictly best.';

      let selected = weapons.some((w) => w.id === current) ? current : weapons[0].id;

      const list = document.createElement('div');
      list.className = 'weapon-list';
      /** @type {Map<string, HTMLButtonElement>} */
      const cards = new Map();

      for (const { id, def, icon } of weapons) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'weapon-card';
        card.dataset.weapon = id;

        // A render of the weapon itself, produced by `Game` (this file has no
        // renderer and stays DOM-only). Absent when no WebGL context was
        // spare, in which case the card is text, exactly as it used to be.
        let img = null;
        if (icon) {
          img = document.createElement('img');
          img.className = 'weapon-card-art';
          img.src = icon;
          img.alt = '';
          img.draggable = false;
        }

        const name = document.createElement('span');
        name.className = 'weapon-card-name';
        name.textContent = def.name;

        const blurb = document.createElement('span');
        blurb.className = 'weapon-card-blurb';
        blurb.textContent = def.blurb ?? '';

        const statsEl = document.createElement('span');
        statsEl.className = 'weapon-card-stats';
        statsEl.append(
          statBar('DMG', def.dmg * (def.pellets ?? 1), 120),
          statBar('RATE', def.rate, 12),
          statBar('RANGE', def.range, 80),
        );

        card.append(...(img ? [img] : []), name, blurb, statsEl);
        card.addEventListener('click', () => {
          this._audio.play('ui-click');
          select(id);
        });
        list.appendChild(card);
        cards.set(id, card);
      }

      const confirmBtn = this._makeButton(confirmLabel, 'screen-btn--primary');
      root.append(heading, sub, list, confirmBtn);

      const select = (id) => {
        selected = id;
        for (const [cardId, el] of cards) el.classList.toggle('is-selected', cardId === id);
      };
      select(selected);

      const finish = (id) => {
        cleanup();
        this._disableButtons(root);
        resolve(id);
      };
      const onKeydown = (e) => {
        // 1-6 jump straight to a weapon; Enter takes whatever is highlighted.
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= weapons.length) {
          select(weapons[n - 1].id);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') finish(selected);
        else if (e.key === 'Escape') finish(current);
      };
      const cleanup = () => window.removeEventListener('keydown', onKeydown);

      confirmBtn.addEventListener('click', () => finish(selected));
      window.addEventListener('keydown', onKeydown);
    });
  }

  /**
   * The manual pause menu — Escape, or the touch HUD's pause button. It
   * replaces the HUD's old bare "PAUSED" text panel outright. An involuntary
   * pause (an ad, a backgrounded tab) shows nothing at all, because something
   * else is already covering the screen in both cases.
   *
   * @returns {Promise<'resume'|'settings'|'title'>}
   */
  showPause() {
    return new Promise((resolve) => {
      const root = this._open('screen--pause');

      const heading = document.createElement('h1');
      heading.className = 'screen-heading';
      heading.textContent = 'PAUSED';

      const resumeBtn = this._makeButton('RESUME', 'screen-btn--primary');
      const settingsBtn = this._makeButton('SETTINGS');
      const titleBtn = this._makeButton('QUIT TO TITLE');

      root.append(heading, resumeBtn, settingsBtn, titleBtn);

      const finish = (choice) => {
        cleanup();
        this._disableButtons(root);
        resolve(choice);
      };
      const onKeydown = (e) => {
        // Escape both opens and closes the pause menu; `Game` suppresses its
        // own Escape handling while a screen is open, so this is the only
        // listener that acts on it here.
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish('resume');
      };
      const cleanup = () => window.removeEventListener('keydown', onKeydown);

      resumeBtn.addEventListener('click', () => finish('resume'));
      settingsBtn.addEventListener('click', () => finish('settings'));
      titleBtn.addEventListener('click', () => finish('title'));
      window.addEventListener('keydown', onKeydown);
    });
  }

  /**
   * Settings. Resolves with the prefs patch to persist — the caller applies
   * and stores it, this screen only collects it.
   *
   * @param {{prefs: object, touch: boolean, muted: boolean}} opts
   * @returns {Promise<{sensMouse:number, sensTouch:number, invertY:boolean, showFps:boolean, muted:boolean}>}
   */
  showSettings({ prefs, touch, muted }) {
    return new Promise((resolve) => {
      const root = this._open('screen--settings');

      const heading = document.createElement('h1');
      heading.className = 'screen-heading';
      heading.textContent = 'SETTINGS';

      const state = {
        // A slider needs a concrete number; `null` in stored prefs means
        // "whatever the config says", which is a multiplier of 1.
        sensMouse: prefs.sensMouse ?? 1,
        sensTouch: prefs.sensTouch ?? 1,
        invertY: prefs.invertY,
        showFps: prefs.showFps,
        muted,
      };

      const fields = document.createElement('div');
      fields.className = 'settings-fields';
      const sensKey = touch ? 'sensTouch' : 'sensMouse';
      fields.append(
        slider(touch ? 'LOOK SENSITIVITY' : 'MOUSE SENSITIVITY', state[sensKey], (v) => { state[sensKey] = v; }),
        toggle('SOUND', !state.muted, (on) => { state.muted = !on; }),
        toggle('INVERT LOOK', state.invertY, (on) => { state.invertY = on; }),
        toggle('SHOW FPS', state.showFps, (on) => { state.showFps = on; }),
      );

      const backBtn = this._makeButton('BACK', 'screen-btn--primary');
      root.append(heading, fields, backBtn);

      const finish = () => {
        cleanup();
        this._disableButtons(root);
        resolve({ ...state });
      };
      const onKeydown = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish();
      };
      const cleanup = () => window.removeEventListener('keydown', onKeydown);

      backBtn.addEventListener('click', finish);
      window.addEventListener('keydown', onKeydown);
    });
  }

  /**
   * @param {{wave:number, canRevive:boolean}} opts
   * @returns {Promise<'revive'|'end'>}
   */
  showDeath({ wave, canRevive }) {
    return new Promise((resolve) => {
      const root = this._open('screen--death');

      const heading = document.createElement('h1');
      heading.className = 'screen-heading screen-heading--death';
      heading.textContent = 'YOU DIED';

      const sub = document.createElement('p');
      sub.className = 'screen-sub';
      sub.textContent = `Fell on wave ${wave}`;

      // `canRevive` alone says the run hasn't used its once-per-run revive
      // yet; whether there's actually an ad to show it also needs
      // `platform.hasAds` — with `cfg.platform.adsEnabled: false` (or no SDK
      // active at all) the button vanishes entirely rather than offering an
      // ad that can never play (see `AGENTS.md`'s ad economy note).
      const canReviveNow = canRevive && this._platform.hasAds;
      const reviveBtn = this._makeButton('REVIVE (AD)', 'screen-btn--primary');
      reviveBtn.hidden = !canReviveNow;
      const endBtn = this._makeButton('END RUN');

      root.append(heading, sub, reviveBtn, endBtn);

      const finish = (choice) => {
        cleanup();
        this._disableButtons(root);
        resolve(choice);
      };
      const onKeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') finish(canReviveNow ? 'revive' : 'end');
        else if (e.key === 'Escape') finish('end');
      };
      const cleanup = () => window.removeEventListener('keydown', onKeydown);

      reviveBtn.addEventListener('click', () => finish('revive'));
      endBtn.addEventListener('click', () => finish('end'));
      window.addEventListener('keydown', onKeydown);
    });
  }

  /**
   * @param {{wave:number, victory:boolean, coinsEarned:number, coinsTotal:number, canDouble:boolean}} opts
   * @returns {Promise<'double'|'again'|'title'>}
   */
  showRunEnd({ wave, victory, coinsEarned, coinsTotal, canDouble }) {
    return new Promise((resolve) => {
      const root = this._open('screen--runend');

      const heading = document.createElement('h1');
      heading.className = 'screen-heading';
      heading.textContent = victory ? 'ARENA CLEARED' : 'RUN OVER';

      const sub = document.createElement('p');
      sub.className = 'screen-sub';
      sub.textContent = `Wave ${wave}`;

      const coinsRow = document.createElement('div');
      coinsRow.className = 'screen-stat screen-stat--earned';
      coinsRow.append(svgIcon('icon-coin'), document.createTextNode(` +${coinsEarned}  (total ${coinsTotal})`));

      // Same `hasAds` gate as `showDeath`'s revive button above.
      const canDoubleNow = canDouble && this._platform.hasAds;
      const doubleBtn = this._makeButton('DOUBLE COINS (AD)', 'screen-btn--primary');
      doubleBtn.hidden = !canDoubleNow;
      const againBtn = this._makeButton('PLAY AGAIN', 'screen-btn--primary');
      const titleBtn = this._makeButton('TITLE');

      root.append(heading, sub, coinsRow, doubleBtn, againBtn, titleBtn);

      const finish = (choice) => {
        cleanup();
        this._disableButtons(root);
        resolve(choice);
      };
      const onKeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') finish('again');
        else if (e.key === 'Escape') finish('title');
      };
      const cleanup = () => window.removeEventListener('keydown', onKeydown);

      doubleBtn.addEventListener('click', () => finish('double'));
      againBtn.addEventListener('click', () => finish('again'));
      titleBtn.addEventListener('click', () => finish('title'));
      window.addEventListener('keydown', onKeydown);
    });
  }
}
