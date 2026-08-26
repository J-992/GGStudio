// The player: physics-driven movement, contextual interaction (buy / steal /
// slap / rebirth), hold-to-steal progress and the floating key hint.
class PlayerController {
  constructor(scene) {
    this.scene = scene;
    this.id = 'player';
    this.name = 'You';
    this.carrying = null;
    this.stunnedUntil = 0;
    this.knockVx = 0; this.knockVy = 0;
    this.slapReadyAt = 0;
    this.holdMs = 0;
    this.holdKind = null;      // 'steal' | 'rebirth'
    this.holdTarget = null;

    const spawn = scene.bases.entranceOutside('player');
    this.sprite = scene.physics.add.image(spawn.x, spawn.y - 10, 'player');
    // The collider is authored against the 64x72 placeholder; a rendered
    // sprite comes in bigger, so express it as a fraction of the texture and
    // let the sprite's own scale bring it back to the same world size.
    this.baseScale = TextureFactory.scaleFor(scene, 'player', CFG.CHARACTER_H);
    this.sprite.setScale(this.baseScale);
    const k = this.sprite.height / CFG.CHARACTER_H;
    this.sprite.body.setCircle(20 * k, 12 * k, 30 * k);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(spawn.y);

    this.shadow = scene.add.image(spawn.x, spawn.y, 'shadow').setDepth(2).setScale(1.2);
    this.hint = scene.add.text(spawn.x, spawn.y - 66, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(930);
    this.holdArc = scene.add.graphics().setDepth(935);
    this._bobT = 0;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  spin() {
    this.scene.tweens.add({ targets: this.sprite, angle: 360, duration: 500,
      onComplete: () => this.sprite.setAngle(0) });
  }

  speed() {
    const s = this.scene;
    let v = CFG.PLAYER_SPEED * (1 + 0.08 * (s.upgrades.speed || 0));
    if (this.carrying) v *= CFG.CARRY_SLOW;
    if (s.eventMgr && s.eventMgr.active === 'tiny') v *= 1.45;
    return v;
  }

  update(time, dtSec) {
    const s = this.scene;
    const inp = s.inputMgr;
    const body = this.sprite.body;

    // tiny mode scale
    const tiny = s.eventMgr && s.eventMgr.active === 'tiny';
    this.sprite.setScale(this.baseScale * (tiny ? 0.62 : 1));

    if (time < this.stunnedUntil) {
      body.setVelocity(this.knockVx, this.knockVy);
      this.knockVx *= 0.92; this.knockVy *= 0.92;
    } else {
      const v = this.speed();
      body.setVelocity(inp.vec.x * v, inp.vec.y * v);
      // the belt drags anyone standing on it
      if (Math.abs(this.y - CFG.CONVEYOR_Y) < 28) {
        body.velocity.x += CFG.BELT_PUSH * (s.conveyor ? s.conveyor.speedMult() : 1);
      }
      if (inp.vec.x || inp.vec.y) {
        this._bobT += dtSec * 10;
        this.sprite.setAngle(Math.sin(this._bobT) * 5);
      } else {
        this.sprite.setAngle(0);
      }
    }

    this.shadow.setPosition(this.x, this.y + 32);
    this.sprite.setDepth(this.y + 30);

    this._interact(time, dtSec);
    this.hint.setPosition(this.x, this.y - (tiny ? 46 : 66));
  }

  _nearestBelt() {
    let best = null, bd = 58;
    for (const cr of this.scene.creatures.onBelt()) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, cr.x, cr.y - 20);
      if (d < bd) { bd = d; best = cr; }
    }
    return best;
  }

