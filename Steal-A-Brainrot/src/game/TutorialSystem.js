// First-run tutorial delivered through play, not menus: buy → collect →
// steal → escape, each step pointed at by a bouncing arrow. Skipped entirely
// once completed (saved).
class TutorialSystem {
  constructor(scene) {
    this.scene = scene;
    this.step = SaveSys.data.tutorialDone ? 'done' : 'buy';
    this.arrow = scene.add.image(-100, -100, 'arrow').setTint(0xffee58).setDepth(945).setVisible(false);
    scene.tweens.add({ targets: this.arrow, y: '+=10', duration: 320, yoyo: true, repeat: -1 });
    this._collectUntil = 0;
    this._announced = null;
  }

  objective() {
    switch (this.step) {
      case 'buy': return 'BUY A WEIRDO — walk to the belt, press SPACE';
      case 'collect': return 'COLLECT CASH — your weirdo prints money!';
      case 'steal': return 'STEAL ONE! Sneak into a rival base, HOLD SPACE';
      case 'escape': return 'RUN! RUN! RUN! Get back to YOUR base!';
      default: return null;
    }
  }

  _point(x, y) {
    this.arrow.setVisible(true);
    this.arrow.x = x;
    if (Math.abs(this.arrow.y - y) > 26) this.arrow.y = y;
  }

  _announce(key, text, color) {
    if (this._announced === key) return;
    this._announced = key;
    this.scene.fx.banner(text, color || '#ffee58');
  }

  update(time) {
    const s = this.scene;
    if (this.step === 'done') { this.arrow.setVisible(false); return; }

    if (this.step === 'buy') {
      this._announce('buy', 'BUY A WEIRDO!');
      let target = null;
      for (const cr of s.creatures.onBelt()) {
        if (cr.x > 60 && cr.x < CFG.W - 120 && s.economy.canAfford('player', cr.def.price) &&
            (!target || cr.def.price < target.def.price)) target = cr;
      }
      if (target) this._point(target.x, target.y - 110); else this.arrow.setVisible(false);
      if (s.creatures.creaturesOf('player').length > 0) {
        this.step = 'collect';
        this._collectUntil = time + 5000;
      }
    } else if (this.step === 'collect') {
      this._announce('collect', 'COLLECT CASH!', '#b9f6ca');
      const own = s.creatures.creaturesOf('player')[0];
      if (own) this._point(own.x, own.y - 110); else this.arrow.setVisible(false);
      if (time > this._collectUntil) this.step = 'steal';
    } else if (this.step === 'steal') {
      this._announce('steal', 'STEAL ONE!', '#ff8a80');
      let target = null, bd = 1e9;
      for (const cr of s.creatures.list) {
        if (cr.state !== 'pedestal' || cr.owner === 'player' || s.bases.isLocked(cr.owner)) continue;
        const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, cr.x, cr.y);
        if (d < bd) { bd = d; target = cr; }
      }
      if (target) this._point(target.x, target.y - 110); else this.arrow.setVisible(false);
      if (s.player.carrying) { this.step = 'escape'; this._announced = null; }
    } else if (this.step === 'escape') {
      this._announce('escape', 'RUN! RUN! RUN!', '#ff8a80');
      const e = s.bases.entranceOutside('player');
      this._point(e.x, e.y - 30);
      if (!s.player.carrying) {
        if (s.creatures.creaturesOf('player').length > 1 || SaveSys.data.stats.stolen > 0) {
          // made it home — full fantasy complete
          this.step = 'done';
          SaveSys.data.tutorialDone = true;
          SaveSys.save();
          this.arrow.setVisible(false);
          s.fx.banner("YOU'RE A NATURAL MENACE!", '#69f0ae', 'Upgrade, steal, and REBIRTH to grow');
          Poki.happyTime(1);
        } else {
          this.step = 'steal';   // got caught: try again
          this._announced = null;
        }
      }
    }
  }
}
window.TutorialSystem = TutorialSystem;
