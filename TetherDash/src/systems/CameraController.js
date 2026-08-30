// Drives Projection.cam. Follows the runner along the face it is on and rolls
// around the tunnel axis to keep that face underfoot.
//
// The roll lag is deliberate and is most of what sells a flip: the world swings
// through ninety degrees over a couple of hundred milliseconds while the runner
// stays upright in the middle of the screen, so it reads as the tunnel turning
// rather than the character falling over.
class CameraController {
  constructor() {
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.roll = 0;
    this.kick = 0;       // extra pull-back after a flip or a stumble
  }

  snapTo(p) {
    this.roll = p.roll;
    Projection.setRoll(this.roll);
    Projection.cam.x = p.u * CFG.CAM_LEAD;
    Projection.cam.y = CFG.CAM_HEIGHT;
    Projection.cam.z = p.z - CFG.CAM_BACK;
    this.kick = 0;
  }

  shake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  update(dt, p) {
    const cam = Projection.cam;

    // Roll never wraps: the runner accumulates turns, so going twice round the
    // tube the same way keeps spinning instead of snapping back.
    this.roll += (p.roll - this.roll) * Math.min(1, CFG.ROLL_RATE * dt);
    Projection.setRoll(this.roll);

    if (p.flipFlash > 0) this.kick = Math.max(this.kick, p.flipFlash * 2.4);
    this.kick += (0 - this.kick) * Math.min(1, 3 * dt);

    // Only a hint of lateral follow. Track the runner across the face any
    // harder and the tube itself swings off the side of the screen, which is
    // exactly the moment the player needs to see the corner they are aiming at.
    const tx = p.u * CFG.CAM_LEAD;
    const tz = p.z - CFG.CAM_BACK - this.kick;
    const ty = CFG.CAM_HEIGHT + Math.max(0, p.h) * 0.28;

    cam.x += (tx - cam.x) * Math.min(1, 6 * dt);
    cam.y += (ty - cam.y) * Math.min(1, 4 * dt);
    // Forward tracking is stiff: falling behind the runner at 21 units/sec
    // eats the reaction time the player needs to read the next piece.
    cam.z += (tz - cam.z) * Math.min(1, 12 * dt);

    // Shake is world-unit jitter on the camera; the follow-lerp above pulls it
    // back out, so it decays on its own (~80 px per unit at runner depth).
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const m = this.shakeMag / 80;
      cam.x += (Math.random() * 2 - 1) * m;
      cam.y += (Math.random() * 2 - 1) * m;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }
  }
}
