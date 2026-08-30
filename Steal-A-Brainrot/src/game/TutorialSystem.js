// The level-1 onboarding, told entirely in pictures.
//
// WHY NO WORDS. Poki's audience is majority mobile, largely kids, and heavily
// non-English; a card reading "PLANT COCOFANTO! HE MAKES BRAINZ!" is three
// separate things a player has to already be able to do -- read English, know
// which sprite is Cocofanto, and know what a brainz is -- before it teaches
// anything. So every step here is a demonstration instead: a spotlight on the
// thing to touch, a ghost of the result where it goes, a hand that performs
// the gesture on a loop, and chevrons showing which way things travel.
//
// The one idea that has to land is that THE ELEPHANT MAKES THE MONEY. That
// gets its own step ('teach'): the moment Cocofanto is planted the game forces
// a payout out of him and floats a wordless recipe over his head --
// [elephant] -> [coin] -- so the player watches the economy happen rather than
// reading a claim about it.
//
// The world is never frozen; the waves are just held back (director.holdPrep)
// until the player has been shown everything.
class TutorialSystem {
  static ORDER = ['plant', 'collect', 'producer', 'teach', 'defend'];

  // where the script wants its two demo plants
  static SHOOTER_CELL = { lane: 2, col: 2 };
  static PRODUCER_CELL = { lane: 2, col: 0 };

  constructor(scene, director) {
    this.scene = scene;
    this.director = director;
    this.active = !SaveSys.data.tutorialDone && scene.levelN === 1;

    const D = 1040;
    // The dim sheet. Holes are punched in it per step, so "the only lit thing
    // on the screen is the thing to touch" needs no arrow and no sentence.
    this.dim = scene.add.renderTexture(0, 0, LAYOUT.width, LAYOUT.height)
      .setOrigin(0, 0).setDepth(D).setVisible(false);
    this._eraser = scene.add.image(0, 0, 'dot').setVisible(false);

    this.ghost = scene.add.image(0, 0, 'cr_trippi').setDepth(D + 30).setVisible(false);
    this.ring = scene.add.image(0, 0, 'ring').setDepth(D + 28).setVisible(false);
    this.hand = scene.add.image(0, 0, 'hand').setDepth(D + 35).setVisible(false);
    this.hand.setScale(TextureFactory.scaleFor(scene, 'hand', CFG.ART.handH));
    this.chevrons = [];
    for (let i = 0; i < 3; i++) {
      this.chevrons.push(scene.add.image(0, 0, 'arrow').setDepth(D + 26).setVisible(false));
    }
    this.formula = scene.add.container(0, 0).setDepth(D + 40).setVisible(false);

    this._tweens = [];
    this._timer = null;
    this._coin = null;

    if (this.active) {
      this._enter('plant');
    } else {
      this.step = null;
      this.director.holdPrep = false;
    }
  }

  // ------------------------------------------------------------- the script

  _enter(step) {
    this.step = step;
    // Everything up to 'defend' happens on a lawn nothing is walking down.
    this.director.holdPrep = step !== 'defend';
    this._clear();

    const f = LAYOUT.field;
    switch (step) {
      case 'plant': {
        const cell = TutorialSystem.SHOOTER_CELL;
        this._teachPlant('trippi', cell);
        break;
      }

      case 'collect': {
        // Guarantee something to point at rather than waiting on the sky timer,
        // and make it immortal: a coin that ages out mid-lesson leaves the hand
        // tapping an empty patch of grass with no way forward.
        const live = this._coin && !this._coin.collected
          && this.scene.energy.tokens.indexOf(this._coin) !== -1;
        const t = live ? this._coin : this.scene.energy.spawnSky(2, 3, { noExpire: true });
        this._coin = t;
        if (!t) { this._enter('producer'); break; }
        // Aim at where the coin LANDS, not where it currently is: a sky drop
        // spends 1.4s falling, and a spotlight on its spawn point sits in the
        // card bar pointing at nothing.
        const at = { x: t.restX, y: t.restY };
        const hud = this.scene.hud.energyTarget();
        this._spotlight([
          { x: at.x, y: at.y, r: f.colW * 0.55 },
          { x: hud.x, y: hud.y, r: 46 },
        ]);
        this._tapAt(at.x, at.y);
        this._flow(at, hud, 0xffd54f);
        break;
      }

      case 'producer':
        this._teachPlant('cocofanto', TutorialSystem.PRODUCER_CELL);
        break;

      case 'teach': {
        // The payoff step: he was just planted, so make him pay out NOW and
        // put the recipe over his head while it happens.
        const cell = TutorialSystem.PRODUCER_CELL;
        const unit = this.scene.lawn.unitAt(cell.lane, cell.col);
        const x = f.colX(cell.col), y = f.laneY(cell.lane);
        if (unit) unit.produceT = 900;
        this._spotlight([{ x, y: y - f.laneH * 0.45, r: f.colW * 0.95 }]);
        this._recipe(x, y - LAYOUT.unitH - 46, 'cocofanto');
        this._after(5200, () => { if (this.step === 'teach') this._enter('defend'); });
        break;
      }

      case 'defend':
        this._threat();
        this._after(2600, () => { if (this.step === 'defend') this._clear(); });
        break;
    }
  }