  _nearestStealable() {
    let best = null, bd = 64;
    for (const cr of this.scene.creatures.list) {
      if (cr.owner === 'player' || cr.state !== 'pedestal') continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, cr.x, cr.y - 20);
      if (d < bd && this.scene.steal.canGrab(this, cr)) { bd = d; best = cr; }
    }
    return best;
  }

  _nearestThief() {
    for (const b of this.scene.bots) {
      if (b.carrying && b.carrying.owner === 'player' &&
          Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y) < CFG.SLAP_RANGE) return b;
    }
    return null;
  }

  _nearestBot() {
    let best = null, bd = CFG.SLAP_RANGE;
    for (const b of this.scene.bots) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  slapCd() { return CFG.SLAP_CD_MS * Math.pow(0.85, this.scene.upgrades.slap || 0); }

  _interact(time, dtSec) {
    const s = this.scene;
    const inp = s.inputMgr;
    const kb = !inp.isTouch;
    let label = '', hold = null, holdTarget = null, tap = null;

    if (this.carrying) {
      label = 'RUN HOME!';
    } else {
      const thief = this._nearestThief();
      const belt = this._nearestBelt();
      const stealT = this._nearestStealable();
      const nearPortal = Phaser.Math.Distance.Between(this.x, this.y, CFG.REBIRTH_PORTAL.x, CFG.REBIRTH_PORTAL.y) < 76;
      const slapReady = time >= this.slapReadyAt;

      if (thief && slapReady) {
        label = (kb ? '[SPACE] ' : '') + 'SLAP!';
        tap = () => this._doSlap(time);
      } else if (belt) {
        label = (kb ? '[SPACE] ' : '') + 'BUY $' + belt.def.price;
        tap = () => this._doBuy(belt);
      } else if (stealT) {
        label = (kb ? 'HOLD [SPACE] ' : 'HOLD: ') + 'STEAL';
        hold = 'steal'; holdTarget = stealT;
      } else if (nearPortal && s.rebirth.eligible()) {
        label = (kb ? 'HOLD [SPACE] ' : 'HOLD: ') + 'REBIRTH!';
        hold = 'rebirth';
      } else if (this._nearestBot() && slapReady) {
        label = (kb ? '[SPACE] ' : '') + 'SLAP';
        tap = () => this._doSlap(time);
      }
    }

    this.hint.setText(label);
    inp.setActionLabel(label.replace('[SPACE] ', '').replace('HOLD [SPACE] ', 'HOLD:\n'));

    // taps
    if (tap && inp.actionJust) tap();

    // holds
    if (hold && inp.actionHeld) {
      if (this.holdKind !== hold || (hold === 'steal' && this.holdTarget !== holdTarget)) {
        this.holdKind = hold; this.holdTarget = holdTarget; this.holdMs = 0;
      }
      this.holdMs += dtSec * 1000;
      const need = hold === 'steal' ? CFG.STEAL_HOLD_MS : 800;
      this._drawHold(this.holdMs / need);
      if (this.holdMs >= need) {
        this._clearHold();
        if (hold === 'steal') s.steal.grab(this, holdTarget);
        else s.rebirth.openConfirm();
      }
    } else {
      this._clearHold();
    }
  }

  _drawHold(f) {
    this.holdArc.clear();
    this.holdArc.lineStyle(6, 0xffee58, 1);
    this.holdArc.beginPath();
    this.holdArc.arc(this.x, this.y - 46, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, f));
    this.holdArc.strokePath();
    if (Math.floor(f * 8) !== this._lastTick) { this._lastTick = Math.floor(f * 8); AudioSys.sfx('tick'); }
  }

  _clearHold() {
    this.holdKind = null; this.holdTarget = null; this.holdMs = 0;
    this.holdArc.clear();
  }

  _doBuy(cr) {
    const s = this.scene;
    const res = s.creatures.purchase(cr, 'player');
    if (res === 'cash') {
      AudioSys.sfx('denied');
      s.fx.floatText(this.x, this.y - 70, 'Need $' + cr.def.price + '!', '#ff8a80');
    } else if (res === 'full') {
      AudioSys.sfx('denied');
      s.fx.floatText(this.x, this.y - 70, 'BASE FULL!', '#ff8a80');
    }
  }

  _doSlap(time) {
    this.slapReadyAt = time + this.slapCd();
    this.scene.fx.squash(this.sprite, 0.3);
    this.scene.steal.playerSlap();
  }
}
window.PlayerController = PlayerController;
