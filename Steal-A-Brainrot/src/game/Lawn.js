// The lawn: a 6x9 grid of planted brainrots, plus the checkerboard turf, the
// moped strip and the dimming of inactive lanes. The grid is data
// (this.grid[lane][col] = unit | null); sprites hang off each unit and never
// own gameplay state.
class Lawn {
  constructor(scene, activeLanes) {
    this.scene = scene;
    this.activeLanes = activeLanes;      // array of lane indices open this level
    this.grid = [];
    for (let l = 0; l < CFG.GRID.lanes; l++) this.grid.push(new Array(CFG.GRID.cols).fill(null));

    this.board = scene.add.graphics().setDepth(5);
    this.highlight = scene.add.image(0, 0, 'slotPad').setDepth(40).setVisible(false);

    // one moped per ACTIVE lane -- the last line of defence
    this.mopeds = [];
    for (let l = 0; l < CFG.GRID.lanes; l++) {
      const img = scene.add.image(0, 0, 'moped').setDepth(200 + l * 10);
      this.mopeds.push({ lane: l, img, used: false, riding: false, x: 0 });
    }

    this._drawBoard();
    this._placeMopeds();
  }

  isActive(lane) { return this.activeLanes.includes(lane); }

  unitAt(lane, col) {
    if (lane < 0 || lane >= CFG.GRID.lanes || col < 0 || col >= CFG.GRID.cols) return null;
    const u = this.grid[lane][col];
    return u && !u.dead ? u : null;
  }

  units() {
    const out = [];
    for (const row of this.grid) for (const u of row) if (u && !u.dead) out.push(u);
    return out;
  }

  canPlace(lane, col) {
    return this.isActive(lane)
      && col >= 0 && col < CFG.GRID.cols
      && lane >= 0 && lane < CFG.GRID.lanes
      && !this.grid[lane][col];
  }

  // ------------------------------------------------------------- planting

  place(id, lane, col) {
    const def = CREATURES_BY_ID[id];
    const f = LAYOUT.field;
    const x = f.colX(col), y = f.laneY(lane);

    const root = this.scene.add.container(x, y).setDepth(100 + lane * 10 + 5);
    const shadow = this.scene.add.image(0, 2, 'shadow').setAlpha(0.45);
    shadow.setScale(LAYOUT.unitH / 70);
    const img = this.scene.add.image(0, 0, 'cr_' + id).setOrigin(0.5, 1);
    img.setScale(LAYOUT.unitH / img.height);
    root.add([shadow, img]);

    const barW = Math.max(34, LAYOUT.unitH * 0.6);
    const hpBg = this.scene.add.rectangle(0, -LAYOUT.unitH - 8, barW, 6, 0x263238).setOrigin(0.5).setVisible(false);
    const hpFg = this.scene.add.rectangle(-barW / 2, -LAYOUT.unitH - 8, barW, 4, 0x66bb6a).setOrigin(0, 0.5).setVisible(false);
    root.add([hpBg, hpFg]);

    const unit = {
      id, def, lane, col, root, img, hpBg, hpFg, barW,
      hp: def.hp, maxHp: def.hp,
      cdMs: 0,                                   // attack cooldown
      produceT: def.role === 'producer' ? def.produceMs : 0,
      armT: def.role === 'mine' ? def.armMs : 0,
      armed: def.role !== 'mine',
      dead: false,
    };
    this.grid[lane][col] = unit;

    if (def.role === 'mine') img.setAlpha(0.75).setScale(img.scale * 0.8); // burrowed while arming

    // plop in
    root.setScale(0.2);
    this.scene.tweens.add({ targets: root, scale: 1, duration: 240, ease: 'Back.easeOut' });
    this.scene.fx.ringPulse(x, y - LAYOUT.unitH * 0.4, def.color, 1.1);
    AudioSys.sfx('place');
    SaveSys.addStat('planted');
    return unit;
  }

  dig(lane, col) {
    const u = this.unitAt(lane, col);
    if (!u) return false;
    this.grid[lane][col] = null;
    u.dead = true;
    this.stopArmedBlink(u);
    AudioSys.sfx('sell');
    this.scene.fx.sparks(u.root.x, u.root.y - 20, 0x8d6e63, 8);
    this.scene.tweens.add({
      targets: u.root, y: u.root.y - 30, alpha: 0, angle: 30, duration: 260, ease: 'Quad.easeIn',
      onComplete: () => u.root.destroy(),
    });
    return true;
  }

