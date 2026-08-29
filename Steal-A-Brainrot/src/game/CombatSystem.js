// Enemies march right-to-left down three lanes; battlefield units auto-attack
// per their archetype. All motion is dt-driven from GameScene.update, where
// the dt is already scaled by Effects.timeScale() -- so hit-stop and the boss
// slow-mo freeze combat without touching tweens or UI.
class CombatSystem {
  constructor(scene, board, economy) {
    this.scene = scene;
    this.board = board;
    this.economy = economy;
    this.enemies = [];
    this.projectiles = [];
    this._pending = [];     // scheduled spawns: { atMs, enemyId, mult, lane }
    this._clock = 0;
    this._cooldowns = {};   // unit uid -> ms until next attack
    this._laneDeal = 0;     // round-robin lane dealer
    this._hitSfxAt = 0;

    // callbacks wired by GameScene / StageDirector
    this.onLifeLost = null;
    this.onKill = null;
    this.onBossDown = null;
  }

  reset() {
    this.enemies.forEach((e) => e.root.destroy());
    this.projectiles.forEach((p) => p.img.destroy());
    this.enemies = [];
    this.projectiles = [];
    this._pending = [];
    this._clock = 0;
    this._cooldowns = {};
  }

  // Schedule one wave's spawn groups. Groups run in parallel; members of a
  // group arrive everyMs apart. Lanes are dealt round-robin unless pinned.
  startWave(spawnGroups, hpMult, coinMult) {
    const base = this._clock + 400;
    spawnGroups.forEach((g) => {
      for (let k = 0; k < g.n; k++) {
        this._pending.push({
          atMs: base + k * g.everyMs + Math.random() * 240,
          enemyId: g.enemy,
          lane: g.lane,
          hpMult, coinMult,
        });
      }
    });
  }

  spawnBoss(bossId, hpMult, coinMult) {
    this._spawn(BOSSES[bossId], bossId, hpMult, coinMult, 1);
    AudioSys.sfx('boss');
    this.scene.fx.shake(0.01, 400);
  }

  allDead() { return this.enemies.length === 0 && this._pending.length === 0; }
  hasBoss() { return this.enemies.some((e) => e.isBoss); }

  // ------------------------------------------------------------- update

  update(dtMs) {
    this._clock += dtMs;
    const dtSec = dtMs / 1000;

    // due spawns
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      if (p.atMs <= this._clock) {
        this._pending.splice(i, 1);
        const def = ENEMIES[p.enemyId] || BOSSES[p.enemyId];
        if (def) this._spawn(def, p.enemyId, p.hpMult, p.coinMult, undefined, p.lane);
      }
    }

