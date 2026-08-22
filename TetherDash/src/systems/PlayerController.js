// One runner: auto-run forward, steer, jump. Handles coyote time, jump
// buffering, variable jump height, moving-platform carry, conveyors, pads,
// wall/gear collisions and edge detection. Rendering lives in GameScene.
class PlayerController {
  constructor(scene, course, id, startX) {
    this.scene = scene;
    this.course = course;
    this.id = id;               // 'A' | 'B'
    this.startX = startX;
    this.x = startX; this.y = 0; this.z = 2;
    this.vx = 0; this.vy = 0;
    this.vzExtra = 0;           // tether / conveyor / stumble speed offset
    this.grounded = true;
    this.coyote = 0; this.buffer = 0;
    this.jumpCutDone = true;
    this.stun = 0;
    this.state = 'run';         // 'run' | 'rescued'
    this.squash = 0;            // renderer reads this for squash/stretch
    this.stretchAnim = 0;
    this.curPlatform = null;
    this.prevMoveOff = 0;
    this.padCooldown = 0;
  }

  get vzTotal() {
    const base = CFG.RUN_SPEED * this.course.level.speed * (this.stun > 0 ? 0.35 : 1);
    return base + this.vzExtra;
  }

  respawnAt(z) {
    this.x = this.startX; this.y = 0; this.z = z;
    this.vx = 0; this.vy = 0; this.vzExtra = 0;
    this.grounded = true; this.state = 'run'; this.stun = 0;
    this.coyote = 0; this.buffer = 0;
  }

  update(dt, input, t) {
    if (this.state !== 'run') return;
    const c = this.course;
    const prevZ = this.z;
    if (this.stun > 0) this.stun -= dt;
    if (this.padCooldown > 0) this.padCooldown -= dt;

    input = input || { left: false, right: false, jump: false, jumpHeld: false };

    // ---- lateral steering ----
    const authority = this.grounded ? 1 : CFG.AIR_CONTROL;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx += dir * CFG.LAT_ACCEL * authority * dt;
    } else {
      const drag = CFG.LAT_DRAG * authority * dt;
      if (Math.abs(this.vx) <= drag) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * drag;
    }
    this.vx = Phaser.Math.Clamp(this.vx, -CFG.LAT_MAX, CFG.LAT_MAX);

    // moving platforms carry their rider
    if (this.grounded && this.curPlatform && this.curPlatform.move) {
      const off = c.moveOffset(this.curPlatform, t);
      this.x += off - this.prevMoveOff;
      this.prevMoveOff = off;
    }
    this.x += this.vx * dt;
    this.x = Phaser.Math.Clamp(this.x, -8, 8);

    // ---- forward ----
    this.z += this.vzTotal * dt;
    // the extra speed decays back to baseline
    const decay = 2.2 * dt;
    if (Math.abs(this.vzExtra) <= decay) this.vzExtra = 0;
    else this.vzExtra -= Math.sign(this.vzExtra) * decay;
    this.vzExtra = Phaser.Math.Clamp(this.vzExtra, -9, 9);

    // conveyors push
    if (this.grounded && this.curPlatform && this.curPlatform.kind === 'conveyor') {
      const target = this.curPlatform.conv * CFG.CONVEYOR_PUSH;
      this.vzExtra += (target - this.vzExtra) * Math.min(1, 4 * dt);
    }

