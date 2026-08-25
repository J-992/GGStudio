// The central belt: spawns creatures on a timer with rarity weights (bent by
// rebirth luck and events), scrolls them across the map, and announces the
// big ones so everybody rushes over.
class ConveyorManager {
  constructor(scene) {
    this.scene = scene;
    this.nextSpawnAt = 1200;   // first creature almost immediately
    this.belt = scene.add.tileSprite(CFG.W / 2, CFG.CONVEYOR_Y, CFG.W, 52, 'belt').setDepth(3);
  }

  speedMult() { return this.scene.eventMgr ? this.scene.eventMgr.conveyorMult() : 1; }

  luck() {
    let l = SaveSys.data.rebirths * CFG.REBIRTH_LUCK;
    if (this.scene.eventMgr && this.scene.eventMgr.active === 'rush') l += 1.5;
    return l;
  }

  pickDef(minTier) {
    const luck = this.luck();
    const pool = [];
    CREATURES.forEach((def) => {
      const t = RARITIES[def.rarity].tier;
      if (minTier !== undefined && t < minTier) return;
      let w = CFG.RARITY_WEIGHTS[def.rarity] / Math.max(1, CREATURES.filter((c) => c.rarity === def.rarity).length);
      if (t >= 2) w *= 1 + luck;
      pool.push({ def, w });
    });
    let total = 0;
    pool.forEach((p) => { total += p.w; });
    let r = Math.random() * total;
    for (const p of pool) { r -= p.w; if (r <= 0) return p.def; }
    return pool[pool.length - 1].def;
  }

  spawn(def) {
    const cr = this.scene.creatures.spawnOnBelt(def || this.pickDef());
    const t = RARITIES[cr.def.rarity].tier;
    if (t >= 4) {
      const css = '#' + RARITIES[cr.def.rarity].color.toString(16).padStart(6, '0');
      this.scene.fx.banner(RARITIES[cr.def.rarity].name + ' INCOMING!', css, cr.def.name);
      AudioSys.sfx(t >= 4 ? 'legendary' : 'rare');
      this.scene.bots.forEach((b) => b.onRareSpawn(cr));
    } else if (t >= 2) {
      AudioSys.sfx('rare');
    }
    return cr;
  }

  update(time, dtSec) {
    this.belt.tilePositionX += CFG.CONVEYOR_SPEED * this.speedMult() * dtSec;

    const onBelt = this.scene.creatures.onBelt();
    if (time > this.nextSpawnAt && onBelt.length < CFG.MAX_ON_BELT) {
      this.nextSpawnAt = time + CFG.SPAWN_INTERVAL / this.speedMult();
      this.spawn();
    }

    for (const cr of onBelt) {
      cr.x += CFG.CONVEYOR_SPEED * this.speedMult() * dtSec;
      if (cr.x > CFG.W + 60) this.scene.creatures.despawn(cr);
    }
  }
}
window.ConveyorManager = ConveyorManager;