    this._updateEnemies(dtSec);
    this._updateUnits(dtMs);
    this._updateProjectiles(dtSec);
  }

  _spawn(def, id, hpMult, coinMult, scaleMult, lane) {
    if (lane === undefined || lane === null) {
      lane = this._laneDeal % 3;
      this._laneDeal++;
    }
    const f = LAYOUT.field;
    const x = f.spawnX + Math.random() * 30;
    const y = f.laneY(lane);
    const isBoss = !!def.boss;
    const h = Math.round((def.h || 72) * (LAYOUT.enemyH / 82) * (scaleMult || 1));

    const root = this.scene.add.container(x, y).setDepth(300 + lane * 10);
    const shadow = this.scene.add.image(0, 2, 'shadow').setAlpha(0.5);
    shadow.setScale(h / 60);
    const img = this.scene.add.image(0, 0, 'en_' + id).setOrigin(0.5, 1);
    img.setScale(h / img.height);
    const barW = Math.max(40, h * 0.8);
    const hpBg = this.scene.add.rectangle(0, -h - 12, barW, 7, 0x263238).setOrigin(0.5);
    const hpFg = this.scene.add.rectangle(-barW / 2, -h - 12, barW, 5, isBoss ? 0xff1744 : 0x66bb6a).setOrigin(0, 0.5);
    root.add([shadow, img, hpBg, hpFg]);

    const e = {
      id, def, isBoss, root, img, hpBg, hpFg, barW,
      hp: def.hp * hpMult * (isBoss ? 1 : 1),
      maxHp: def.hp * hpMult,
      coins: Math.max(1, Math.round(def.coins * coinMult)),
      x, lane, h,
      speed: def.speed,
      wobbleT: Math.random() * 10,
      knock: 0,           // pending knockback px, decays fast
      dead: false,
    };
    e.hp = e.maxHp;
    this.enemies.push(e);

    if (isBoss) {
      this.scene.fx.banner(def.name + '!', '#ff1744');
      root.setDepth(500);
      root.setScale(0.2);
      this.scene.tweens.add({ targets: root, scale: 1, duration: 450, ease: 'Back.easeOut' });
    }
    return e;
  }

  _updateEnemies(dtSec) {
    const f = LAYOUT.field;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;

      // knockback decays quickly; while it lasts the enemy is shoved right
      if (e.knock > 0.5) {
        const shove = Math.min(e.knock, 340 * dtSec);
        e.x += shove;
        e.knock -= shove;
      } else {
        e.x -= e.speed * LAYOUT.combatScale * dtSec;
      }
      e.x = Math.min(e.x, f.spawnX + 60);

      e.wobbleT += dtSec * (e.speed / 9);
      e.root.x = e.x;
      e.root.y = f.laneY(e.lane) + Math.sin(e.wobbleT) * 2;
      e.img.setAngle(Math.sin(e.wobbleT) * 4);

      if (e.x <= f.baseX) {
        // through! costs lives
        this._despawn(e);
        AudioSys.sfx('hurt');
        this.scene.fx.flash(0xd32f2f);
        this.scene.fx.shake(0.008, 220);
        if (this.onLifeLost) this.onLifeLost(e.def.lives || 1, e);
      }
    }
  }

  _updateUnits(dtMs) {
    const units = this.board.fieldUnits();
    for (const fu of units) {
      const { unit } = fu;
      const def = CREATURES_BY_ID[unit.id];
      const arch = ARCHETYPES[def.archetype];
      let cd = this._cooldowns[unit.uid] || 0;
      cd -= dtMs;
      if (cd <= 0) {
        if (this._tryAttack(fu, def, arch)) {
          cd = 1000 / Units.attackSpeed(def, unit.star);
        } else {
          cd = 90; // nothing in range; check again shortly
        }
      }
      this._cooldowns[unit.uid] = cd;
    }
  }

  _unitPos(slot) { return LAYOUT.slotPos(slot); }

  _tryAttack(fu, def, arch) {
    const pos = this._unitPos(fu.slot);
    const targets = this._findTargets(fu, arch, pos);
    if (!targets || targets.length === 0) return false;

    const unit = fu.unit;
    const dmg = Units.damage(def, unit.star);
    const sprite = this.scene.boardUI && this.scene.boardUI.unitSprite(unit.uid);

    if (arch.projectile) {
      // ranged: one projectile at the first target (aoe splashes on arrival)
      const t = targets[0];
      this._fireProjectile(pos, t, dmg, def, arch, unit.star);
      if (sprite) this._recoil(sprite, t.x > pos.x ? -1 : 1);
      AudioSys.sfx('shoot');
    } else if (def.archetype === 'dash') {
      // lunge through the target and back
      const t = targets[0];
      if (sprite) this._lunge(sprite, pos, t);
      this.scene.time.delayedCall(110, () => {
        if (!t.dead) this.dealDamage(t, dmg, arch, def);
      });
    } else {
      // slam / spin / orbit: brief windup, then hit everything gathered
      if (sprite) this._hop(sprite);
      this.scene.time.delayedCall(90, () => {
        targets.forEach((t) => { if (!t.dead) this.dealDamage(t, dmg, arch, def); });
        if (arch.aoe) {
          const at = def.archetype === 'slam' ? targets[0] : null;
          const cx = at ? at.x : pos.x, cy = at ? at.root.y : pos.y;
          this.scene.fx.ringPulse(cx, cy - 20, def.color, arch.aoe / 46);
          if (def.archetype === 'slam') {
            AudioSys.sfx('boom');
            this.scene.fx.shake(0.004, 120);
          }
        }
      });
    }
    return true;
  }

  _findTargets(fu, arch, pos) {
    const alive = this.enemies.filter((e) => !e.dead);
    if (alive.length === 0) return null;

    switch (arch.targets) {
      case 'lane': {
        const inLane = alive.filter((e) =>
          e.lane === fu.lane && e.x > pos.x - 30 && e.x - pos.x < arch.range);
        if (inLane.length === 0) return null;
        inLane.sort((a, b) => a.x - b.x);       // most urgent first
        if (arch.aoe) {
          const lead = inLane[0];
          return inLane.filter((e) => Math.abs(e.x - lead.x) <= arch.aoe);
        }
        return [inLane[0]];
      }
      case 'ring': {
        const near = alive.filter((e) => this._dist(e, pos) <= arch.aoe);
        return near.length ? near : null;
      }
      case 'cluster': {
        // densest pack: the enemy with the most neighbours within aoe
        let best = null, bestN = 0;
        for (const e of alive) {
          const n = alive.filter((o) => Math.abs(o.x - e.x) <= arch.aoe && Math.abs(o.lane - e.lane) <= 1).length;
          if (n > bestN) { bestN = n; best = e; }
        }
        return best ? [best] : null;
      }
      case 'strongest': {
        let best = alive[0];
        for (const e of alive) if (e.hp > best.hp) best = e;
        return [best];
      }
    }
    return null;
  }

  _dist(e, pos) {
    const dy = e.root.y - pos.y;
    return Math.sqrt((e.x - pos.x) * (e.x - pos.x) + dy * dy);
  }

  _fireProjectile(from, target, dmg, def, arch, star) {
    const img = this.scene.add.image(from.x, from.y - LAYOUT.unitH * 0.55, arch.projectile)
      .setDepth(600);
    if (def.archetype === 'airstrike') {
      // lob: rise, then drop on the target's position
      const drop = { x: target.x, y: target.root.y };
      img.setScale(1.2);
      this.scene.tweens.add({
        targets: img, x: drop.x, y: from.y - LAYOUT.field.h * 0.55,
        duration: 260, ease: 'Quad.easeOut',
        onComplete: () => {
          this.scene.tweens.add({
            targets: img, y: drop.y, duration: 200, ease: 'Quad.easeIn',
            onComplete: () => {
              img.destroy();
              this._splash(drop.x, drop.y, arch.aoe, dmg, arch, def);
              AudioSys.sfx('boom');
              this.scene.fx.ringPulse(drop.x, drop.y - 10, 0xff7043, arch.aoe / 40);
              this.scene.fx.shake(0.004, 130);
            },
          });
        },
      });
      return;
    }
    this.projectiles.push({ img, target, dmg, arch, def, speed: CFG.COMBAT.projectileSpeed });
  }

  _updateProjectiles(dtSec) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const t = p.target;
      const tx = t.dead ? p.img.x + 400 * dtSec : t.x;
      const ty = t.dead ? p.img.y : t.root.y - t.h * 0.45;
      const dx = tx - p.img.x, dy = ty - p.img.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = p.speed * dtSec;
      if (t.dead && p.img.x > LAYOUT.field.right + 60) {
        p.img.destroy(); this.projectiles.splice(i, 1); continue;
      }
      if (d <= step + 6 && !t.dead) {
        p.img.destroy(); this.projectiles.splice(i, 1);
        this.dealDamage(t, p.dmg, p.arch, p.def);
        continue;
      }
      p.img.x += (dx / (d || 1)) * step;
      p.img.y += (dy / (d || 1)) * step;
      p.img.rotation = Math.atan2(dy, dx);
    }
  }

  _splash(x, y, radius, dmg, arch, def) {
    this.enemies.forEach((e) => {
      if (e.dead) return;
      const d = Math.sqrt((e.x - x) * (e.x - x) + (e.root.y - y) * (e.root.y - y));
      if (d <= radius) this.dealDamage(e, dmg, arch, def);
    });
  }

  dealDamage(e, dmg, arch, def) {
    if (e.dead) return;
    e.hp -= dmg;
    e.knock += (arch && arch.knockback) || 0;
    e.hpFg.width = Math.max(0, e.barW * (e.hp / e.maxHp));

    const big = dmg >= e.maxHp * 0.5;
    this.scene.fx.floatText(e.x, e.root.y - e.h - 18, String(Math.round(dmg)),
      big ? '#ffca28' : '#ffffff', big ? 24 : 16);
    this.scene.fx.squash(e.img, 0.18);

    const now = Date.now();
    if (now - this._hitSfxAt > 70) { AudioSys.sfx('hit'); this._hitSfxAt = now; }

    if (e.hp <= 0) this._kill(e, def);
  }

  _kill(e, killerDef) {
    e.dead = true;
    SaveSys.addStat('kills');
    const x = e.x, y = e.root.y;

    this.economy.earn(e.coins);
    const target = this.scene.hud ? this.scene.hud.coinTarget() : { x: 40, y: 40 };
    this.scene.fx.coinBurst(x, y - e.h * 0.4, Math.min(6, 2 + Math.floor(e.coins / 6)));
    this.scene.fx.coinFly(x, y - e.h * 0.4, target.x, target.y, () => {
      if (this.scene.hud) this.scene.hud.bumpCoins();
    });
    this.scene.fx.sparks(x, y - e.h * 0.4, 0xffca28, 8);
    AudioSys.sfx('kill');

    if (killerDef && (killerDef.archetype === 'slam' || killerDef.archetype === 'airstrike')) {
      this.scene.fx.hitStop(CFG.COMBAT.hitStopMs);
    }

    // squash-pop out
    this.scene.tweens.add({
      targets: e.root, scaleX: 1.25, scaleY: 0.1, alpha: 0, y: e.root.y + 6,
      duration: 190, ease: 'Quad.easeIn',
      onComplete: () => this._despawn(e),
    });

    if (e.isBoss) {
      SaveSys.addStat('bossKills');
      this.scene.fx.slowMo(0.22, CFG.COMBAT.bossSlowMoMs);
      this.scene.fx.shake(0.012, 500);
      this.scene.fx.confetti(x, y - e.h * 0.5, 40);
      this.scene.fx.coinBurst(x, y - e.h * 0.5, 18);
      Poki.happyTime(1);
      if (this.onBossDown) this.onBossDown(e);
    }
    if (this.onKill) this.onKill(e);
  }

  _despawn(e) {
    e.dead = true;
    e.root.destroy();
    const i = this.enemies.indexOf(e);
    if (i !== -1) this.enemies.splice(i, 1);
  }

  // ---- little unit attack animations (sprites owned by BoardUI) ----

  _lunge(sprite, from, target) {
    const dx = Math.min(60, (target.x - from.x) * 0.35);
    this.scene.tweens.add({
      targets: sprite, x: sprite.x + dx, duration: 110, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  _hop(sprite) {
    this.scene.tweens.add({
      targets: sprite, y: sprite.y - 14, duration: 90, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  _recoil(sprite, dir) {
    this.scene.tweens.add({
      targets: sprite, x: sprite.x + 6 * dir, duration: 70, yoyo: true,
    });
  }

  relayout() {
    // enemies keep their lane + proportional progress across a resize
    const f = LAYOUT.field;
    this.enemies.forEach((e) => {
      e.x = Math.min(e.x, f.spawnX);
      e.root.y = f.laneY(e.lane);
    });
  }
}
window.CombatSystem = CombatSystem;