    // ---- jumping ----
    this.buffer = input.jump ? CFG.BUFFER : Math.max(0, this.buffer - dt);
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = CFG.JUMP_VEL;
      this.grounded = false;
      this.coyote = 0; this.buffer = 0;
      this.jumpCutDone = false;
      this.squash = -0.5;           // stretch up
      AudioSys.play('jump');
    }
    if (!this.grounded && !input.jumpHeld && !this.jumpCutDone && this.vy > 0) {
      this.vy *= (1 - CFG.JUMP_CUT);
      this.jumpCutDone = true;
    }

    // ---- vertical physics + ground resolution ----
    const ground = c.groundAt(this.x, this.z, t);
    if (this.grounded) {
      this.curPlatform = ground ? ground.p : null;
      if (!ground) {
        this.grounded = false;
        this.coyote = CFG.COYOTE;
        this.vy = 0;
      } else if (this.curPlatform && this.curPlatform.move) {
        this.prevMoveOff = c.moveOffset(this.curPlatform, t);
      }
    }
    if (!this.grounded) {
      this.vy -= CFG.GRAVITY * dt;
      this.y += this.vy * dt;
      this.coyote = Math.max(0, this.coyote - dt);
      // land only from near floor level — once you've sunk past a platform's
      // face you fall behind it instead of teleporting up onto it
      if (this.vy <= 0 && this.y <= 0 && this.y > -1.0 && ground) {
        // landed
        const impact = -this.vy;
        this.y = 0; this.vy = 0;
        this.grounded = true;
        this.jumpCutDone = true;
        this.curPlatform = ground.p;
        if (ground.p.move) this.prevMoveOff = c.moveOffset(ground.p, t);
        this.squash = Math.min(0.55, impact / 22);
        AudioSys.play(impact > 13 ? 'landHard' : 'land');
        this.scene.fx.landDust(this);
      }
    }

    // ---- launch pads ----
    if (this.grounded && this.padCooldown <= 0) {
      for (const pad of c.pads) {
        if (Math.abs(this.x - pad.c) < pad.r && Math.abs(this.z - pad.z) < pad.r) {
          this.vy = CFG.JUMP_VEL * CFG.PAD_BOOST;
          this.grounded = false;
          this.jumpCutDone = true;    // full boost, no cut
          this.padCooldown = 0.5;
          this.squash = -0.6;
          AudioSys.play('pad');
          this.scene.fx.landDust(this);
          break;
        }
      }
    }

    // ---- walls (gates / dividers) ----
    for (const b of c.blocks) {
      if (this.y >= b.h) continue;
      const half = b.w / 2 + 0.26;
      if (prevZ < b.z0 && this.z >= b.z0 && Math.abs(this.x - b.c) < half) {
        if (b.w < 1.2) {
          // a thin divider tip glances you off to the side instead of
          // stopping you dead
          const side = Math.sign(this.x - b.c) || (this.id === 'A' ? -1 : 1);
          this.x = b.c + side * half;
          this.vx = side * 3.5;
          this.vzExtra = Math.min(this.vzExtra, -2);
        } else {
          // ran face-first into a wall
          this.z = b.z0 - 0.05;
          this.stumble();
        }
      } else if (this.z >= b.z0 && this.z <= b.z1 && Math.abs(this.x - b.c) < half) {
        // brushing along a divider: push out sideways
        const side = Math.sign(this.x - b.c) || (this.id === 'A' ? -1 : 1);
        this.x = b.c + side * half;
        if (Math.sign(this.vx) !== side) this.vx = 0;
      }
    }

    // ---- gears ----
    if (this.stun <= 0) {
      for (const g of c.gears) {
        if (this.y < 1.2 && Math.abs(this.x - g.c) < g.r + 0.3 && Math.abs(this.z - g.z) < g.r + 0.3) {
          const side = Math.sign(this.x - g.c) || (this.id === 'A' ? -1 : 1);
          this.vx = side * 7;
          this.stumble();
          break;
        }
      }
    }

    // ---- fell off the world ----
    if (this.y < CFG.FALL_Y) this.scene.handleFall(this);

    // squash/stretch recovery
    this.squash += (0 - this.squash) * Math.min(1, 8 * dt);
  }

  stumble() {
    if (this.stun > 0) return;
    this.stun = CFG.STUN_TIME;
    this.vzExtra = CFG.STUN_KNOCKBACK;
    AudioSys.play('stumble');
    this.scene.cam.shake(6, 0.25);
  }
}
