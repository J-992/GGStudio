// The onboarding. Two rules drive the whole thing:
//
// 1. One idea at a time. Each new verb gets a popup that stops the world, says
//    one thing, and closes. Only then is the player asked to do it. Nothing
//    else competes while a lesson is running -- the objective line, event
//    timer, frenzy button and the auto-opening upgrade panel all stand down.
// 2. Teach late. Merging and locking are not front-loaded into the opening
//    sequence; they pop up the first time they actually happen to the player,
//    which is when the explanation means something.
//
// A big floating hand does all the pointing, and the step card is a one-line
// reminder of the current objective, not an explanation.
const TUTORIAL_STEPS = [
  { id: 'intro',  n: 1, text: '' },
  { id: 'move',   n: 1, text: 'WALK AROUND' },
  { id: 'buy',    n: 2, text: 'BUY THE ONE I POINT AT' },
  { id: 'earn',   n: 3, text: 'WATCH YOUR CASH GO UP' },
  { id: 'steal',  n: 4, text: 'HOLD TO GRAB IT' },
  { id: 'escape', n: 4, text: 'RUN HOME!' },
  { id: 'sell',   n: 5, text: 'HOLD TO SELL YOURS' },
  { id: 'upgrade', n: 6, text: 'WALK TO THE UPGRADE TRUCK' },
  { id: 'done',   n: 6, text: '' },
];
const TUTORIAL_TOTAL = 6;

// Shown once, immediately before the step that needs it.
const LESSONS = {
  intro: { icon: '🎮', title: 'HOW TO PLAY', bodyKeys: 'WASD or ARROWS to move\nSPACE to act',
           bodyTouch: 'DRAG the left side to move\nTAP the button to act' },
  buy:   { icon: '🛒', title: 'THE BELT', body: 'Weirdos ride past on the belt.\nStand next to one and buy it.\nIt starts printing cash for you.' },
  steal: { icon: '🥷', title: 'ROB YOUR RIVALS', body: 'Rivals keep theirs out on pedestals.\nWalk in from any side and HOLD to grab one.' },
  sell:  { icon: '💰', title: 'CASH THEM IN', body: 'HOLD on one of YOUR OWN to sell it.\nUse it when your pedestals are full.' },
  upgrade: { icon: '🔧', title: 'SPEND YOUR CASH',
             body: 'Cash in your pocket earns nothing.\nThe truck sells more pedestals, more income,\nfaster legs and a lock for your base.\n\nWalk up to it and it opens.' },
  merge: { icon: '✨', title: 'THEY MERGE!',
           body: 'Two of the same weirdo fuse into a better one\nthat earns BOTH of them put together.\n\nDoubles are worth chasing on purpose.' },
  lock:  { icon: '🔒', title: 'LOCK YOUR BASE', body: 'A rival just robbed you.\nLock your base to fence them out — or buy a 30s lock at the upgrade station.' },
};

class TutorialSystem {
  constructor(scene) {
    this.scene = scene;
    this.hand = scene.add.image(-300, -300, 'hand')
      .setDepth(946).setVisible(false).setOrigin(0.5, 0)
      .setScale(TextureFactory.scaleFor(scene, 'hand', CFG.HAND_H));
    this.handH = this.hand.displayHeight;
    this._handX = -300; this._handY = -300; this._handT = 0;
    this._waiting = false;      // a popup is up; steps are paused

    this.step = SaveSys.data.tutorialDone ? 'done'
      : (this._known(SaveSys.data.tutorialStep) || 'intro');
    // a resumed step needs its "has this changed yet?" baseline, or it either
    // completes instantly or never completes at all
    this._cashAt = scene.economy.cash.player;
    this._stolenAt = SaveSys.data.stats.stolen;
    this._soldAt = SaveSys.data.stats.sold;
  }

  _known(id) { return TUTORIAL_STEPS.some((s) => s.id === id) ? id : null; }
  _def() { return TUTORIAL_STEPS.find((s) => s.id === this.step) || TUTORIAL_STEPS[0]; }

  running() { return this.step !== 'done'; }

  // what the HUD paints in its step card; null once the tutorial is over
  card() {
    if (this.step === 'done' || this.step === 'intro' || this._waiting) return null;
    const d = this._def();
    return { n: d.n, total: TUTORIAL_TOTAL, text: d.text };
  }

  // While a lesson or a tutorial step is live the HUD stands its extras down,
  // so there is exactly one thing on screen asking for attention.
  quiet() { return this.running() || this.scene.hud.popupOpen; }

  // The upgrade panel stands down for the whole tutorial except the one step
  // whose entire point is opening it.
  blocksUpgradePanel() {
    return this.scene.hud.popupOpen || (this.running() && this.step !== 'upgrade');
  }

  // bots hold off locking while the player is being told to go rob one, or the
  // hand ends up pointing into a base that is fenced shut
  blocksBotLocks() { return this.step === 'steal' || this.step === 'escape'; }

  // ---------- lessons ----------
  // `key` is shown at most once per save. `then` runs after GOT IT.
  _teach(key, then) {
    if (SaveSys.data.taught[key]) { if (then) then(); return false; }
    // never stack two lessons: leave this one unmarked so it fires again the
    // next time its trigger comes round
    if (this.scene.hud.popupOpen) return false;
    const L = LESSONS[key];
    SaveSys.data.taught[key] = true;
    SaveSys.save();
    this._waiting = true;
    this.scene.hud.showPopup({
      icon: L.icon,
      title: L.title,
      body: L.body || (this.scene.inputMgr.isTouch ? L.bodyTouch : L.bodyKeys),
      onClose: () => { this._waiting = false; if (then) then(); },
    });
    return true;
  }

