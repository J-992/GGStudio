// Drives Projection.cam: follows the pair, pulls back and rises as they
// separate so both stay framed, and adds shake on impacts.
class CameraController {
  constructor() {
    this.shakeMag = 0;
    this.shakeTime = 0;
  }

  snapTo(a, b) {
    Projection.cam.x = (a.x + b.x) / 2 * 0.85;
    Projection.cam.y = CFG.CAM_HEIGHT;
    Projection.cam.z = Math.min(a.z, b.z) - CFG.CAM_BACK;
  }

  shake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  update(dt, a, b, tether) {
    const cam = Projection.cam;
    const sep = Phaser.Math.Clamp(tether.dist - CFG.tether.slackLength, 0, 8);

    const tx = (a.x + b.x) / 2 * 0.85;
    const back = CFG.CAM_BACK + sep * 0.45;
    const tz = Math.min(a.z, b.z) - back;
    const avgY = Math.max(0, (Math.max(a.y, 0) + Math.max(b.y, 0)) / 2);
    const ty = CFG.CAM_HEIGHT + avgY * 0.3 + sep * 0.12;

    cam.x += (tx - cam.x) * Math.min(1, 5 * dt);
    cam.z += (tz - cam.z) * Math.min(1, 7 * dt);
    cam.y += (ty - cam.y) * Math.min(1, 4 * dt);

    // shake is world-unit jitter on the camera itself; the follow-lerp above
    // pulls it back out, so it decays on its own (mag is given in px-ish
    // units, ~80 px per world unit at player depth)
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const m = this.shakeMag / 80;
      cam.x += (Math.random() * 2 - 1) * m;
      cam.y += (Math.random() * 2 - 1) * m;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }
  }
}
