// Object pools.
//
// An endless tunnel spawns and retires track pieces forever, and the two things
// that must never be allocated in that loop are the plain records describing a
// piece's contents and the Phaser display objects drawing them. Both are handed
// out here and handed straight back when a piece scrolls off behind the runner.
//
// Sprites are bound to an entity for as long as its piece is alive -- not
// per-frame -- so the number in flight is bounded by what fits in the draw
// distance, which is a couple of dozen. Frame-by-frame culling is a setVisible,
// not a new sprite.

/** A pool of plain objects. `make` builds one; `reset` wipes one on return. */
class Pool {
  constructor(make, reset) {
    this.make = make;
    this.reset = reset || null;
    this.free = [];
    this.live = 0;
  }

  get() {
    this.live++;
    return this.free.length > 0 ? this.free.pop() : this.make();
  }

  put(o) {
    if (!o) return;
    this.live--;
    if (this.reset) this.reset(o);
    this.free.push(o);
  }

  /** Hand back a whole array's worth and empty it, which is the usual case. */
  putAll(list) {
    for (let i = 0; i < list.length; i++) this.put(list[i]);
    list.length = 0;
  }
}

/** A pool of Phaser images, one per texture key. Nothing is ever destroyed. */
class SpritePool {
  constructor(scene) {
    this.scene = scene;
    this.byKey = Object.create(null);
  }

  get(key, depth) {
    const free = this.byKey[key] || (this.byKey[key] = []);
    const spr = free.length > 0 ? free.pop() : this.scene.add.image(0, 0, key);
    spr.setVisible(true).setActive(true).setAlpha(1).setRotation(0);
    if (depth !== undefined) spr.setDepth(depth);
    return spr;
  }

  put(key, spr) {
    if (!spr) return;
    spr.setVisible(false).setActive(false);
    (this.byKey[key] || (this.byKey[key] = [])).push(spr);
  }

  /** Total sprites ever created, per key -- read by the debug overlay. */
  census() {
    const out = {};
    for (const key of Object.keys(this.byKey)) out[key] = this.byKey[key].length;
    return out;
  }
}