  // Spotlight the card and the cell, ghost the result onto the cell, and run
  // the drag on a loop. Used for both demo plants, which is the point: the
  // second one is the same gesture, so it reads as "again, with this one".
  _teachPlant(id, cell) {
    const f = LAYOUT.field;
    const cb = LAYOUT.cards;
    const i = this.scene.cards.indexOf(id);
    const from = this.scene.cards.cardPos(i === -1 ? 0 : i);
    const to = { x: f.colX(cell.col), y: f.laneY(cell.lane) - f.laneH * 0.3 };

    this._spotlight([
      { x: from.x, y: from.y, rx: cb.cardW * 0.72, ry: cb.cardH * 0.66 },
      { x: to.x, y: to.y, r: f.colW * 0.62 },
    ]);
    this._ringAt(from.x, from.y, Math.max(cb.cardW, cb.cardH) * 1.05);
    this._ghostAt(id, f.colX(cell.col), f.laneY(cell.lane));
    this._flow(from, to, 0x69f0ae);
    this._dragDemo(from, to);
  }

  // ---------------------------------------------------------------- visuals

  // A dark sheet with soft holes cut in it. Areas are {x, y, r} or
  // {x, y, rx, ry}, given as RADII in world pixels.
  _spotlight(areas) {
    const rt = this.dim;
    rt.setPosition(0, 0).setSize(LAYOUT.width, LAYOUT.height).setVisible(true);
    rt.clear();
    rt.fill(0x060a14, 0.68);
    areas.forEach((a) => {
      const rx = a.rx !== undefined ? a.rx : a.r;
      const ry = a.ry !== undefined ? a.ry : a.r;
      // 'dot' is a 32px texture holding a 30px white ellipse; scaling it gives
      // an oval hole with none of the corner artefacts a rounded-rect mask has.
      this._eraser.setPosition(a.x, a.y).setScale((rx * 2) / 30, (ry * 2) / 30);
      rt.erase(this._eraser);
    });
  }

