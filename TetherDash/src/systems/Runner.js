// The runner. Auto-runs forward, steers across the face it is standing on,
// jumps -- and, when it steps past a corner of the tube, changes which face
// counts as the floor.
//
// Everything here is in face-local coordinates: `u` across the current face,
// `h` off its surface, `z` forward. Gravity is always -h, so wall-running and
// ceiling-running need no special case at all; the only new physics is what
// happens at a corner.
//
// The corner map is exact rather than approximate. At |u| = TUBE_R the two
// faces meet, and the same world point is (u, h) on this face and
// (h - R, R - u) on the next one round. Rotating position and velocity through
// that map is why a wall-run feels continuous instead of like a teleport, and
// why jumping *into* a wall sticks to it at the height you hit it.
class Runner {
  constructor(scene) {
    this.scene = scene;
    this.reset(2);
  }

  reset(z) {
    this.f = 0;                 // face being run on: 0 floor, 1 right, 2 ceiling, 3 left
    this.u = 0; this.h = 0; this.z = z;
    this.vu = 0; this.vh = 0;
    this.roll = 0;              // accumulated camera roll target, radians
    this.grounded = true;
    this.coyote = 0; this.buffer = 0;
    this.jumpCutDone = true;
    this.flipGrace = 0;
    this.flipFlash = 0;         // >0 just after a flip, for the juice
    this.stun = 0;
    this.alive = true;
    this.squash = 0;
    this.panel = null;
    this.padCooldown = 0;
    this.distance = z;
  }

  /** Forward speed in units/sec, ramped by how far this run has come. */
  get speed() {
    const base = Math.min(CFG.SPEED_MAX, CFG.RUN_SPEED + this.distance * CFG.SPEED_RAMP);
    return this.stun > 0 ? base * (1 - CFG.STUN_SLOW) : base;
  }

  update(dt, input) {
    if (!this.alive) return;
    input = input || { left: false, right: false, jump: false, jumpHeld: false };

    if (this.stun > 0) this.stun -= dt;
    if (this.padCooldown > 0) this.padCooldown -= dt;
    if (this.flipGrace > 0) this.flipGrace -= dt;
    if (this.flipFlash > 0) this.flipFlash -= dt;

    // ---- steering across the face ----
    const authority = this.grounded ? 1 : CFG.AIR_CONTROL;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vu += dir * CFG.LAT_ACCEL * authority * dt;
    } else {
      const drag = CFG.LAT_DRAG * authority * dt;
      if (Math.abs(this.vu) <= drag) this.vu = 0;
      else this.vu -= Math.sign(this.vu) * drag;
    }
    this.vu = Phaser.Math.Clamp(this.vu, -CFG.LAT_MAX, CFG.LAT_MAX);
    this.u += this.vu * dt;

    // ---- forward ----
    this.z += this.speed * dt;
    if (this.z > this.distance) this.distance = this.z;

    // ---- jump ----
    this.buffer = input.jump ? CFG.BUFFER : Math.max(0, this.buffer - dt);
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vh = CFG.JUMP_VEL;
      this.grounded = false;
      this.coyote = 0; this.buffer = 0;
      this.jumpCutDone = false;
      this.squash = -0.5;
      AudioSys.play('jump');
    }
    if (!this.grounded && !input.jumpHeld && !this.jumpCutDone && this.vh > 0) {
      this.vh *= (1 - CFG.JUMP_CUT);
      this.jumpCutDone = true;
    }

    // ---- corners: the wall/ceiling mechanic ----
    this.checkCorner();

    // ---- gravity, landing ----
    const ground = Track.groundAt(this.f, this.u, this.z);
    if (this.grounded) {
      this.panel = ground;
      if (!ground) {
        this.grounded = false;
        this.coyote = CFG.COYOTE;
        this.vh = 0;
      }
    }
    if (!this.grounded) {
      this.vh -= CFG.GRAVITY * dt;
      this.h += this.vh * dt;
      this.coyote = Math.max(0, this.coyote - dt);
      // Land only from just above the surface. Once you have sunk past a
      // panel's lip you fall behind it rather than snapping up onto it.
      if (this.vh <= 0 && this.h <= 0 && this.h > -1.0 && ground) {
        const impact = -this.vh;
        this.h = 0; this.vh = 0;
        this.grounded = true;
        this.jumpCutDone = true;
        this.panel = ground;
        this.squash = Math.min(0.55, impact / 22);
        AudioSys.play(impact > 13 ? 'landHard' : 'land');
        this.scene.fx.landDust(this);
      }
    }

    // ---- launch pads ----
    if (this.grounded && this.padCooldown <= 0) {
      const pad = Track.padAt(this.f, this.u, this.z);
      if (pad) {
        this.vh = CFG.JUMP_VEL * CFG.PAD_BOOST;
        this.grounded = false;
        this.jumpCutDone = true;   // full boost, no cut
        this.padCooldown = 0.5;
        this.squash = -0.6;
        AudioSys.play('pad');
        this.scene.fx.landDust(this);
      }
    }

    // ---- hazards ----
    if (this.stun <= 0 && this.h < 1.3) this.checkHazards();

    // ---- fell out of the tunnel ----
    if (this.h < CFG.FALL_H) this.scene.handleFall(this);

    this.squash += (0 - this.squash) * Math.min(1, 8 * dt);
  }

  // Walking past |u| = TUBE_R puts the runner on the next face round the tube,
  // if that face has a panel to land on. If it does not, nothing happens here
  // and the ground check above finds no floor -- which is the fall.
  checkCorner() {
    const R = CFG.TUBE_R;
    if (this.flipGrace > 0 || Math.abs(this.u) <= R) return;

    let nf, nu, nh, nvu, nvh, turn;
    if (this.u > R) {
      nf = (this.f + 1) % 4;
      nu = this.h - R; nh = R - this.u;
      nvu = this.vh; nvh = -this.vu;
      turn = -1;
    } else {
      nf = (this.f + 3) % 4;
      nu = R - this.h; nh = R + this.u;
      nvu = -this.vh; nvh = this.vu;
      turn = 1;
    }
    // Beyond the far corner of the next face there is no tube left to grip.
    if (nu < -R - CFG.EDGE_MARGIN || nu > R + CFG.EDGE_MARGIN) return;
    if (!Track.groundAt(nf, nu, this.z)) return;

    this.f = nf;
    this.u = nu;
    this.h = Math.max(nh, 0);
    this.vu = nvu;
    this.vh = Math.min(nvh, 0);   // never launched off the new face by the turn
    this.roll += turn * Math.PI / 2;
    this.flipGrace = CFG.FLIP_GRACE;
    this.flipFlash = 0.35;
    this.grounded = false;        // the frame below lands them on the new face
    this.coyote = CFG.COYOTE;
    AudioSys.play('flip');
    this.scene.onFlip(this);
  }

  checkHazards() {
    for (const c of Track.chunks) {
      if (this.z < c.z0 - 2 || this.z > c.z1 + 2) continue;
      for (const g of c.hazards) {
        if (g.f !== this.f) continue;
        if (Math.abs(this.u - g.u) > g.r + 0.3 || Math.abs(this.z - g.z) > g.r + 0.3) continue;
        const side = Math.sign(this.u - g.u) || 1;
        this.vu = side * 7;
        this.stumble();
        return;
      }
    }
  }

  stumble() {
    if (this.stun > 0) return;
    this.stun = CFG.STUN_TIME;
    AudioSys.play('stumble');
    this.scene.cam.shake(6, 0.25);
  }
}
