// Fake-3D camera math, plus the tube's face geometry.
//
// World: x/y across the tunnel's cross-section, z forward. The camera sits
// behind the runner looking down +z and *rolls* around that axis so whichever
// face the runner is on ends up underfoot. That roll is the whole trick: the
// projection below is the same single divide it always was, and a wall becomes
// a floor purely by rotating the cross-section into view space first.
const Projection = {
  cam: { x: 0, y: CFG.CAM_HEIGHT, z: -CFG.CAM_BACK },
  roll: 0,          // radians; -PI/2 per face clockwise round the tube
  rc: 1, rs: 0,     // cos/sin of `roll`, refreshed by setRoll

  // Inward normal and lateral axis of each face, in cross-section coords.
  // Walking right off the floor's corner lands you on face 1, and so on round.
  N: [[0, 1], [-1, 0], [0, -1], [1, 0]],
  R: [[1, 0], [0, 1], [-1, 0], [0, -1]],

  setRoll(a) {
    this.roll = a;
    this.rc = Math.cos(a);
    this.rs = Math.sin(a);
  },

  // The face-local point (u, h) as a cross-section world point.
  // A face's surface sits TUBE_R from the tube axis, so h is measured from it.
  worldX(f, u, h) { return this.R[f][0] * u + this.N[f][0] * (h - CFG.TUBE_R); },
  worldY(f, u, h) { return this.R[f][1] * u + this.N[f][1] * (h - CFG.TUBE_R); },

  // -> { x, y, s, dz }  s = px per world unit at that depth.
  // (x, y) are cross-section world coords; the roll and the +TUBE_R shift put
  // the face currently underfoot at view height 0, where the old floor was.
  project(x, y, z) {
    const vx = x * this.rc - y * this.rs;
    const vy = x * this.rs + y * this.rc + CFG.TUBE_R;
    const dz = Math.max(z - this.cam.z, 0.001);
    const s = CFG.FOCAL / dz;
    return {
      x: CFG.GAME_W / 2 + (vx - this.cam.x) * s,
      y: CFG.HORIZON_Y + (this.cam.y - vy) * s,
      s, dz
    };
  },

  // The common case: project a point given in some face's own coordinates.
  face(f, u, h, z) {
    return this.project(this.worldX(f, u, h), this.worldY(f, u, h), z);
  },

  inView(z) {
    const dz = z - this.cam.z;
    return dz > CFG.NEAR && dz < CFG.DRAW_DIST;
  },

  // 0 near .. 1 fully swallowed by the dark, for fading the tunnel out.
  fog(dz) {
    return Phaser.Math.Clamp((dz - CFG.FOG_START) / (CFG.DRAW_DIST - CFG.FOG_START), 0, 1);
  },

  // Blend a panel color toward the void color by fog amount.
  fogColor(color, f) {
    if (f <= 0) return color;
    const c = Phaser.Display.Color.IntegerToColor(color);
    const s = Phaser.Display.Color.IntegerToColor(CFG.FOG_COLOR);
    return Phaser.Display.Color.GetColor(
      Math.round(c.red + (s.red - c.red) * f),
      Math.round(c.green + (s.green - c.green) * f),
      Math.round(c.blue + (s.blue - c.blue) * f)
    );
  }
};
