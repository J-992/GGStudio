// Dynamic events: every 90-150s one short burst of chaos. Modifiers are
// queried by the other systems (conveyorMult, incomeMult, locksDisabled via
// BaseManager, tiny via controllers).
const EVENTS = [
  { id: 'rush',   name: 'CONVEYOR RUSH!',  sub: 'Double speed, better loot!', dur: 20000, color: '#4fc3f7' },
  { id: 'open',   name: 'BASES OPEN!',     sub: 'All locks disabled!',        dur: 20000, color: '#ff8a80' },
  { id: 'golden', name: 'GOLDEN MINUTE!',  sub: 'All income x2!',             dur: 30000, color: '#ffd54f' },
  { id: 'mega',   name: 'MEGA BRAINROT!',  sub: 'Grab it before the bots!',   dur: 15000, color: '#ea80fc' },
  { id: 'tiny',   name: 'TINY MODE!',      sub: 'Smol and fast!',             dur: 20000, color: '#a5d6a7' },
];

class EventManager {
  constructor(scene) {
    this.scene = scene;
    this.active = null;
    this.until = 0;
    this.nextAt = CFG.EVENT_FIRST_MS;
    this._last = null;
  }

  conveyorMult() { return this.active === 'rush' ? 2 : 1; }
  incomeMult() { return this.active === 'golden' ? 2 : 1; }

  activeName() {
    if (!this.active) return null;
    return EVENTS.find((e) => e.id === this.active);
  }

  trigger(id) {
    const ev = EVENTS.find((e) => e.id === id) ||
      Phaser.Utils.Array.GetRandom(EVENTS.filter((e) => e.id !== this._last));
    this._last = ev.id;
    this.active = ev.id;
    this.until = this.scene.time.now + ev.dur;
    SaveSys.addStat('events');
    AudioSys.sfx('event');
    this.scene.fx.banner(ev.name, ev.color, ev.sub);
    this.scene.fx.flash(0xffffff);

    if (ev.id === 'open') this.scene.bases.forceUnlockAll();
    if (ev.id === 'mega') {
      // one spectacular creature at half price; everyone wants it
      const pool = CREATURES.filter((c) => RARITIES[c.rarity].tier >= 4);
      const base = Phaser.Utils.Array.GetRandom(pool);
      const def = Object.assign({}, base, { price: Math.floor(base.price / 2) });
      this.scene.conveyor.spawn(def);
    }
  }

  update(time) {
    if (this.active && time >= this.until) this.active = null;
    if (time >= this.nextAt) {
      this.nextAt = time + CFG.EVENT_MIN_MS + Math.random() * (CFG.EVENT_MAX_MS - CFG.EVENT_MIN_MS);
      this.trigger();
    }
  }
}
window.EventManager = EventManager;