  _ghostAt(id, x, y) {
    const g = this.ghost;
    g.setTexture('cr_' + id).setOrigin(0.5, 1);
    g.setScale(LAYOUT.unitH / g.height);
    g.setPosition(x, y).setAlpha(0.5).setVisible(true);
    this._tween({ targets: g, alpha: 0.9, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _ringAt(x, y, size) {
    const r = this.ring;
    r.setPosition(x, y).setVisible(true).setTint(0xffd54f).setAlpha(0.9);
    r.setDisplaySize(size, size);
    this._tween({
      targets: r, alpha: 0.35, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  // Chevrons crawling from a to b: the wordless "this goes there".
  _flow(a, b, color) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    this.chevrons.forEach((c, i) => {
      c.setVisible(true).setTint(color).setAlpha(0.95).setScale(0.9);
      c.setRotation(ang - Math.PI / 2);   // 'arrow' points down at rest
      c.setPosition(a.x, a.y);
      this._tween({
        targets: c,
        x: b.x, y: b.y, alpha: { from: 0.95, to: 0.1 },
        duration: 900, delay: i * 220, repeat: -1, repeatDelay: 260, ease: 'Quad.easeIn',
      });
    });
  }

  // The whole lesson, drawn: elephant, chevron, coin -- and a coin that keeps
  // popping out of the right-hand side.
  _recipe(x, y, id) {
    const r = this.formula;
    r.removeAll(true);
    const W = 168, H = 76;

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x101a30, 0.92);
    panel.fillRoundedRect(-W / 2, -H / 2, W, H, 16);
    panel.lineStyle(4, 0xffd54f, 1);
    panel.strokeRoundedRect(-W / 2, -H / 2, W, H, 16);

    const who = this.scene.add.image(-46, 6, 'cr_' + id).setOrigin(0.5, 1);
    who.setScale(56 / who.height);

    const arrow = this.scene.add.image(2, -4, 'arrow').setTint(0xffd54f).setRotation(-Math.PI / 2);

    const coin = this.scene.add.image(50, -4, 'dogecoin');
    coin.setScale(TextureFactory.scaleFor(this.scene, 'dogecoin', 42));

    r.add([panel, who, arrow, coin]);
    // Column 0 sits against the left edge, so the badge has to be pulled back
    // on screen rather than centred over the unit it describes.
    const cx = Math.min(Math.max(x, W / 2 + 10), LAYOUT.width - W / 2 - 10);
    const cy = Math.max(y, LAYOUT.cards.y + LAYOUT.cards.h + H / 2 + 8);
    r.setPosition(cx, cy).setVisible(true).setAlpha(0);

    this._tween({ targets: r, alpha: 1, duration: 220 });
    this._tween({ targets: who, scaleY: who.scaleY * 0.88, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const cs = coin.scale;
    this._tween({
      targets: coin, scale: { from: cs * 0.62, to: cs * 1.12 }, duration: 520,
      yoyo: true, repeat: -1, repeatDelay: 260, ease: 'Back.easeOut',
    });
    this._tween({
      targets: arrow, x: 14, alpha: { from: 1, to: 0.2 }, duration: 520,
      repeat: -1, repeatDelay: 520, ease: 'Quad.easeIn',
    });
  }

  // The last beat: they come from over there, and they come at your lanes.
  _threat() {
    const f = LAYOUT.field;
    const lanes = this.scene.lawn.activeLanes;
    this.chevrons.forEach((c, i) => {
      const lane = lanes[i % lanes.length];
      const y = f.laneY(lane) - f.laneH * 0.4;
      c.setVisible(true).setTint(0xff5252).setAlpha(0.95).setScale(1.15);
      c.setRotation(Math.PI / 2);          // pointing left, the way they walk
      c.setPosition(f.spawnX, y);
      this._tween({
        targets: c, x: f.gridX, alpha: { from: 0.95, to: 0.15 },
        duration: 1100, delay: i * 180, repeat: -1, repeatDelay: 200, ease: 'Quad.easeIn',
      });
    });
  }

  _pointAt(x, y) {
    this.hand.setVisible(true).setPosition(x + 18, y - 70);
    this._tween({
      targets: this.hand, y: y - 44, duration: 420, yoyo: true, repeat: -1, ease: 'Quad.easeInOut',
    });
  }

  _tapAt(x, y) {
    this._pointAt(x, y);
    // an expanding tap ripple under the finger, so "tap" is unmistakably tap
    // and not "drag from here"
    this.ring.setPosition(x, y).setVisible(true).setTint(0xffd54f);
    this.ring.setDisplaySize(30, 30);
    this._tween({
      targets: this.ring,
      displayWidth: 96, displayHeight: 96, alpha: { from: 0.9, to: 0 },
      duration: 840, repeat: -1, ease: 'Quad.easeOut',
    });
  }

  _dragDemo(a, b) {
    this.hand.setVisible(true).setPosition(a.x + 16, a.y - 16);
    this._tween({
      targets: this.hand,
      x: b.x + 16, y: b.y - 16,
      duration: 950, delay: 320, repeat: -1, repeatDelay: 520, ease: 'Quad.easeInOut',
    });
  }

  // ------------------------------------------------------------- bookkeeping

  _tween(cfg) {
    const t = this.scene.tweens.add(cfg);
    this._tweens.push(t);
    return t;
  }

  _after(ms, fn) {
    this._timer = this.scene.time.delayedCall(ms, fn);
    return this._timer;
  }

  _clear() {
    this._tweens.forEach((t) => { if (t) t.stop(); });
    this._tweens = [];
    if (this._timer) { this._timer.remove(false); this._timer = null; }
    this.dim.setVisible(false);
    this.hand.setVisible(false);
    this.ghost.setVisible(false).setAlpha(1);
    this.ring.setVisible(false).setAlpha(1);
    this.chevrons.forEach((c) => c.setVisible(false).setAlpha(1));
    this.formula.setVisible(false).removeAll(true);
  }

  // ---- hooks from the rest of the game ----

  onPlant(id) {
    if (!this.active) return;
    if (this.step === 'plant') this._enter('collect');
    else if (this.step === 'producer' && id === 'cocofanto') this._enter('teach');
  }

  onCollect() {
    if (!this.active) return;
    if (this.step === 'collect') this._enter('producer');
  }

  onBattleStart() {}

  // The lesson has to survive the player wandering off mid-step. If the coin
  // we were pointing at is gone (collected elsewhere, or a relayout dropped
  // it), put another one down rather than pointing at nothing.
  update() {
    if (!this.active || this.step !== 'collect') return;
    const t = this._coin;
    if (t && !t.collected && this.scene.energy.tokens.indexOf(t) !== -1) return;
    this._enter('collect');
  }

  onVictory() {
    if (!this.active) return;
    this.active = false;
    this.step = null;
    SaveSys.data.tutorialDone = true;
    SaveSys.save();
    this._clear();
    this.scene.fx.banner('LAWN DEFENDED!', '#ffd54f', 'Time to grow the squad!');
    Poki.happyTime(0.8);
  }

  relayout() {
    if (this.active && this.step) this._enter(this.step);
  }
}
window.TutorialSystem = TutorialSystem;
