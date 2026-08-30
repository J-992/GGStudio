// The endless tunnel: piece selection, the spawn/recycle loop, and every
// geometry query the runner, the camera and the renderer ask.
//
// Only the stretch of tunnel around the runner exists. A piece from
// src/data/pieces.js is stamped down whenever the far end comes within draw
// distance, and the piece behind the runner is handed back to the pools the
// moment it leaves the screen for good, so a five-minute run and a five-second
// run cost the same memory and make the same number of objects.
//
// Every piece is welded on behind a coupler ring -- RING_LEN units where all
// four faces are solid. That ring is what makes the catalogue modular: a piece
// never has to care which face you arrive on, because the ring in front of it
// lets you be on any of them.
const Track = {
  scene: null,
  sprites: null,          // SpritePool
  chunks: [],             // live pieces, in z order
  headZ: 0,               // z the next piece will be stamped at
  distance: 0,            // metres the runner has covered, drives difficulty
  seed: 1,
  lastDef: null,

  AHEAD: CFG.DRAW_DIST + 16,
  BEHIND: 22,

  // --------------------------------------------------------------- pools

  _chunkPool: null,
  _panelPool: null,
  _boltPool: null,
  _hazardPool: null,
  _padPool: null,

  init(scene, sprites) {
    this.scene = scene;
    this.sprites = sprites || null;
    if (!this._chunkPool) {
      this._chunkPool = new Pool(
        () => ({ def: null, z0: 0, z1: 0, panels: [], bolts: [], hazards: [], pads: [] }));
      this._panelPool = new Pool(() => ({ f: 0, u0: 0, u1: 0, z0: 0, z1: 0, ring: false }));
      this._boltPool = new Pool(
        () => ({ f: 0, u: 0, h: 0, z: 0, taken: false, spr: null }),
        (o) => { o.taken = false; o.spr = null; });
      this._hazardPool = new Pool(
        () => ({ f: 0, u: 0, z: 0, kind: 'gear', r: 1, angle: 0, spr: null }),
        (o) => { o.spr = null; o.angle = 0; });
      this._padPool = new Pool(
        () => ({ f: 0, u: 0, z: 0, r: 1.3, spr: null }),
        (o) => { o.spr = null; });
    }
    return this;
  },

  // ----------------------------------------------------------- randomness

  // mulberry32 -- small, seedable, and the same numbers in node and in the
  // browser, which is what lets check.mjs replay a real run offline.
  rng() {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  // -------------------------------------------------------------- builder

  // Compiles a piece definition into flat panel/bolt/hazard/pad lists on
  // `into`, with z offset by `at`. `into` supplies newPanel/newBolt/newHazard/
  // newPad so the same code path serves a pooled live chunk and the throwaway
  // objects tools/check.mjs audits pieces with.
  compile(def, at, into) {
    const R = CFG.TUBE_R;
    const panel = (f, dz0, dz1, u0, u1) => {
      const p = into.newPanel();
      p.f = f;
      p.u0 = u0 === undefined ? -R : u0;
      p.u1 = u1 === undefined ? R : u1;
      p.z0 = at + dz0; p.z1 = at + dz1; p.ring = false;
      into.panels.push(p);
    };
    const b = {
      R,
      len: def.len,
      panel,
      all(dz0, dz1) { for (let f = 0; f < 4; f++) panel(f, dz0, dz1); },
      bolt(f, u, dz, h) {
        const o = into.newBolt();
        o.f = f; o.u = u; o.h = h === undefined ? 0.62 : h;
        o.z = at + dz; o.taken = false;
        into.bolts.push(o);
      },
      boltLine(f, u, dz0, dz1, step) {
        for (let dz = dz0; dz <= dz1; dz += (step || 4)) b.bolt(f, u, dz);
      },
      // three bolts arcing over a gap, at the height a jump actually reaches
      boltArc(f, u, dz0, dz1) {
        const mid = (dz0 + dz1) / 2, span = (dz1 - dz0) / 2;
        b.bolt(f, u, mid - span * 0.55, 0.95);
        b.bolt(f, u, mid, 1.7);
        b.bolt(f, u, mid + span * 0.55, 0.95);
      },
      hazard(f, u, dz, kind) {
        const o = into.newHazard();
        o.f = f; o.u = u; o.z = at + dz; o.kind = kind || 'gear';
        o.r = o.kind === 'block' ? 0.85 : 1.05;
        o.angle = 0;
        into.hazards.push(o);
      },
      pad(f, u, dz) {
        const o = into.newPad();
        o.f = f; o.u = u; o.z = at + dz; o.r = 1.3;
        into.pads.push(o);
      }
    };
    def.build(b);
  },

  // ---------------------------------------------------------- spawn cycle

  reset(seed) {
    for (const c of this.chunks) this._recycle(c);
    this.chunks.length = 0;
    this.headZ = 0;
    this.distance = 0;
    this.lastDef = null;
    this.seed = seed === undefined ? (Math.random() * 0x7fffffff) | 0 : seed;
    // A run always opens on a plain straight: the first thing a new player
    // sees is never a hole.
    this._spawn(PIECES[0]);
    while (this.headZ < this.AHEAD) this._spawn(this._pick());
  },

  /** Difficulty tier, 0..3, from distance travelled. */
  tier() { return Math.min(3, Math.floor(this.distance / 320)); },

  _pick() {
    const tier = this.tier();
    // A hard piece is always followed by a breather: back-to-back forced flips
    // read as unfair rather than difficult.
    const needRest = this.lastDef !== null && this.lastDef.tier >= 2;
    const pool = [];
    let total = 0;
    for (const def of PIECES) {
      if (def.tier > tier) continue;
      if (def === this.lastDef) continue;
      if (needRest && !def.rest) continue;
      pool.push(def);
      total += def.weight;
    }
    if (pool.length === 0) return PIECES[0];
    let r = this.rng() * total;
    for (const def of pool) {
      r -= def.weight;
      if (r <= 0) return def;
    }
    return pool[pool.length - 1];
  },

  _spawn(def) {
    const c = this._chunkPool.get();
    c.def = def;
    c.z0 = this.headZ;
    c.z1 = this.headZ + CFG.RING_LEN + def.len;
    c.track = this;
    c.newPanel = this._newPanel;
    c.newBolt = this._newBolt;
    c.newHazard = this._newHazard;
    c.newPad = this._newPad;

    for (let f = 0; f < 4; f++) {
      const p = this._panelPool.get();
      p.f = f; p.u0 = -CFG.TUBE_R; p.u1 = CFG.TUBE_R;
      p.z0 = c.z0; p.z1 = c.z0 + CFG.RING_LEN; p.ring = true;
      c.panels.push(p);
    }
    this.compile(def, c.z0 + CFG.RING_LEN, c);

    // Sprites are claimed once, for as long as the piece is alive -- not per
    // frame. Culling is then a setVisible on a sprite that already exists.
    if (this.sprites) {
      for (const o of c.bolts) o.spr = this.sprites.get('bolt');
      for (const o of c.hazards) o.spr = this.sprites.get(this.hazardKey(o));
      for (const o of c.pads) o.spr = this.sprites.get('padGlyph');
    }

    this.chunks.push(c);
    this.headZ = c.z1;
    this.lastDef = def;
    return c;
  },

  hazardKey(h) { return h.kind === 'block' ? 'blockHaz' : 'gearHaz'; },

  _recycle(c) {
    if (this.sprites) {
      for (const o of c.bolts) this.sprites.put('bolt', o.spr);
      for (const o of c.hazards) this.sprites.put(this.hazardKey(o), o.spr);
      for (const o of c.pads) this.sprites.put('padGlyph', o.spr);
    }
    this._panelPool.putAll(c.panels);
    this._boltPool.putAll(c.bolts);
    this._hazardPool.putAll(c.hazards);
    this._padPool.putAll(c.pads);
    c.def = null;
    this._chunkPool.put(c);
  },

  /** Keep the live window centred on the runner. Call once per frame. */
  update(playerZ, dt) {
    if (playerZ > this.distance) this.distance = playerZ;
    while (this.headZ < playerZ + this.AHEAD) this._spawn(this._pick());
    while (this.chunks.length > 0 && this.chunks[0].z1 < playerZ - this.BEHIND) {
      this._recycle(this.chunks.shift());
    }
    for (const c of this.chunks) {
      for (const h of c.hazards) if (h.kind === 'gear') h.angle += 2.6 * dt;
    }
  },

  // -------------------------------------------------------------- queries

  /** The panel under (f, u) at z, or null. `margin` forgives panel edges. */
  groundAt(f, u, z, margin) {
    const m = margin === undefined ? CFG.EDGE_MARGIN : margin;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (z < c.z0 || z > c.z1) continue;
      const panels = c.panels;
      for (let j = 0; j < panels.length; j++) {
        const p = panels[j];
        if (p.f !== f || z < p.z0 || z > p.z1) continue;
        if (u >= p.u0 - m && u <= p.u1 + m) return p;
      }
    }
    return null;
  },

  /** How far ahead (up to max) the panel under (f, u) keeps going. */
  distToDrop(f, u, z, max) {
    for (let d = 0; d <= max; d += 0.5) {
      if (!this.groundAt(f, u, z + d, 0)) return d;
    }
    return max;
  },

  padAt(f, u, z) {
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (z < c.z0 - 2 || z > c.z1 + 2) continue;
      for (let j = 0; j < c.pads.length; j++) {
        const p = c.pads[j];
        if (p.f === f && Math.abs(u - p.u) < p.r && Math.abs(z - p.z) < p.r) return p;
      }
    }
    return null;
  },

  // ------------------------------------------------------ pool trampolines
  // Assigned onto each chunk so compile() can allocate through the pools
  // without being handed them.

  _newPanel() { return this.track._panelPool.get(); },
  _newBolt() { return this.track._boltPool.get(); },
  _newHazard() { return this.track._hazardPool.get(); },
  _newPad() { return this.track._padPool.get(); }
};
