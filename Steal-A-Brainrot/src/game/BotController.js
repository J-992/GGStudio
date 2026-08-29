// AI rivals. Each bot runs a small state machine (idle/shop/raid/flee/chase)
// driven by four personality dials: agg (raiding), greed (buying), def
// (locking), risk (how close to danger it will operate). Bots ignore physics
// and walk straight at their target; bases are open on every side, so that is
// also what a player does.
class BotController {
  constructor(scene, cfg) {
    this.scene = scene;
    this.id = cfg.id;
    this.name = cfg.name;
    this.p = cfg;
    this.carrying = null;
    this.stunnedUntil = 0;
    this.knockVx = 0; this.knockVy = 0;

    this.state = 'idle';
    this.waypoints = [];
    this.shopTarget = null;
    this.raidTarget = null;      // creature
    this.chaseTarget = null;     // actor
    this.grabAt = 0;
    this.chaseUntil = 0;
    this.thinkAt = 1000 + Math.random() * 1500;
    this.raidPlayerCdUntil = 15000 + Math.random() * 20000;

    const home = scene.bases.entranceInside(this.id);
    this.sprite = scene.add.image(home.x, home.y, 'tex_' + this.id);
    this.baseScale = TextureFactory.scaleFor(scene, 'tex_' + this.id, CFG.CHARACTER_H) * CFG.BOT_SCALE;
    this.sprite.setScale(this.baseScale);
    // rivals sit back visually: smaller, dimmer, and labelled as CPU
    this.sprite.setTint(0xbdbdbd);
    this.shadow = scene.add.image(home.x, home.y + 32, 'shadow').setDepth(2).setScale(1.0).setAlpha(0.8);
    this.nameText = scene.add.text(home.x, home.y - 52, this.name + '  (CPU)', {
      fontFamily: 'Arial', fontSize: '12px', color: '#e0e0e0',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(925).setAlpha(0.8);
    this.stunFx = scene.fx.makeStunFx(scene);
    this._bobT = Math.random() * 10;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  spin() {
    this.scene.tweens.add({ targets: this.sprite, angle: 360, duration: 500,
      onComplete: () => this.sprite.setAngle(0) });
  }

  speed() {
    let v = CFG.BOT_SPEED * (0.92 + 0.12 * this.p.risk);
    if (this.carrying) v *= CFG.CARRY_SLOW;
    if (this.state === 'chase') v *= CFG.BOT_CHASE_MULT;   // owners are furious
    if (this.scene.eventMgr && this.scene.eventMgr.active === 'tiny') v *= 1.45;
    return v;
  }

  // ---------- reactions ----------
  onRobbed(thief) {
    if (this.carrying) return;                   // busy with its own crime
    this.state = 'chase';
    this.chaseTarget = thief;
    this.chaseUntil = this.scene.time.now + 9000;
    this.waypoints = [];
  }

  onRareSpawn(cr) {
    if (this.carrying || this.state === 'chase') return;
    if (Math.random() < 0.35 + this.p.greed * 0.5) {
      this.state = 'shop';
      this.shopTarget = cr;
      this.waypoints = [];
    }
  }

  // ---------- brain ----------
  think(time) {
    const s = this.scene;
    this.thinkAt = time + 700 + Math.random() * 700;

    // lock the base sometimes (never with an intruder inside — no free jails,
    // and never while the tutorial is telling the player to rob somebody)
    if (!(s.tutorial && s.tutorial.blocksBotLocks()) &&
        Math.random() < this.p.def * 0.12 && !s.bases.isLocked(this.id) &&
        s.creatures.creaturesOf(this.id).length > 0 && !this._intruderInside()) {
      s.bases.lock(this.id, CFG.BOT_LOCK_DUR_MS);
    }

    // shopping: most affordable-but-best creature on the belt
    const cash = s.economy.cash[this.id];
    let buy = null;
    for (const cr of s.creatures.onBelt()) {
      if (cr.def.price > cash || cr.x < 40) continue;
      if (!buy || RARITIES[cr.def.rarity].tier > RARITIES[buy.def.rarity].tier) buy = cr;
    }
    const wantBuy = buy && Math.random() < 0.35 + this.p.greed * 0.55 &&
      s.bases.freeSlotIndex(this.id) !== -1;

    // raiding: pick the juiciest stealable creature in an unlocked rival base
    let raid = null;
    if (Math.random() < this.p.agg * 0.5 && s.bases.freeSlotIndex(this.id) !== -1) {
      let bestVal = 0;
      for (const cr of s.creatures.list) {
        if (cr.state !== 'pedestal' || cr.owner === this.id) continue;
        if (s.bases.isLocked(cr.owner)) continue;
        if (cr.owner === 'player') {
          if (time < this.raidPlayerCdUntil) continue;
          if (!SaveSys.data.tutorialDone) continue;   // no revenge during the tutorial
        }
        // risk check: is the owner near its own base?
        const owner = cr.owner === 'player' ? s.player : s.botById(cr.owner);
        const ownerHome = owner && s.bases.contains(cr.owner, owner.x, owner.y);
        if (ownerHome && Math.random() > this.p.risk) continue;
        const val = cr.income * (this.id === 'bot4' ? RARITIES[cr.def.rarity].tier + 1 : 1);
        if (val > bestVal) { bestVal = val; raid = cr; }
      }
    }

    if (wantBuy && (!raid || Math.random() < 0.5)) {
      this.state = 'shop';
      this.shopTarget = buy;
      this.waypoints = [];
    } else if (raid) {
      this.state = 'raid';
      this.raidTarget = raid;
      this.grabAt = 0;
      this.waypoints = this._routeTo(raid.x, raid.y);
      // don't gang up on the player: each bot waits a while between attempts
      if (raid.owner === 'player') {
        this.raidPlayerCdUntil = time + 30000 + (1 - this.p.agg) * 30000 + Math.random() * 15000;
      }
    } else {
      // wander near own base
      const r = s.bases.rect(this.id);
      const wx = r.x + 30 + Math.random() * (r.width - 60);
      const wy = r.y + 40 + Math.random() * (r.height - 60);
      this.state = 'idle';
      this.waypoints = this._routeTo(wx, wy);
    }
  }

  _intruderInside() {
    const s = this.scene;
    const actors = [s.player].concat(s.bots.filter((b) => b !== this));
    return actors.some((a) => s.bases.contains(this.id, a.x, a.y));
  }

  // Bases are open on every side, so there is no door to route through any
  // more -- a bot just walks at what it wants.
  _routeTo(tx, ty) {
    return [{ x: tx, y: ty }];
  }

  // ---------- per-frame ----------
  update(time, dtSec) {
    const s = this.scene;
    const tiny = s.eventMgr && s.eventMgr.active === 'tiny';
    this.sprite.setScale(this.baseScale * (tiny ? 0.62 : 1));

    if (time < this.stunnedUntil) {
      this.sprite.x += this.knockVx * dtSec;
      this.sprite.y += this.knockVy * dtSec;
      this.knockVx *= 0.92; this.knockVy *= 0.92;
      this.sprite.setTint(0x9e9e9e);
      this.sprite.setAngle(Math.sin(time / 60) * 14);
      this._syncAttachments(tiny);
      s.fx.updateStunFx(this.stunFx, this, time, this.y - (tiny ? 36 : 52));
      return;
    }
    this.sprite.setTint(0xbdbdbd);
    s.fx.updateStunFx(this.stunFx, this, time, this.y - (tiny ? 36 : 52));

    if (this.carrying && this.state !== 'flee') {
      this.state = 'flee';
      this.waypoints = this._routeToHomeCenter();
    }

    switch (this.state) {
      case 'shop': this._updateShop(time, dtSec); break;
      case 'raid': this._updateRaid(time, dtSec); break;
      case 'chase': this._updateChase(time, dtSec); break;
      case 'flee': this._followWaypoints(dtSec); break;
      default:
        this._followWaypoints(dtSec);
        if (time > this.thinkAt) this.think(time);
    }
    this._syncAttachments(tiny);
  }

  _routeToHomeCenter() {
    const b = CFG.BASES[this.id];
    return this._routeTo(b.x, b.y + 10);
  }

  _updateShop(time, dtSec) {
    const cr = this.shopTarget;
    const s = this.scene;
    if (!cr || cr.state !== 'belt' || cr.x > CFG.W - 30 ||
        !s.economy.canAfford(this.id, cr.def.price)) {
      this.state = 'idle'; this.shopTarget = null; this.think(time);
      return;
    }
    // belt keeps moving: track the creature directly (open ground, no walls)
    const arrived = this._moveToward(cr.x, cr.y + 26, dtSec);
    if (arrived) {
      const res = s.creatures.purchase(cr, this.id);
      this.shopTarget = null;
      this.state = 'idle';
      if (res && res.def) s.fx.floatText(this.x, this.y - 60, this.name + ' bought ' + res.def.name, '#e0e0e0', 13);
    }
  }

  _updateRaid(time, dtSec) {
    const s = this.scene;
    const cr = this.raidTarget;
    if (!cr || cr.state !== 'pedestal' || s.bases.isLocked(cr.owner) || this.carrying) {
      if (!this.carrying) { this.state = 'idle'; this.raidTarget = null; }
      return;
    }
    if (this.waypoints.length > 0) {
      this._followWaypoints(dtSec);
      return;
    }
    const d = Phaser.Math.Distance.Between(this.x, this.y, cr.x, cr.y - 10);
    if (d > 46) { this._moveToward(cr.x, cr.y - 10, dtSec); return; }
    // in position: brief "grabbing" pause, then snatch
    if (!this.grabAt) { this.grabAt = time + 450 + (1 - this.p.risk) * 400; return; }
    if (time >= this.grabAt) {
      if (s.steal.grab(this, cr)) {
        this.state = 'flee';
        this.waypoints = this._routeToHomeCenter();
      } else {
        this.state = 'idle';
      }
      this.raidTarget = null;
      this.grabAt = 0;
    }
  }

  _updateChase(time, dtSec) {
    const t = this.chaseTarget;
    const stillThief = t && t.carrying && t.carrying.owner === this.id;
    if (!stillThief || time > this.chaseUntil) {
      this.state = 'idle';
      this.chaseTarget = null;
      this.waypoints = this._routeToHomeCenter();
      return;
    }
    this._moveToward(t.x, t.y, dtSec);   // catching is handled by StealSystem
  }

  _followWaypoints(dtSec) {
    if (this.waypoints.length === 0) return;
    const wp = this.waypoints[0];
    if (this._moveToward(wp.x, wp.y, dtSec)) this.waypoints.shift();
  }

  _moveToward(tx, ty, dtSec) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) return true;
    const v = this.speed() * dtSec;
    this.sprite.x += (dx / d) * Math.min(v, d);
    this.sprite.y += (dy / d) * Math.min(v, d);
    this._bobT += dtSec * 10;
    this.sprite.setAngle(Math.sin(this._bobT) * 5);
    return d < 12;
  }

  _syncAttachments(tiny) {
    this.shadow.setPosition(this.x, this.y + 32);
    this.sprite.setDepth(this.y + 30);
    this.nameText.setPosition(this.x, this.y - (tiny ? 36 : 52));
  }
}
window.BotController = BotController;
