// The build-phase top-down map: one `<svg viewBox="-100 -100 200 200">` (see
// `core/arenaGeometry.js`'s doc comment — world metres map to these units 1:1
// scaled, +z world = +y/"down" on screen, no flip needed anywhere in this
// file) plus HTML chrome (energy readout, turret-type chips, the Ready
// button/countdown ring, an upgrade/repair sheet) — all rendered into the
// `#overlay` node index.html already reserves.
//
// Constructed once (`new BuildOverlay(cfg, audio)`) and driven from outside
// by `game/buildPhase.js`, which sets `onPlace/onUpgrade/onRepair/onReady`
// after construction and calls `open/close/setCountdown/setEnergy/refresh`
// — see this file's "P4 additions" entry in `docs/INTERFACES.md` for the
// full callback/method contract.
import { slotMapPositions, worldToMap } from '../core/arenaGeometry.js';
import { upgradeCost, repairCost } from '../core/turretLogic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_R = 90; // matches worldToMap(cfg.arena.radius, 0, cfg).x === 90.
const SLOT_VISUAL_R = 6;
// Deliberately smaller than a literal "44px-equivalent" radius: at
// `cfg.arena.slotRadius`, the 3 slots sharing one gate sit only 20deg apart
// (`slotOffsets` 40/60/80), a ~19.2 map-unit chord — a hit radius any larger
// than ~9.6 map units would make adjacent same-gate slots' tap targets
// overlap more than they don't. 11 accepts a small (~2.6 map-unit) overlap
// band between neighbours in exchange for a meaningfully bigger target
// (~36px diameter at `.bo-mapwrap`'s default on-screen size on a 360px
// phone) — the alternative, a strictly non-overlapping radius, would land
// under 30px. This is a real geometric ceiling from the frozen arena/slot
// layout (`core/arenaGeometry.js` + `CONFIG.arena`), not a number picked
// without checking; flagged for the owner's verify pass.
const SLOT_HIT_R = 11;
const PIP_COUNT = 3;
const READY_RING_R = 19;
const READY_RING_CIRCUMFERENCE = 2 * Math.PI * READY_RING_R;

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function htmlEl(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * A miniature of what the map draws at a slot, so a legend row points at a
 * recognisable shape instead of naming one. `null` renders nothing (for rows
 * about a button rather than a slot).
 *
 * @param {'empty'|'built'|null} kind
 * @returns {SVGElement|null}
 */
function slotGlyph(kind) {
  if (kind === null) return null;
  const svg = svgEl('svg', { class: 'bo-help__glyph', viewBox: '-10 -10 20 20', 'aria-hidden': 'true' });
  svg.appendChild(svgEl('circle', { r: '7.5', class: `bo-help__glyph-ring is-${kind}` }));
  if (kind === 'built') svg.appendChild(svgEl('circle', { r: '4.8', class: 'bo-help__glyph-fill' }));
  return svg;
}

/**
 * One legend row: the key(s) that trigger the action, the map glyph it acts
 * on (optional), and the action's name.
 *
 * @param {string[]} keys
 * @param {'empty'|'built'|null} glyph
 * @param {string} label
 * @returns {HTMLElement}
 */
function helpRow(keys, glyph, label) {
  const row = htmlEl('div', 'bo-help__row');
  for (const key of keys) {
    const kbd = htmlEl('kbd', 'bo-help__key');
    kbd.textContent = key;
    row.appendChild(kbd);
  }
  const shape = slotGlyph(glyph);
  if (shape) row.appendChild(shape);
  const name = htmlEl('span', 'bo-help__label');
  name.textContent = label;
  row.appendChild(name);
  return row;
}

/**
 * World-convention angle (`arenaGeometry`'s "0deg = -z/north, clockwise") to
 * a point already in map units — equivalent to computing the world point
 * and running it through `worldToMap`, just without allocating twice; the
 * trig is identical since `worldToMap` is a uniform scale.
 * @param {number} angleDeg
 * @param {number} r Map-unit radius.
 * @returns {{x:number, z:number}}
 */
function mapPointOnCircle(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), z: -r * Math.cos(a) };
}

