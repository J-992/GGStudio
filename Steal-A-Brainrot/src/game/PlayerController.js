// The player: physics-driven movement, contextual interaction (buy / steal /
// sell / slap), hold progress drawn on the thing being acted on, and the
// floating key hint.
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
    this.holdKind = null;      // 'steal' | 'sell'
    this.holdTarget = null;

    const spawn = scene.bases.entranceOutside('player');
    this.sprite = scene.physics.add.image(spawn.x, spawn.y - 10, 'player');
    // The collider is authored against the 64x72 placeholder; a rendered
    // sprite comes in bigger, so express it as a fraction of the texture and
    // let the sprite's own scale bring it back to the same world size.
    this.baseScale = TextureFactory.scaleFor(scene, 'player', CFG.CHARACTER_H) * CFG.PLAYER_SCALE;
    this.sprite.setScale(this.baseScale);
    const k = this.sprite.height / CFG.CHARACTER_H;
    this.sprite.body.setCircle(20 * k, 12 * k, 30 * k);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(spawn.y);

    // ---- "this one is you" kit ----
    // A bright ring on the ground and a bobbing marker overhead, both in the
    // player colour, so the player reads instantly in a crowd of six.
    this.ring = scene.add.image(spawn.x, spawn.y, 'ring')
      .setDepth(3).setTint(CFG.PLAYER_TINT).setAlpha(0.75).setScale(1.35);
    this.marker = scene.add.image(spawn.x, spawn.y - 74, 'arrow')
      .setDepth(931).setTint(CFG.PLAYER_TINT).setScale(1.15);
    this.shadow = scene.add.image(spawn.x, spawn.y, 'shadow').setDepth(2).setScale(1.35);
    this.hint = scene.add.text(spawn.x, spawn.y - 66, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(930);
    this.holdArc = scene.add.graphics().setDepth(935);
    // One reused reticle. Without it you cannot tell which creature a hold is
    // about to take -- the arc used to sit over the player's own head.
    this.reticle = scene.add.image(-200, -200, 'ring').setDepth(934).setVisible(false);
    this.targetLabel = scene.add.text(-200, -200, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(936).setVisible(false);
    this.stunFx = scene.fx.makeStunFx(scene);
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

    // A lesson is on screen: freeze, so nothing happens behind the popup
    if (s.hud.popupOpen) {
      body.setVelocity(0, 0);
      this.hint.setText('');
      this._showTarget(null);
      this._clearHold();
      inp.setActionLabel('');
      return;
    }

    const stunned = time < this.stunnedUntil;
    if (stunned) {
      body.setVelocity(this.knockVx, this.knockVy);
      this.knockVx *= 0.92; this.knockVy *= 0.92;
      // greyed out and wobbling: you can see you have been taken out of play
      this.sprite.setTint(0x9e9e9e);
      this.sprite.setAngle(Math.sin(time / 60) * 14);
    } else {
      this.sprite.clearTint();
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
    this.marker.setPosition(this.x, this.y - (tiny ? 52 : 74) + Math.sin(time / 220) * 4);
    this.ring.setPosition(this.x, this.y + 34);
    this.ring.setScale(1.35 + Math.sin(time / 260) * 0.12);
    s.fx.updateStunFx(this.stunFx, this, time, this.y - (tiny ? 46 : 66));

    // stunned means stunned: no prompts, no acting
    if (stunned) {
      this.hint.setText('');
      this._showTarget(null);
      this._clearHold();
      inp.setActionLabel('');
      return;
    }
    this._interact(time, dtSec);
    this.hint.setPosition(this.x, this.y - (tiny ? 46 : 66));
  }

  // Every in-range candidate comes back with its distance, because buy and
  // steal overlap at the left/right map edges where the belt passes over a
  // rival base -- there the closer target should win, not a fixed priority.
  _nearest(range, pred) {
    let best = null, bd = range;
    for (const cr of this.scene.creatures.list) {
      if (!pred(cr)) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, cr.x, cr.y - 20);
      if (d < bd) { bd = d; best = cr; }
    }
    return best ? { cr: best, d: bd } : null;
  }

  _nearestBelt() {
    return this._nearest(CFG.BUY_RANGE, (c) => c.state === 'belt');
  }

  // Rival creatures on pedestals, WITHOUT the free-slot check. A full base used
  // to filter every target out through canGrab(), so the prompt just vanished
  // and nothing on screen explained why.
  _nearestStealable() {
    return this._nearest(CFG.STEAL_RANGE,
      (c) => c.state === 'pedestal' && c.owner && c.owner !== 'player');
  }

  // ... and the mirror of it, for selling your own
  _nearestOwn() {
    return this._nearest(CFG.STEAL_RANGE,
      (c) => c.state === 'pedestal' && c.owner === 'player');
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
    // `label` is the roomy world prompt; `btn` is the terse two-line version
    // for the 104px touch button, which a single long line overflows.
    let label = '', btn = '', color = null, hold = null, holdTarget = null, tap = null;
    const HOLD = kb ? 'HOLD [SPACE] ' : 'HOLD: ';

    if (this.carrying) {
      label = 'RUN HOME!'; btn = 'RUN!';
    } else {
      // A bot fleeing with YOUR creature outranks everything: it is the only
      // prompt with a clock on it, and it can fire while you stand next to a
      // rival pedestal deep in someone else's base.
      const thief = this._nearestThief();
      const stealT = this._nearestStealable();
      const own = this._nearestOwn();
      const belt = this._nearestBelt();
      const slapReady = time >= this.slapReadyAt;
      const full = s.bases.freeSlotIndex('player') === -1;

      if (thief && slapReady) {
        label = (kb ? '[SPACE] ' : '') + 'SLAP!'; btn = 'SLAP!';
        tap = () => this._doSlap(time);
      } else if (full && (stealT || belt)) {
        // both ways of acquiring a creature need a free pedestal, so say so
        // once instead of showing a prompt that would silently refuse
        label = 'BASE FULL — SELL ONE'; btn = 'BASE\nFULL';
        color = '#ff8a80';
      } else if (belt && (!stealT || belt.d <= stealT.d)) {
        label = (kb ? '[SPACE] ' : '') + 'BUY ' + HUD.money(belt.cr.def.price);
        btn = 'BUY\n' + HUD.money(belt.cr.def.price);
        tap = () => this._doBuy(belt.cr);
      } else if (stealT) {
        label = HOLD + 'STEAL'; btn = 'HOLD\nSTEAL';
        hold = 'steal'; holdTarget = stealT.cr;
      } else if (own) {
        label = HOLD + 'SELL ' + HUD.money(s.creatures.sellValue(own.cr));
        btn = 'HOLD\nSELL';
        hold = 'sell'; holdTarget = own.cr;
      } else if (this._nearestBot() && slapReady) {
        label = (kb ? '[SPACE] ' : '') + 'SLAP'; btn = 'SLAP';
        tap = () => this._doSlap(time);
      }
    }

    // The prompt lives on the target when there is one, and over the player
    // only when the action has no target (run home, slap).
    this._showTarget(holdTarget, hold, label, color);
    this.hint.setText(holdTarget ? '' : label);
    this.hint.setColor(color || '#ffffff');
    inp.setActionLabel(btn);

    // taps
    if (tap && inp.actionJust) tap();

    // holds
    if (hold && inp.actionHeld) {
      if (this.holdKind !== hold || this.holdTarget !== holdTarget) {
        this.holdKind = hold; this.holdTarget = holdTarget; this.holdMs = 0;
      }
      this.holdMs += dtSec * 1000;
      const need = hold === 'steal' ? CFG.STEAL_HOLD_MS : CFG.SELL_HOLD_MS;
      const ax = holdTarget ? holdTarget.x : this.x;
      const ay = holdTarget ? holdTarget.y - 46 : this.y - 46;
      this._drawHold(this.holdMs / need, ax, ay, hold === 'sell' ? 0x69f0ae : 0xffee58);
      if (this.holdMs >= need) {
        this._clearHold();
        if (hold === 'steal') s.steal.grab(this, holdTarget);
        else s.creatures.sell(holdTarget);
      }
    } else {
      this._clearHold();
    }
  }

  // move the reticle + caption onto the current hold target
  _showTarget(cr, kind, label, color) {
    if (!cr) {
      this.reticle.setVisible(false);
      this.targetLabel.setVisible(false).setText('');
      return;
    }
    const tint = kind === 'sell' ? 0x69f0ae : 0xff5252;
    this.reticle.setVisible(true).setPosition(cr.x, cr.y - 26).setTint(tint)
      .setAlpha(0.55 + Math.sin(this.scene.time.now / 140) * 0.2).setScale(1.25);
    this.targetLabel.setVisible(true).setPosition(cr.x, cr.y - 112)
      .setText(label).setColor(color || (kind === 'sell' ? '#b9f6ca' : '#ff8a80'));
  }

  _drawHold(f, x, y, color) {
    this.holdArc.clear();
    this.holdArc.lineStyle(6, color || 0xffee58, 1);
    this.holdArc.beginPath();
    this.holdArc.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, f));
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
      s.fx.floatText(this.x, this.y - 70, 'NEED ' + HUD.money(cr.def.price), '#ff8a80');
    } else if (res === 'full') {
      AudioSys.sfx('denied');
      s.fx.floatText(this.x, this.y - 70, 'BASE FULL — SELL ONE', '#ff8a80');
    }
  }

  _doSlap(time) {
    this.slapReadyAt = time + this.slapCd();
    this.scene.fx.squash(this.sprite, 0.3);
    this.scene.steal.playerSlap();
  }
}
window.PlayerController = PlayerController;