  damageUnit(unit, dmg) {
    if (unit.dead) return;
    unit.hp -= dmg;
    unit.hpBg.setVisible(true);
    unit.hpFg.setVisible(true);
    unit.hpFg.width = Math.max(0, unit.barW * (unit.hp / unit.maxHp));
    unit.hpFg.fillColor = unit.hp / unit.maxHp > 0.4 ? 0x66bb6a : 0xef5350;
    unit.img.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => { if (!unit.dead) unit.img.clearTint(); });
    if (unit.hp <= 0) this.killUnit(unit);
  }

  killUnit(unit) {
    if (unit.dead) return;
    unit.dead = true;
    this.stopArmedBlink(unit);
    this.grid[unit.lane][unit.col] = null;
    AudioSys.sfx('hurt');
    this.scene.fx.sparks(unit.root.x, unit.root.y - LAYOUT.unitH * 0.4, 0xef5350, 10);
    this.scene.tweens.add({
      targets: unit.root, scaleX: 1.2, scaleY: 0.1, alpha: 0, duration: 220, ease: 'Quad.easeIn',
      onComplete: () => unit.root.destroy(),
    });
  }

  // mine finished arming: surface with a hop, then start blinking
  armMine(unit) {
    unit.armed = true;
    unit.img.setAlpha(1).setScale(LAYOUT.unitH / unit.img.height);
    this.scene.tweens.add({ targets: unit.root, y: unit.root.y - 10, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
    this.scene.fx.ringPulse(unit.root.x, unit.root.y - 20, 0xffb300, 1.0);
    this.startArmedBlink(unit);
  }

  // An armed mine and an arming mine looked near enough identical, so the only
  // way to know whether the capybara would actually go off was to count the
  // seconds since you planted it. Now it blinks red the moment it is live --
  // one-shot traps are worth nothing if you cannot tell they are ready.
  startArmedBlink(unit) {
    this.stopArmedBlink(unit);
    // A pulse rather than a hard on/off toggle: it reads as "live and waiting"
    // instead of as a rendering glitch, and it is a tween like every other
    // looping visual here rather than a lone clock event to keep in sync.
    unit.armBlink = this.scene.tweens.addCounter({
      from: 0, to: 1, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        if (unit.dead || !unit.img || !unit.img.active) return;
        // white -> 0xff1744, so the capybara reddens without going black
        const v = tw.getValue();
        unit.img.setTint(Phaser.Display.Color.GetColor(
          255, Math.round(255 - 232 * v), Math.round(255 - 187 * v)));
      },
    });
  }

  stopArmedBlink(unit) {
    if (!unit.armBlink) return;
    unit.armBlink.stop();
    unit.armBlink = null;
    if (!unit.dead && unit.img && unit.img.active) unit.img.clearTint();
  }

  // ---------------------------------------------------------- placement UI

  showHighlight(lane, col, ok) {
    const f = LAYOUT.field;
    this.highlight.setVisible(true)
      .setPosition(f.colX(col), f.laneY(lane) - f.laneH * 0.36)
      .setDisplaySize(f.colW * 0.94, f.laneH * 0.9)
      .setTint(ok ? 0x69f0ae : 0xff5252)
      .setAlpha(0.8);
  }

  hideHighlight() { this.highlight.setVisible(false); }

  // ------------------------------------------------------------- the board

  _drawBoard() {
    const g = this.board;
    const f = LAYOUT.field;
    g.clear();

    // dark yard from under the card bar to the bottom edge, so a tall phone
    // never shows bare canvas around the lawn
    g.fillStyle(0x16281c, 1);
    g.fillRect(f.x, f.bgTop, f.w, LAYOUT.height - f.bgTop - 2);

    // grass backdrop behind everything, moped strip a shade darker
    g.fillStyle(0x2e5d34, 1);
    g.fillRoundedRect(f.x, f.y, f.w, f.h, 10);
    g.fillStyle(0x24492a, 1);
    g.fillRect(f.x, f.y, f.mowerW, f.h);

    // checkerboard cells; inactive lanes get a dark wash
    for (let l = 0; l < CFG.GRID.lanes; l++) {
      const active = this.isActive(l);
      for (let c = 0; c < CFG.GRID.cols; c++) {
        const even = (l + c) % 2 === 0;
        g.fillStyle(even ? 0x3f7a46 : 0x376e3e, 1);
        g.fillRect(f.gridX + c * f.colW, f.y + l * f.laneH, f.colW, f.laneH);
      }
      if (!active) {
        g.fillStyle(0x0a0f1e, 0.55);
        g.fillRect(f.x, f.y + l * f.laneH, f.w, f.laneH);
      }
    }

    // faint lane separators
    g.lineStyle(2, 0x1d3a22, 0.8);
    for (let l = 1; l < CFG.GRID.lanes; l++) {
      g.lineBetween(f.x, f.y + l * f.laneH, f.x + f.w, f.y + l * f.laneH);
    }
    g.lineStyle(3, 0x8d6e63, 0.9);
    g.lineBetween(f.gridX, f.y, f.gridX, f.y + f.h);
  }

  _placeMopeds() {
    const f = LAYOUT.field;
    this.mopeds.forEach((m) => {
      m.img.setVisible(this.isActive(m.lane) && !m.used && !m.riding);
      if (!m.riding) {
        m.x = f.x + f.mowerW / 2;
        m.img.setPosition(m.x, f.laneY(m.lane) - 8);
        m.img.setScale(Math.min(f.mowerW / 68, f.laneH / 80));
      }
    });
  }

  mopedFor(lane) {
    const m = this.mopeds[lane];
    return m && !m.used && !m.riding ? m : null;
  }

  relayout() {
    this._drawBoard();
    this._placeMopeds();
    this.hideHighlight();
    const f = LAYOUT.field;
    this.units().forEach((u) => {
      u.root.setPosition(f.colX(u.col), f.laneY(u.lane));
      u.img.setScale(LAYOUT.unitH / u.img.height * (u.def.role === 'mine' && !u.armed ? 0.8 : 1));
    });
  }
}
window.Lawn = Lawn;