/**
 * @param {number} hex
 * @returns {string}
 */
function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class BuildOverlay {
  /**
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('../platform/audio.js').Audio} audio
   */
  constructor(cfg, audio) {
    this._cfg = cfg;
    this._audio = audio;

    /** @type {((slotId:number, type:string) => void)|null} */
    this.onPlace = null;
    /** @type {((slotId:number) => void)|null} */
    this.onUpgrade = null;
    /** @type {((slotId:number) => void)|null} */
    this.onRepair = null;
    /** @type {(() => void)|null} */
    this.onReady = null;

    this.isOpen = false;
    this._selectedType = cfg.turrets.order[0];
    this._sheetSlotId = /** @type {number|null} */ (null);
    this._lastEnergy = 0;
    /** @type {Map<number, import('../core/types.js').TurretRecord>|null} */
    this._turretsById = null;
    /** @type {((e:KeyboardEvent) => void)|null} */
    this._keydownHandler = null;

    // Map units, not world metres: everything in `_buildMap` below writes
    // straight into the `viewBox="-100 -100 200 200"` coordinate system.
    this._slots = slotMapPositions(cfg);

    this._root = document.getElementById('overlay');
    this._buildDom();
  }

  /**
   * @param {import('../core/types.js').BuildSnapshot} snapshot
   */
  open(snapshot) {
    this.isOpen = true;
    this._root.hidden = false;
    this._attachKeys();
    this.refresh(snapshot);
  }

  close() {
    this.isOpen = false;
    this._closeSheet();
    this._detachKeys();
    this._root.hidden = true;
  }

  /**
   * @param {number} secondsLeft
   */
  setCountdown(secondsLeft) {
    const duration = this._cfg.build.durationS;
    const frac = duration > 0 ? Math.max(0, Math.min(1, secondsLeft / duration)) : 0;
    this._readyRingFill.setAttribute('stroke-dashoffset', `${READY_RING_CIRCUMFERENCE * (1 - frac)}`);
    this._readySeconds.textContent = `${Math.max(0, Math.ceil(secondsLeft))}`;
  }

  /**
   * @param {number} n
   */
  setEnergy(n) {
    this._lastEnergy = n;
    this._energyValue.textContent = `${Math.floor(n)}`;
    this._renderChips();
  }

  /**
   * Run total (banked + pending), matching `Hud#setCoins` — the HUD is hidden
   * for the whole build phase (`buildPhase.js` calls `hud.show(false)`), so
   * without this the player's coin count simply disappears while they are
   * deciding what to spend on.
   * @param {number} coins
   */
  setCoins(coins) {
    this._coinsValue.textContent = `${Math.floor(coins)}`;
  }

  /**
   * @param {string} type
   */
  setSelectedType(type) {
    if (!this._cfg.turrets.types[type]) return;
    this._selectedType = type;
    this._renderChips();
    if (this._turretsById) this._renderSlots();
  }

  /**
   * @param {import('../core/types.js').BuildSnapshot} snapshot
   */
  refresh(snapshot) {
    this._turretsById = new Map(snapshot.turrets.map((t) => [t.slotId, t]));
    this._renderGates(snapshot.activeGates);
    this._renderSlots();
    this._renderPlayer(snapshot.player);
    this.setEnergy(snapshot.energy);
    this.setCoins(snapshot.coins ?? 0);

    if (this._sheetSlotId !== null) {
      const rec = this._turretsById.get(this._sheetSlotId);
      if (rec && rec.alive) this._openSheet(this._sheetSlotId, rec);
      else this._closeSheet();
    }
  }

  // ---- DOM construction -----------------------------------------------

  _buildDom() {
    this._wrap = htmlEl('div', 'bo');
    this._root.appendChild(this._wrap);

    this._buildEnergy();
    this._buildCoins();
    this._buildMap();
    this._buildHelp();
    this._buildChips();
    this._buildReady();
    this._buildSheet();
  }

  _buildMap() {
    const mapWrap = htmlEl('div', 'bo-mapwrap');
    this._wrap.appendChild(mapWrap);

    const svg = svgEl('svg', { viewBox: '-100 -100 200 200', class: 'bo-map', 'aria-hidden': 'true' });
    mapWrap.appendChild(svg);
    this._svg = svg;

    svg.appendChild(svgEl('circle', { cx: '0', cy: '0', r: `${MAP_R}`, class: 'bo-wall' }));

    const gatesGroup = svgEl('g', { class: 'bo-gates' });
    svg.appendChild(gatesGroup);
    /** @type {{arc:SVGElement, closed:SVGElement}[]} */
    this._gateEls = [];
    const halfWidth = this._cfg.arena.gateWidth / 2;
    this._cfg.arena.gateAngles.forEach((angleDeg) => {
      const p0 = mapPointOnCircle(angleDeg - halfWidth, MAP_R);
      const p1 = mapPointOnCircle(angleDeg + halfWidth, MAP_R);
      const arc = svgEl('path', {
        d: `M ${p0.x} ${p0.z} A ${MAP_R} ${MAP_R} 0 0 1 ${p1.x} ${p1.z}`,
        class: 'bo-gate-arc',
      });
      const barIn = mapPointOnCircle(angleDeg, MAP_R - 6);
      const barOut = mapPointOnCircle(angleDeg, MAP_R + 6);
      const closed = svgEl('line', {
        x1: `${barIn.x}`, y1: `${barIn.z}`, x2: `${barOut.x}`, y2: `${barOut.z}`, class: 'bo-gate-closed',
      });
      gatesGroup.append(arc, closed);
      this._gateEls.push({ arc, closed });
    });

    const slotsGroup = svgEl('g', { class: 'bo-slots' });
    svg.appendChild(slotsGroup);
    /** @type {Map<number, object>} */
    this._slotEls = new Map();
    for (const slot of this._slots) {
      this._buildSlotVisual(slotsGroup, slot);
    }

    this._playerWedge = svgEl('polygon', { points: '0,-6 -3.4,3 3.4,3', class: 'bo-player' });
    svg.appendChild(this._playerWedge);
  }

  /**
   * @param {SVGElement} parent
   * @param {{id:number, x:number, z:number}} slot
   */
  _buildSlotVisual(parent, slot) {
    const g = svgEl('g', { class: 'bo-slot is-empty', transform: `translate(${slot.x} ${slot.z})` });

    const ring = svgEl('circle', { r: `${SLOT_VISUAL_R}`, class: 'bo-slot-ring' });
    const fill = svgEl('circle', { r: `${SLOT_VISUAL_R - 1.2}`, class: 'bo-slot-fill' });
    const costText = svgEl('text', { class: 'bo-slot-cost', y: '2.4', 'text-anchor': 'middle' });

    const pipEls = [];
    for (let i = 0; i < PIP_COUNT; i++) {
      const pip = svgEl('rect', {
        x: `${-4.8 + i * 3.4}`, y: `${-(SLOT_VISUAL_R + 5.5)}`, width: '2.6', height: '2.6', class: 'bo-slot-pip',
      });
      g.appendChild(pip);
      pipEls.push(pip);
    }

    const hpW = 13;
    const hpBg = svgEl('rect', { x: `${-hpW / 2}`, y: `${SLOT_VISUAL_R + 2}`, width: `${hpW}`, height: '2.2', class: 'bo-slot-hpbg' });
    const hpFill = svgEl('rect', { x: `${-hpW / 2}`, y: `${SLOT_VISUAL_R + 2}`, width: `${hpW}`, height: '2.2', class: 'bo-slot-hpfill' });

    const xMark1 = svgEl('line', { x1: '-5.2', y1: '-5.2', x2: '5.2', y2: '5.2', class: 'bo-slot-x' });
    const xMark2 = svgEl('line', { x1: '-5.2', y1: '5.2', x2: '5.2', y2: '-5.2', class: 'bo-slot-x' });

    const hit = svgEl('circle', { r: `${SLOT_HIT_R}`, class: 'bo-slot-hit' });
    hit.addEventListener('click', () => this._onSlotTap(slot.id));

    g.append(ring, fill, costText, hpBg, hpFill, xMark1, xMark2, hit);
    parent.appendChild(g);

    this._slotEls.set(slot.id, { g, ring, fill, costText, pipEls, hpFill, hit });
  }

  _buildEnergy() {
    const box = htmlEl('div', 'bo-energy');
    const icon = svgEl('svg', { class: 'icon bo-energy__icon' });
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-plus');
    icon.appendChild(use);
    this._energyValue = htmlEl('span', 'bo-energy__value');
    box.append(icon, this._energyValue);
    this._wrap.appendChild(box);
  }

  _buildCoins() {
    const box = htmlEl('div', 'bo-coins');
    const icon = svgEl('svg', { class: 'icon bo-coins__icon' });
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-coin');
    icon.appendChild(use);
    this._coinsValue = htmlEl('span', 'bo-coins__value');
    this._coinsValue.textContent = '0';
    box.append(icon, this._coinsValue);
    this._wrap.appendChild(box);
  }

  /**
   * Control legend for the map — the build map is the one screen with no
   * tutorial anywhere else in the game, and nothing on it says a dashed ring
   * is tappable. Built as key badges + the map's own slot glyphs rather than
   * a sentence, so it reads as a game's control list and ties each action to
   * the thing on the map it acts on. Touch and keyboard rows are both built
   * and `style.css` shows whichever matches `body.touch`/`body.keyboard`, the
   * same switch `Hud`'s own hints use (`ui/input.js` sets the class).
   */
  _buildHelp() {
    const touch = htmlEl('div', 'bo-help bo-help--touch');
    touch.append(
      helpRow(['Tap'], 'empty', 'Build'),
      helpRow(['Tap'], 'built', 'Upgrade / Repair'),
      helpRow(['Ready'], null, 'Start wave'),
    );

    const keyboard = htmlEl('div', 'bo-help bo-help--keyboard');
    keyboard.append(
      helpRow(['1', '2', '3'], null, 'Select'),
      helpRow(['Click'], 'empty', 'Build'),
      helpRow(['Click'], 'built', 'Upgrade / Repair'),
      helpRow(['Space'], null, 'Start wave'),
    );

    this._wrap.append(touch, keyboard);
  }

  _buildChips() {
    const box = htmlEl('div', 'bo-chips');
    /** @type {Map<string, HTMLElement>} */
    this._chips = new Map();
    for (const type of this._cfg.turrets.order) {
      const def = this._cfg.turrets.types[type];
      const chip = /** @type {HTMLButtonElement} */ (htmlEl('button', 'bo-chip'));
      chip.type = 'button';
      const name = htmlEl('span', 'bo-chip__name');
      name.textContent = type;
      const cost = htmlEl('span', 'bo-chip__cost');
      cost.textContent = `${def.cost}`;
      chip.append(name, cost);
      chip.addEventListener('click', () => this.setSelectedType(type));
      box.appendChild(chip);
      this._chips.set(type, chip);
    }
    this._wrap.appendChild(box);
  }

  _buildReady() {
    const btn = /** @type {HTMLButtonElement} */ (htmlEl('button', 'bo-ready'));
    btn.type = 'button';
    const ring = svgEl('svg', { viewBox: '0 0 44 44', class: 'bo-ready__ring' });
    ring.appendChild(svgEl('circle', { cx: '22', cy: '22', r: `${READY_RING_R}`, class: 'bo-ready__ring-bg' }));
    this._readyRingFill = svgEl('circle', {
      cx: '22', cy: '22', r: `${READY_RING_R}`, class: 'bo-ready__ring-fill',
      'stroke-dasharray': `${READY_RING_CIRCUMFERENCE}`, 'stroke-dashoffset': '0',
    });
    ring.appendChild(this._readyRingFill);
    const label = htmlEl('span', 'bo-ready__label');
    label.textContent = 'READY';
    this._readySeconds = htmlEl('span', 'bo-ready__seconds');
    btn.append(ring, label, this._readySeconds);
    btn.addEventListener('click', () => this.onReady?.());
    this._wrap.appendChild(btn);
  }

  _buildSheet() {
    this._sheet = htmlEl('div', 'bo-sheet');
    this._sheet.hidden = true;
    const card = htmlEl('div', 'bo-sheet__card');

    this._sheetTitle = htmlEl('h3', 'bo-sheet__title');
    this._sheetUpgradeBtn = /** @type {HTMLButtonElement} */ (htmlEl('button', 'bo-sheet__btn'));
    this._sheetUpgradeBtn.type = 'button';
    this._sheetRepairBtn = /** @type {HTMLButtonElement} */ (htmlEl('button', 'bo-sheet__btn'));
    this._sheetRepairBtn.type = 'button';
    const closeBtn = /** @type {HTMLButtonElement} */ (htmlEl('button', 'bo-sheet__btn bo-sheet__btn--close'));
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    card.append(this._sheetTitle, this._sheetUpgradeBtn, this._sheetRepairBtn, closeBtn);
    this._sheet.appendChild(card);
    this._wrap.appendChild(this._sheet);

    this._sheetUpgradeBtn.addEventListener('click', () => {
      if (this._sheetSlotId === null || !this._turretsById) return;
      const rec = this._turretsById.get(this._sheetSlotId);
      if (!rec) return;
      const cost = upgradeCost(rec.type, rec.level, this._cfg);
      if (cost === undefined) return; // already MAX — button is disabled, this is defensive only.
      if (this._lastEnergy < cost) {
        this._deny(this._sheetUpgradeBtn);
        return;
      }
      this.onUpgrade?.(this._sheetSlotId);
    });

    this._sheetRepairBtn.addEventListener('click', () => {
      if (this._sheetSlotId === null || !this._turretsById) return;
      const rec = this._turretsById.get(this._sheetSlotId);
      if (!rec) return;
      const cost = repairCost(rec, this._cfg);
      if (cost === 0) return; // already full — button is disabled, this is defensive only.
      if (this._lastEnergy < cost) {
        this._deny(this._sheetRepairBtn);
        return;
      }
      this.onRepair?.(this._sheetSlotId);
    });

    closeBtn.addEventListener('click', () => this._closeSheet());
  }

  // ---- interaction ------------------------------------------------------

  /**
   * @param {number} slotId
   */
  _onSlotTap(slotId) {
    const els = this._slotEls.get(slotId);
    const rec = this._turretsById?.get(slotId);
    if (!rec) {
      const def = this._cfg.turrets.types[this._selectedType];
      if (this._lastEnergy < def.cost) {
        this._deny(els.g);
        return;
      }
      this.onPlace?.(slotId, this._selectedType);
    } else if (rec.alive) {
      this._openSheet(slotId, rec);
    } else {
      this._deny(els.g); // a wreck — nothing actionable until the next build phase clears it.
    }
  }

  /**
   * @param {number} slotId
   * @param {import('../core/types.js').TurretRecord} rec
   */
  _openSheet(slotId, rec) {
    this._sheetSlotId = slotId;
    this._sheetTitle.textContent = `${rec.type.toUpperCase()} · L${rec.level + 1}`;

    const upCost = upgradeCost(rec.type, rec.level, this._cfg);
    if (upCost === undefined) {
      this._sheetUpgradeBtn.textContent = 'Upgrade — MAX';
      this._sheetUpgradeBtn.disabled = true;
    } else {
      this._sheetUpgradeBtn.textContent = `Upgrade (${upCost})`;
      this._sheetUpgradeBtn.disabled = false;
    }

    const repCost = repairCost(rec, this._cfg);
    if (repCost === 0) {
      this._sheetRepairBtn.textContent = 'Repair — OK';
      this._sheetRepairBtn.disabled = true;
    } else {
      this._sheetRepairBtn.textContent = `Repair (${repCost})`;
      this._sheetRepairBtn.disabled = false;
    }

    this._sheet.hidden = false;
  }

  _closeSheet() {
    this._sheetSlotId = null;
    this._sheet.hidden = true;
  }

  /**
   * @param {Element} el
   */
  _deny(el) {
    this._audio.play('ui-deny');
    el.classList.remove('is-denied');
    // Force a fresh animation run rather than relying on `offsetWidth`
    // reflow tricks, which SVG elements don't support as reliably as HTML.
    requestAnimationFrame(() => el.classList.add('is-denied'));
  }

  // ---- rendering ----------------------------------------------------

  /**
   * @param {number[]} activeGates
   */
  _renderGates(activeGates) {
    this._cfg.arena.gateAngles.forEach((_angleDeg, gateId) => {
      const { arc, closed } = this._gateEls[gateId];
      const active = activeGates.includes(gateId);
      arc.classList.toggle('is-active', active);
      closed.classList.toggle('is-hidden', active);
    });
  }

  _renderSlots() {
    const turretsById = this._turretsById;
    if (!turretsById) return;
    const selectedDef = this._cfg.turrets.types[this._selectedType];

    for (const slot of this._slots) {
      const els = this._slotEls.get(slot.id);
      const rec = turretsById.get(slot.id);

      if (!rec) {
        els.g.classList.remove('is-occupied', 'is-destroyed');
        els.g.classList.add('is-empty');
        els.costText.textContent = `${selectedDef.cost}`;
        els.fill.style.fill = '';
        for (const pip of els.pipEls) pip.style.opacity = '0';
        els.hpFill.setAttribute('width', '0');
        continue;
      }

      if (rec.alive) {
        els.g.classList.remove('is-empty', 'is-destroyed');
        els.g.classList.add('is-occupied');
        const typeDef = this._cfg.turrets.types[rec.type];
        els.fill.style.fill = cssColor(typeDef.color);
        els.pipEls.forEach((pip, i) => {
          pip.style.opacity = i <= rec.level ? '1' : '0';
        });
        const frac = rec.hpMax > 0 ? Math.max(0, Math.min(1, rec.hp / rec.hpMax)) : 0;
        els.hpFill.setAttribute('width', `${13 * frac}`);
        els.hpFill.classList.toggle('is-low', frac <= 0.4);
      } else {
        els.g.classList.remove('is-empty', 'is-occupied');
        els.g.classList.add('is-destroyed');
      }
    }
  }

  /**
   * @param {{x:number, z:number, yaw:number}} player
   */
  _renderPlayer(player) {
    const map = worldToMap(player.x, player.z, this._cfg);
    const yawDeg = (player.yaw * 180) / Math.PI;
    this._playerWedge.setAttribute('transform', `translate(${map.x} ${map.z}) rotate(${yawDeg})`);
  }

  _renderChips() {
    for (const type of this._cfg.turrets.order) {
      const chip = this._chips.get(type);
      const def = this._cfg.turrets.types[type];
      chip.classList.toggle('is-selected', type === this._selectedType);
      chip.classList.toggle('is-affordable', this._lastEnergy >= def.cost);
    }
  }

  // ---- keyboard (touch has no `InputFrame.select`/`ready` equivalent in
  // P2/P3, and BuildOverlay must work for keyboard players even though
  // `Game` itself only reads `InputFrame` once per fixed step while the
  // overlay is a plain DOM layer — see this file's `docs/INTERFACES.md`
  // entry) ------------------------------------------------------------

  _attachKeys() {
    this._keydownHandler = (e) => {
      const k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3') {
        const type = this._cfg.turrets.order[Number(k) - 1];
        if (type) this.setSelectedType(type);
      } else if (k === ' ' || k === 'enter') {
        this.onReady?.();
      } else if (k === 'escape') {
        this._closeSheet();
      }
    };
    window.addEventListener('keydown', this._keydownHandler);
  }

  _detachKeys() {
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }
}
