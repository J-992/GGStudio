// Title / death / run-end screens: full-viewport panels mounted into `#ui`.
// Each `show*` call freezes input and releases pointer lock for as long as
// the screen is up; `hide()` (called automatically at the start of the next
// `show*`, and by `Game.js` once a screen's outcome has been acted on)
// reverses both. `showTitle` takes a callback (`onPlay`) since the title
// stays up indefinitely until the player acts; `showDeath`/`showRunEnd`
// return a Promise that resolves once a button (or Enter/Space/Escape) picks
// an outcome, since `Game.js` needs to `await` the choice before deciding
// what happens next (revive vs. run-end, play-again vs. title).
import { assetUrl } from '../game/assets.js';

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
   * @param {{bestWave:number, coins:number, credits:string, onPlay:() => void}} opts
   */
  showTitle({ bestWave, coins, credits, onPlay }) {
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

    const creditsEl = document.createElement('p');
    creditsEl.className = 'screen-credits';
    creditsEl.textContent = credits;

    root.append(heading, portraitsWrap, portraitsCaption, stats, playBtn, creditsEl);

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      cleanup();
      onPlay();
    };
    const onKeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') start();
    };
    const cleanup = () => {
      root.removeEventListener('click', start);
      window.removeEventListener('keydown', onKeydown);
    };

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      start();
    });
    root.addEventListener('click', start); // Tap anywhere on the panel.
    window.addEventListener('keydown', onKeydown);
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
