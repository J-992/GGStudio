// The heart of the game: grabbing creatures, the chase, getting caught,
// escaping home, and the slap. Works identically for the player and bots —
// an "actor" is anything with { id, x, y, carrying, stunnedUntil }.
class StealSystem {
  constructor(scene) {
    this.scene = scene;
    this._alarms = [];   // { thief, arrow } while the player is being robbed
  }

  // can `thief` grab `cr` right now?
  canGrab(thief, cr) {
    if (thief.carrying || cr.state !== 'pedestal') return false;
    if (cr.owner === thief.id) return false;
    if (this.scene.bases.freeSlotIndex(thief.id) === -1) return false;
    return true;
  }

  grab(thief, cr) {
    if (!this.canGrab(thief, cr)) return false;
    const s = this.scene;
    s.creatures.startCarry(cr, thief);
    cr.grabbedAt = s.time.now;
    thief.carrying = cr;
    AudioSys.sfx('grab');
    s.fx.ringPulse(cr.x, cr.y - 20, 0xff5252, 1.2);

    const victim = cr.owner;
    if (victim === 'player') {
      AudioSys.sfx('alarm');
      s.fx.banner('⚠ THIEF!', '#ff5252', thief.name);
      s.fx.shake(0.005, 200);
      SaveSys.addStat('robbed');
      s.tutorial.onPlayerRobbed();
      const arrow = s.add.image(thief.x, thief.y - 70, 'arrow').setTint(0xff5252).setDepth(940);
      s.tweens.add({ targets: arrow, y: '-=10', duration: 300, yoyo: true, repeat: -1 });
      this._alarms.push({ thief, arrow });
    } else {
      const owner = s.botById(victim);
      if (owner) owner.onRobbed(thief);
      if (thief.id === 'player') AudioSys.sfx('alarm');
    }
    return true;
  }

  update(time) {
    const s = this.scene;
    const actors = [s.player].concat(s.bots);

    for (const a of actors) {
      const cr = a.carrying;
      if (!cr) continue;

      // escaped home?
      if (s.bases.contains(a.id, a.x, a.y)) { this._success(a, cr); continue; }

      // caught by the owner? (bots catch by touch; the player catches with SLAP)
      const victim = cr.owner;
      if (victim !== 'player') {
        const owner = s.botById(victim);
        // the grace window stops an owner who was already standing on its own
        // pedestal from re-catching on the frame after the grab
        if (owner && time > owner.stunnedUntil && time > cr.grabbedAt + CFG.CATCH_GRACE_MS &&
            Phaser.Math.Distance.Between(owner.x, owner.y, a.x, a.y) < CFG.CATCH_RANGE) {
          this._caught(a, cr, owner);
        }
      }
    }

    // alarm arrows track their thief; clear when the carry ended
    this._alarms = this._alarms.filter((al) => {
      if (!al.thief.carrying || al.thief.carrying.owner !== 'player') {
        al.arrow.destroy();
        return false;
      }
      al.arrow.setPosition(al.thief.x, al.arrow.y < al.thief.y - 60 ? al.arrow.y : al.thief.y - 70);
      al.arrow.x = al.thief.x;
      return true;
    });
  }

  _success(thief, cr) {
    const s = this.scene;
    const victim = cr.owner;
    thief.carrying = null;
    s.creatures.transferTo(cr, thief.id);
    if (thief.id === 'player') {
      SaveSys.addStat('stolen');
      if (SaveSys.data.stats.stolen > SaveSys.data.best.steals) SaveSys.data.best.steals = SaveSys.data.stats.stolen;
      AudioSys.sfx('escape');
      const css = '#' + RARITIES[cr.def.rarity].color.toString(16).padStart(6, '0');
      s.fx.banner('STOLEN!', '#69f0ae', cr.def.name);
      s.fx.confetti(s.player.x, s.player.y - 30, 30);
      s.fx.shake(0.008, 260);
      s.fx.floatText(s.player.x, s.player.y - 70, RARITIES[cr.def.rarity].name + '!', css, 24);
      Poki.happyTime(1);
    } else if (victim === 'player') {
      AudioSys.sfx('caught');
      s.fx.banner('LOST!', '#b0bec5', thief.name + ' took your ' + cr.def.name);
    }
  }

  _caught(thief, cr, catcher) {
    const s = this.scene;
    thief.carrying = null;
    s.creatures.returnHome(cr);
    this.knockback(thief, catcher.x, catcher.y);
    if (thief.id === 'player') {
      AudioSys.sfx('caught');
      s.fx.banner('CAUGHT!', '#ff8a80');
      s.fx.shake(0.009, 280);
    } else {
      AudioSys.sfx('slap');
    }
    s.fx.sparks((thief.x + catcher.x) / 2, thief.y - 30, 0xffee58, 10);
  }

  // The player's defense move. Hits the nearest bot in range: knockback, and
  // if it was carrying anything the loot goes home.
  playerSlap() {
    const s = this.scene;
    const p = s.player;
    let best = null, bd = CFG.SLAP_RANGE;
    for (const b of s.bots) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    AudioSys.sfx('slap');
    s.fx.ringPulse(p.x, p.y - 20, 0xffffff, 1.0);
    if (!best) return false;
    this.knockback(best, p.x, p.y);
    s.fx.sparks(best.x, best.y - 30, 0xffee58, 12);
    s.fx.floatText(best.x, best.y - 60, 'SLAP!', '#ffee58', 24);
    s.fx.shake(0.004, 140);
    if (best.carrying) {
      const cr = best.carrying;
      best.carrying = null;
      s.creatures.returnHome(cr);
      if (cr.owner === 'player') {
        s.fx.banner('SAVED!', '#69f0ae', cr.def.name);
        Poki.happyTime(0.6);
      }
    }
    return true;
  }

  knockback(actor, fromX, fromY) {
    const dx = actor.x - fromX, dy = actor.y - fromY;
    const l = Math.hypot(dx, dy) || 1;
    actor.stunnedUntil = this.scene.time.now + CFG.STUN_MS;
    actor.knockVx = (dx / l) * CFG.KNOCKBACK * 4;
    actor.knockVy = (dy / l) * CFG.KNOCKBACK * 4;
    if (actor.spin) actor.spin();
  }

  // is the player part of any active chase? (drives the chase music)
  playerInChase() {
    const s = this.scene;
    if (s.player.carrying) return true;
    return s.bots.some((b) => b.carrying && b.carrying.owner === 'player');
  }
}
window.StealSystem = StealSystem;
