// The elastic bungee cord. A capped spring + damping, plus a hard distance
// constraint — arcade-stable by construction: forces only ever pull the pair
// together, are clamped to maxTetherForce, and past maxLength positions are
// corrected directly instead of letting the spring fight the integrator.
class TetherSystem {
  constructor() {
    this.dist = 0;
    this.stretch = 0;
    this.state = 0;        // 0 slack, 1 tension, 2 high, 3 critical
    this.tension01 = 0;    // 0 at slack length .. 1 at max length
  }

  update(dt, a, b) {
    const T = CFG.tether;
    let dx = b.x - a.x;
    let dy = (b.y - a.y) * 0.6;   // height differences count less — feels better
    let dz = b.z - a.z;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.dist = dist;
    this.stretch = Math.max(0, dist - T.slackLength);
    this.tension01 = Phaser.Math.Clamp((dist - T.slackLength) / (T.maxLength - T.slackLength), 0, 1);
    this.state = dist < T.slackLength ? 0
      : dist < T.warningLength ? 1
      : dist < T.maxLength * 0.94 ? 2 : 3;

    if (dist < 0.001) return;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;

    if (this.stretch > 0) {
      // separation rate along the cord (positive = moving apart)
      const sep = (b.vx - a.vx) * ux + (b.vzExtra - a.vzExtra) * uz + (b.vy - a.vy) * uy;
      let f = this.stretch * T.springStrength + Math.max(0, sep) * T.damping;
      f = Math.min(f, T.maxTetherForce);

      // grounded runners grip the floor and feel less lateral yank —
      // that grip is what makes anchor saves possible
      const gripA = a.grounded ? CFG.ANCHOR_GRIP : 1;
      const gripB = b.grounded ? CFG.ANCHOR_GRIP : 1;

      a.vx += ux * f * dt * gripA;
      a.vzExtra += uz * f * dt;
      if (!a.grounded) a.vy += uy * f * dt * 0.55;

      b.vx -= ux * f * dt * gripB;
      b.vzExtra -= uz * f * dt;
      if (!b.grounded) b.vy -= uy * f * dt * 0.55;
    }

    // hard cap: past maxLength, pull positions back and kill separating velocity
    if (dist > T.maxLength) {
      const over = dist - T.maxLength;
      // the airborne/falling runner gives way; two grounded runners split it
      let wa = 0.5, wb = 0.5;
      if (a.grounded && !b.grounded) { wa = 0.12; wb = 0.88; }
      else if (!a.grounded && b.grounded) { wa = 0.88; wb = 0.12; }
      a.x += ux * over * wa; a.z += uz * over * wa;
      if (!a.grounded) a.y += uy * over * wa * 0.5;
      b.x -= ux * over * wb; b.z -= uz * over * wb;
      if (!b.grounded) b.y -= uy * over * wb * 0.5;

      const sep = (b.vx - a.vx) * ux + (b.vzExtra - a.vzExtra) * uz;
      if (sep > 0) {
        a.vx += ux * sep * wa; a.vzExtra += uz * sep * wa;
        b.vx -= ux * sep * wb; b.vzExtra -= uz * sep * wb;
      }
    }
  }
}
