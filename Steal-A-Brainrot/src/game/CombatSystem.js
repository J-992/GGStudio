// Evil brainrots march right-to-left down the lanes; planted brainrots hold
// them per their role. All motion is dt-driven from GameScene.update, where
// the dt is already scaled by Effects.timeScale() -- so hit-stop and slow-mo
// freeze combat without touching tweens or UI.
//
// An enemy that reaches the moped strip triggers that lane's moped (one lane
// wipe each); with the moped spent, the next breach is the level.
class CombatSystem {
  constructor(scene, lawn, economy, energy) {
    this.scene = scene;
    this.lawn = lawn;
    this.economy = economy;
    this.energy = energy;
    this.enemies = [];
    this.projectiles = [];       // straight lane shots
    this.homing = [];            // sniper blades
    this._pending = [];          // scheduled spawns
    this._clock = 0;
    this._laneDeal = 0;
    this._hitSfxAt = 0;

    this.onDefeat = null;        // (lane) => void -- breach with no moped left
    this.onKill = null;
    this.onBossDown = null;
  }

  reset() {
    this.enemies.forEach((e) => e.root.destroy());
    this.projectiles.forEach((p) => p.img.destroy());
    this.homing.forEach((p) => p.img.destroy());
    this.enemies = [];
    this.projectiles = [];
    this.homing = [];
    this._pending = [];
    this._clock = 0;
  }

  startWave(spawnGroups, hpMult) {
    const base = this._clock + 400;
    spawnGroups.forEach((g) => {
      for (let k = 0; k < g.n; k++) {
        this._pending.push({
          atMs: base + k * g.everyMs + Math.random() * 400,
          enemyId: g.enemy, lane: g.lane, hpMult,
        });
      }
    });
  }

  spawnBoss(bossId, hpMult) {
    const def = BOSSES[bossId];
    this._spawn(def, bossId, hpMult, Math.floor(CFG.GRID.lanes / 2));
    AudioSys.sfx('boss');
    this.scene.fx.shake(0.01, 400);
  }

  allDead() { return this.enemies.length === 0 && this._pending.length === 0; }
  aliveCount() { return this.enemies.length; }
  hasBoss() { return this.enemies.some((e) => e.isBoss); }

  // ------------------------------------------------------------- update

  update(dtMs) {
    this._clock += dtMs;
    const dtSec = dtMs / 1000;

    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      if (p.atMs <= this._clock) {
        this._pending.splice(i, 1);
        const def = ENEMIES[p.enemyId] || BOSSES[p.enemyId];
        if (def) this._spawn(def, p.enemyId, p.hpMult, p.lane);
      }
    }