  // fired by CreatureManager the first time the player's own pair fuses
  onFirstMerge() { this._teach('merge'); }

  // fired by StealSystem the first time a rival gets away with something
  onPlayerRobbed() { this._teach('lock'); }

  _goto(step) {
    this.step = step;
    SaveSys.data.tutorialStep = step;
    SaveSys.save();
    if (step === 'earn') this._cashAt = this.scene.economy.cash.player;
    if (step === 'steal') this._stolenAt = SaveSys.data.stats.stolen;
    if (step === 'sell') this._soldAt = SaveSys.data.stats.sold;
  }

  // the ? button: replay the whole thing, lessons included
  restart() {
    SaveSys.data.tutorialDone = false;
    SaveSys.data.taught = {};
    this._goto('intro');
  }

  _finish() {
    SaveSys.data.tutorialDone = true;
    this._goto('done');
    this._hide();
    this.scene.fx.banner("YOU'RE A NATURAL!", '#69f0ae', 'now go get rich');
    Poki.happyTime(1);
  }

  // ---------- hand ----------
  // `y` is the point being indicated; the fingertip rests just clear of it and
  // taps down onto it on the beat.
  _point(x, y) {
    this._handX = x;
    this._handY = y;
    this.hand.setVisible(true);
  }

  _hide() { this.hand.setVisible(false); }

  _animateHand(dtSec) {
    if (!this.hand.visible) return;
    this._handT += dtSec;
    const beat = (this._handT % 0.9) / 0.9;
    const dip = beat < 0.35 ? Math.sin(beat / 0.35 * Math.PI) * 16 : 0;
    // Clamped on screen: the top row of bot bases has pedestals at y~94, and
    // hovering a hand this size above one would put it off the top edge.
    const rest = this.handH + 12;
    const targetY = Phaser.Math.Clamp(this._handY - rest + dip, 4, CFG.H - this.handH - 8);
    const targetX = Phaser.Math.Clamp(this._handX, 40, CFG.W - 40);
    const k = Math.min(1, dtSec * 9);
    this.hand.x += (targetX - this.hand.x) * k;
    this.hand.y += (targetY - this.hand.y) * k;
    this.hand.setAngle(Math.sin(this._handT * 2.2) * 6);
  }

  _ownOnPedestal() {
    return this.scene.creatures.creaturesOf('player').find((c) => c.state === 'pedestal') || null;
  }

  update(time, dtSec) {
    const s = this.scene;
    this._animateHand(dtSec || 0.016);
    if (this.step === 'done') { this._hide(); return; }
    if (this._waiting) { this._hide(); return; }   // a lesson is on screen

    if (this.step === 'intro') {
      this._hide();
      this._teach('intro', () => this._goto('move'));
      return;
    }

    if (this.step === 'move') {
      this._hide();
      if (s.inputMgr.vec.x || s.inputMgr.vec.y) this._teach('buy', () => this._goto('buy'));
      return;
    }

    if (this.step === 'buy') {
      let target = null;
      for (const cr of s.creatures.onBelt()) {
        if (cr.x > 60 && cr.x < CFG.W - 120 && s.economy.canAfford('player', cr.def.price) &&
            (!target || cr.def.price < target.def.price)) target = cr;
      }
      if (target) this._point(target.x, target.y - 84); else this._hide();
      if (s.creatures.creaturesOf('player').length > 0) this._goto('earn');

    } else if (this.step === 'earn') {
      const own = this._ownOnPedestal();
      if (own) this._point(own.x, own.y - 84); else this._hide();
      // advance on real income, not a stopwatch -- the point is seeing the
      // counter move, and a creature still in transit isn't earning yet
      if (s.economy.cash.player > this._cashAt) this._teach('steal', () => this._goto('steal'));

    } else if (this.step === 'steal') {
      let target = null, bd = 1e9;
      for (const cr of s.creatures.list) {
        if (cr.state !== 'pedestal' || cr.owner === 'player' || s.bases.isLocked(cr.owner)) continue;
        const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, cr.x, cr.y);
        if (d < bd) { bd = d; target = cr; }
      }
      if (target) this._point(target.x, target.y - 84); else this._hide();
      if (s.player.carrying) this._goto('escape');

    } else if (this.step === 'escape') {
      // any side of the base works, so point at the base itself
      const b = CFG.BASES.player;
      this._point(b.x, b.y - b.h / 2 + 10);
      if (!s.player.carrying) {
        if (SaveSys.data.stats.stolen > this._stolenAt) {
          this._teach('sell', () => this._goto('sell'));
        } else {
          this._goto('steal');     // got caught: try again
        }
      }

    } else if (this.step === 'sell') {
      const own = this._ownOnPedestal();
      if (own) this._point(own.x, own.y - 84); else this._hide();
      if (SaveSys.data.stats.sold > this._soldAt) this._teach('upgrade', () => this._goto('upgrade'));

    } else if (this.step === 'upgrade') {
      // Ends on ARRIVAL, not on a purchase: a player who has just been taught
      // to sell rarely has the price of an upgrade on them yet, and stalling
      // the tutorial against a price tag is worse than ending it one step
      // short of a buy.
      const st = CFG.UPGRADE_STATION;
      this._point(st.x, st.y - 64);
      if (s.hud.upgradeOpen()) this._finish();
    }
  }
}
window.TutorialSystem = TutorialSystem;