    this._updateEnemies(dtMs, dtSec);
    this._updateUnits(dtMs);
    this._updateProjectiles(dtSec);
    this._updateMopeds(dtSec);
  }

  _spawn(def, id, hpMult, lane) {
    const lanes = this.lawn.activeLanes;
    if (lane === undefined || lane === null || !lanes.includes(lane)) {
      lane = lanes[this._laneDeal % lanes.length];
      this._laneDeal++;
    }
    const f = LAYOUT.field;
    const x = f.spawnX + Math.random() * 30;
    const isBoss = !!def.boss;
    const h = Math.round(LAYOUT.enemyH * (def.scale || 1));

    const root = this.scene.add.container(x, f.laneY(lane)).setDepth(300 + lane * 10);
    const shadow = this.scene.add.image(0, 2, 'shadow').setAlpha(0.5);
    shadow.setScale(h / 60);
    const img = this.scene.add.image(0, 0, def.art).setOrigin(0.5, 1);
    img.setScale(h / img.height);
    img.setFlipX(true);                     // they walk left
    const barW = Math.max(40, h * 0.7);
    const hpBg = this.scene.add.rectangle(0, -h - 12, barW, 7, 0x263238).setOrigin(0.5).setVisible(isBoss);
    const hpFg = this.scene.add.rectangle(-barW / 2, -h - 12, barW, 5, isBoss ? 0xff1744 : 0xb388ff).setOrigin(0, 0.5).setVisible(isBoss);
    root.add([shadow, img, hpBg, hpFg]);

    const e = {
      id, def, isBoss, root, img, hpBg, hpFg, barW,
      maxHp: def.hp * hpMult, hp: def.hp * hpMult,
      coins: def.coins, x, lane, h,
      speed: def.speed, wobbleT: Math.random() * 10,
      knock: 0, slowUntil: 0, biteT: 0, dead: false,
    };
    this.enemies.push(e);

    if (isBoss || def.mini) {
      this.scene.fx.banner(def.name + '!', isBoss ? '#ff1744' : '#b388ff');
      root.setDepth(500);
      root.setScale(0.2);
      this.scene.tweens.add({ targets: root, scale: 1, duration: 450, ease: 'Back.easeOut' });
      if (isBoss) AudioSys.setMusic('boss');
    }
    return e;
  }

  // --------------------------------------------------------- enemy update

  _updateEnemies(dtMs, dtSec) {
    const f = LAYOUT.field;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;

      const slowed = this._clock < e.slowUntil;
      const rate = slowed ? CFG.COMBAT.slowFactor : 1;
      // Monsters wear their own colours; only the slow debuff tints them.
      if (slowed) e.img.setTint(0x64b5f6); else e.img.clearTint();

      // what's in front of the mouth?
      const mouthX = e.x - e.h * 0.28;
      const col = f.colAt(mouthX);
      const unit = col >= 0 && col < CFG.GRID.cols ? this.lawn.unitAt(e.lane, col) : null;

      if (unit && unit.def.role === 'mine' && unit.armed) {
        this._detonate(unit, e);
        continue;
      }

      if (unit && e.knock <= 0.5) {
        // chew
        e.biteT -= dtMs * rate;
        if (e.biteT <= 0) {
          e.biteT = CFG.COMBAT.biteMs;
          this.lawn.damageUnit(unit, e.def.bite);
          this.scene.tweens.add({ targets: e.img, x: -7, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
          AudioSys.sfx('hit');
        }
      } else {
        // walk (knockback shoves right first)
        if (e.knock > 0.5) {
          const shove = Math.min(e.knock, 340 * dtSec);
          e.x += shove;
          e.knock -= shove;
        } else {
          e.x -= e.speed * rate * LAYOUT.combatScale * dtSec;
        }
        e.x = Math.min(e.x, f.spawnX + 60);
        e.biteT = 0;
      }

      e.wobbleT += dtSec * (e.speed / 9) * rate;
      e.root.x = e.x;
      e.root.y = f.laneY(e.lane) + Math.sin(e.wobbleT) * 2;
      e.img.setAngle(Math.sin(e.wobbleT) * 4);

      // the moped strip
      if (e.x - e.h * 0.28 <= f.gridX - 6) {
        const m = this.lawn.mopedFor(e.lane);
        if (m) this._rideMoped(m);
        else if (e.x <= f.x + 10) {
          this._despawn(e);
          if (this.onDefeat) this.onDefeat(e.lane);
        }
      }
    }
  }

  // ---------------------------------------------------------------- units

  _updateUnits(dtMs) {
    for (const u of this.lawn.units()) {
      const def = u.def;

      if (def.role === 'producer') {
        u.produceT -= dtMs;
        if (u.produceT <= 0) {
          u.produceT = def.produceMs;
          this.energy.spawnFrom(u.root.x, u.root.y - LAYOUT.unitH * 0.5);
          this.scene.fx.squash(u.img, 0.2);
          AudioSys.sfx('pull');
        }
        continue;
      }
      if (def.role === 'wall') continue;
      if (def.role === 'mine') {
        if (!u.armed) {
          u.armT -= dtMs;
          if (u.armT <= 0) this.lawn.armMine(u);
        }
        continue;
      }

      u.cdMs -= dtMs;
      if (u.cdMs > 0) continue;
      if (this._tryAttack(u, def)) u.cdMs = 1000 / def.attackSpeed;
      else u.cdMs = 90;   // nothing in range; check again shortly
    }
  }

  _tryAttack(u, def) {
    const f = LAYOUT.field;
    const ux = u.root.x, uy = u.root.y;
    const alive = this.enemies.filter((e) => !e.dead);
    if (alive.length === 0) return false;

    switch (def.role) {
      case 'shooter': {
        if (!alive.some((e) => e.lane === u.lane && e.x > ux - f.colW * 0.4 && e.x < f.spawnX + 40)) return false;
        const n = def.burst || 1;
        for (let k = 0; k < n; k++) {
          this.scene.time.delayedCall(k * 130, () => {
            if (u.dead) return;
            this.projectiles.push({
              img: this.scene.add.image(ux + f.colW * 0.3, uy - LAYOUT.unitH * 0.6, def.projectile).setDepth(600),
              lane: u.lane, dmg: def.damage, def, hit: new Set(),
            });
            AudioSys.sfx('shoot');
            this._recoil(u);
          });
        }
        return true;
      }
      case 'melee': {
        const reach = (def.reachCells || 1.5) * f.colW;
        const inReach = alive.filter((e) => e.lane === u.lane && e.x > ux - f.colW * 0.3 && e.x - ux < reach);
        if (inReach.length === 0) return false;
        inReach.sort((a, b) => a.x - b.x);
        this._hop(u);
        this.scene.time.delayedCall(90, () => {
          if (u.dead) return;
          const lead = inReach[0];
          const targets = def.aoeCells
            ? inReach.filter((e) => Math.abs(e.x - lead.x) <= def.aoeCells * f.colW)
            : [lead];
          targets.forEach((t) => { if (!t.dead) this.dealDamage(t, def.damage, def); });
          AudioSys.sfx('boom');
          this.scene.fx.ringPulse(lead.x, uy - 20, def.color, 1.4);
          if (def.damage >= 100) this.scene.fx.shake(0.004, 120);
        });
        return true;
      }
      case 'lobber': {
        let target = null;
        if (def.anywhere) {
          // densest pack on the whole lawn
          let bestN = 0;
          for (const e of alive) {
            const n = alive.filter((o) => Math.abs(o.x - e.x) <= def.radius && Math.abs(o.lane - e.lane) <= 1).length;
            if (n > bestN) { bestN = n; target = e; }
          }
        } else {
          const inLane = alive.filter((e) => e.lane === u.lane && e.x > ux + f.colW * 0.3);
          if (inLane.length) target = inLane.reduce((a, b) => (a.x < b.x ? a : b));
        }
        if (!target) return false;
        this._lob(u, def, target);
        return true;
      }
      case 'ring': {
        const near = alive.filter((e) => {
          const dy = e.root.y - uy, dx = e.x - ux;
          return dx * dx + dy * dy <= def.radius * def.radius;
        });
        if (near.length === 0) return false;
        this._spinAnim(u);
        this.scene.fx.ringPulse(ux, uy - LAYOUT.unitH * 0.4, def.color, def.radius / 46);
        near.forEach((e) => this.dealDamage(e, def.damage, def));
        AudioSys.sfx('boom');
        return true;
      }
      case 'sniper': {
        let best = alive[0];
        for (const e of alive) if (e.hp > best.hp) best = e;
        this.homing.push({
          img: this.scene.add.image(ux, uy - LAYOUT.unitH * 0.6, 'pr_blade').setDepth(600),
          target: best, dmg: def.damage, def,
        });
        AudioSys.sfx('shoot');
        this._recoil(u);
        return true;
      }
    }
    return false;
  }

  _lob(u, def, target) {
    const f = LAYOUT.field;
    const img = this.scene.add.image(u.root.x, u.root.y - LAYOUT.unitH * 0.6, 'pr_bomb').setDepth(650);
    img.setTint(def.slow ? 0x81d4fa : 0xffffff);
    const drop = { x: target.x - f.colW * 0.3, y: target.root.y, lane: target.lane };
    AudioSys.sfx('shoot');
    this._recoil(u);
    this.scene.tweens.add({
      targets: img, x: drop.x, y: u.root.y - f.laneH * 2.2, duration: 340, ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: img, y: drop.y, duration: 240, ease: 'Quad.easeIn',
          onComplete: () => {
            img.destroy();
            AudioSys.sfx('boom');
            this.scene.fx.ringPulse(drop.x, drop.y - 10, def.slow ? 0x81d4fa : 0xff7043, def.radius / 40);
            this.scene.fx.shake(0.003, 110);
            this.enemies.forEach((e) => {
              if (e.dead) return;
              const dx = e.x - drop.x, dy = e.root.y - drop.y;
              if (dx * dx + dy * dy <= def.radius * def.radius) this.dealDamage(e, def.damage, def);
            });
          },
        });
      },
    });
  }

  _detonate(mine, tripper) {
    if (mine.dead) return;
    const x = mine.root.x, y = mine.root.y;
    this.lawn.grid[mine.lane][mine.col] = null;
    mine.dead = true;
    mine.root.destroy();
    AudioSys.sfx('boom');
    this.scene.fx.flash(0xffe082);
    this.scene.fx.ringPulse(x, y - 20, 0xff7043, mine.def.radius / 36);
    this.scene.fx.shake(0.008, 200);
    this.scene.fx.hitStop(CFG.COMBAT.hitStopMs);
    this.enemies.forEach((e) => {
      if (e.dead) return;
      const dx = e.x - x, dy = e.root.y - y;
      if (dx * dx + dy * dy <= mine.def.radius * mine.def.radius) {
        this.dealDamage(e, mine.def.damage, mine.def);
      }
    });
  }

  // ---------------------------------------------------------- projectiles

  _updateProjectiles(dtSec) {
    const f = LAYOUT.field;
    const step = CFG.COMBAT.projectileSpeed * LAYOUT.combatScale * dtSec;

    // straight lane shots
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.img.x += step;
      if (p.img.x > f.spawnX + 40) { p.img.destroy(); this.projectiles.splice(i, 1); continue; }
      let consumed = false;
      for (const e of this.enemies) {
        if (e.dead || e.lane !== p.lane || p.hit.has(e)) continue;
        if (Math.abs(e.x - e.h * 0.2 - p.img.x) < Math.max(14, e.h * 0.28)) {
          p.hit.add(e);
          this.dealDamage(e, p.dmg, p.def);
          if (p.def.slow) e.slowUntil = this._clock + CFG.COMBAT.slowMs;
          if (p.def.knockback) e.knock += p.def.knockback;
          if (!p.def.pierce) { consumed = true; break; }
        }
      }
      if (consumed) { p.img.destroy(); this.projectiles.splice(i, 1); }
    }

    // sniper blades home in
    for (let i = this.homing.length - 1; i >= 0; i--) {
      const p = this.homing[i];
      const t = p.target;
      if (t.dead) {
        p.img.x += 420 * dtSec;
        if (p.img.x > f.spawnX + 40) { p.img.destroy(); this.homing.splice(i, 1); }
        continue;
      }
      const tx = t.x, ty = t.root.y - t.h * 0.45;
      const dx = tx - p.img.x, dy = ty - p.img.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const s = 700 * LAYOUT.combatScale * dtSec;
      if (d <= s + 8) {
        p.img.destroy(); this.homing.splice(i, 1);
        this.dealDamage(t, p.dmg, p.def);
        continue;
      }
      p.img.x += (dx / (d || 1)) * s;
      p.img.y += (dy / (d || 1)) * s;
      p.img.rotation = Math.atan2(dy, dx);
    }
  }

  // --------------------------------------------------------------- mopeds

  _rideMoped(m) {
    m.riding = true;
    m.used = true;
    AudioSys.sfx('wave');
    this.scene.fx.shake(0.004, 150);
    this.scene.fx.floatText(m.img.x, m.img.y - 40, 'MOPED!', '#ffd54f', 22);
  }

  _updateMopeds(dtSec) {
    const f = LAYOUT.field;
    for (const m of this.lawn.mopeds) {
      if (!m.riding) continue;
      m.x += 950 * LAYOUT.combatScale * dtSec;
      m.img.setVisible(true).setPosition(m.x, f.laneY(m.lane) - 8).setAngle(Math.sin(m.x / 14) * 5);
      for (const e of this.enemies) {
        if (!e.dead && e.lane === m.lane && e.x < m.x + 34) this._kill(e, null, true);
      }
      if (m.x > f.spawnX + 60) {
        m.riding = false;
        m.img.setVisible(false);
      }
    }
  }

  // --------------------------------------------------------------- damage

  dealDamage(e, dmg, def) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hpBg.setVisible(true);
    e.hpFg.setVisible(true);
    e.hpFg.width = Math.max(0, e.barW * (e.hp / e.maxHp));

    const big = dmg >= e.maxHp * 0.5;
    this.scene.fx.floatText(e.x, e.root.y - e.h - 18, String(Math.round(dmg)),
      big ? '#ffca28' : '#ffffff', big ? 24 : 16);
    this.scene.fx.squash(e.img, 0.18);

    const now = Date.now();
    if (now - this._hitSfxAt > 70) { AudioSys.sfx('hit'); this._hitSfxAt = now; }

    if (e.hp <= 0) this._kill(e, def);
  }

  _kill(e, killerDef, byMoped) {
    if (e.dead) return;
    e.dead = true;
    SaveSys.addStat('kills');
    const x = e.x, y = e.root.y;

    this.economy.earnCoins(e.coins);
    const target = this.scene.hud ? this.scene.hud.coinTarget() : { x: 40, y: 40 };
    this.scene.fx.coinBurst(x, y - e.h * 0.4, Math.min(6, 2 + Math.floor(e.coins / 8)));
    this.scene.fx.coinFly(x, y - e.h * 0.4, target.x, target.y, () => {
      if (this.scene.hud) this.scene.hud.bumpCoins();
    });
    AudioSys.sfx('kill');

    if (killerDef && (killerDef.role === 'mine' || killerDef.role === 'melee') && killerDef.damage >= 100) {
      this.scene.fx.hitStop(CFG.COMBAT.hitStopMs);
    }

    this.scene.tweens.add({
      targets: e.root, scaleX: 1.25, scaleY: 0.1, alpha: 0, y: e.root.y + 6,
      duration: byMoped ? 120 : 190, ease: 'Quad.easeIn',
      onComplete: () => this._despawn(e),
    });

    if (e.isBoss) {
      this.scene.fx.slowMo(0.22, CFG.COMBAT.bossSlowMoMs);
      this.scene.fx.shake(0.012, 500);
      this.scene.fx.confetti(x, y - e.h * 0.5, 40);
      Poki.happyTime(1);
      if (this.onBossDown) this.onBossDown(e);
    } else if (e.def.mini) {
      this.scene.fx.slowMo(0.35, 500);
      this.scene.fx.confetti(x, y - e.h * 0.5, 20);
      Poki.happyTime(0.7);
    }
    if (this.onKill) this.onKill(e);
  }

  _despawn(e) {
    e.dead = true;
    e.root.destroy();
    const i = this.enemies.indexOf(e);
    if (i !== -1) this.enemies.splice(i, 1);
  }

  // rewarded revive: wipe the lawn clean of attackers, keep the plants
  wipeEnemies() {
    [...this.enemies].forEach((e) => {
      this.scene.fx.sparks(e.x, e.root.y - e.h * 0.4, 0xce93d8, 8);
      this._despawn(e);
    });
    this.scene.fx.flash(0xce93d8);
  }

  // ---- little unit animations ----

  _recoil(u) {
    this.scene.tweens.add({ targets: u.img, x: -5, duration: 70, yoyo: true });
  }

  _hop(u) {
    this.scene.tweens.add({ targets: u.img, y: -14, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }

  _spinAnim(u) {
    this.scene.tweens.add({ targets: u.img, angle: 360, duration: 300, ease: 'Quad.easeOut', onComplete: () => u.img.setAngle(0) });
  }

  relayout() {
    const f = LAYOUT.field;
    this.enemies.forEach((e) => {
      e.x = Math.min(e.x, f.spawnX);
      e.root.y = f.laneY(e.lane);
    });
  }
}
window.CombatSystem = CombatSystem;
