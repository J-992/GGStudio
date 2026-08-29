import { Vector3 } from 'three';

/**
 * The small physics kernel the fight scenes run on.
 *
 * Three primitives, no engine. A ballistic body with a ground plane covers
 * everything that gets knocked off its feet or thrown; a critically damped
 * spring covers everything that should catch up to a target without ringing;
 * and an inertia tracker turns a transform's own motion into the lag and
 * overshoot that makes a body read as having mass.
 *
 * Two rules the whole module obeys:
 *   1. Nothing here draws from the seeded gameplay RNG. Physics is cosmetic,
 *      and a visual tweak must never reshuffle a run.
 *   2. Nothing here allocates per frame. Every vector is owned by the instance
 *      that uses it, because this runs on dozens of bodies at 60fps on phones.
 */

export interface BodyParams {
  gravity: number;
  /** Bounce, 0..1. How much vertical speed survives a floor hit. */
  restitution: number;
  /** Ground friction, 0..1 per bounce, applied to horizontal speed. */
  friction: number;
  /** Air drag applied to angular velocity, per second. */
  angularDamping: number;
  /** Speed below which a grounded body is considered at rest. */
  sleepSpeed: number;
  /** Distance from the body's origin to the floor when it lies flat. */
  radius: number;
  /** World-space height of the collision floor. */
  floorY: number;
}

export const DEFAULT_BODY: BodyParams = {
  gravity: 26,
  restitution: 0.34,
  friction: 0.66,
  angularDamping: 1.4,
  sleepSpeed: 0.4,
  radius: 0.22,
  floorY: 0,
};

/**
 * A launched body: ballistic flight, then a floor it can bounce, slide and
 * tumble along before coming to rest.
 *
 * This is the whole difference between a hit that throws a body and a hit that
 * slides a sprite off screen. The body arcs, lands, loses most of its energy to
 * the floor, rolls out the rest, and stops — so the aftermath of an exchange is
 * a scene with weight in it rather than a set of objects being faded out.
 */
export class RigidBody {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  /** Angular velocity in radians/second about each axis. */
  readonly angular = new Vector3();
  /** Accumulated rotation, applied by the owner to its Object3D. */
  readonly rotation = new Vector3();

  grounded = false;
  asleep = false;
  /** Bounces taken since launch — used to settle a body into a final pose. */
  bounces = 0;

  private params: BodyParams = DEFAULT_BODY;

  reset(params: Partial<BodyParams> = {}): void {
    this.params = { ...DEFAULT_BODY, ...params };
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.grounded = false;
    this.asleep = false;
    this.bounces = 0;
  }

  launch(
    from: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    spin: { x: number; y: number; z: number },
  ): void {
    this.position.set(from.x, from.y, from.z);
    this.velocity.set(velocity.x, velocity.y, velocity.z);
    this.angular.set(spin.x, spin.y, spin.z);
    this.grounded = false;
    this.asleep = false;
    this.bounces = 0;
  }

  /** Overrides gravity mid-flight, e.g. a slam driven down harder than thrown. */
  setGravityScale(scale: number): void {
    this.params = { ...this.params, gravity: DEFAULT_BODY.gravity * scale };
  }

  /** Moves this body's collision floor without affecting other bodies. */
  setFloorY(y: number): void {
    this.params.floorY = y;
  }

  step(dt: number): void {
    if (this.asleep || dt <= 0) return;

    this.velocity.y -= this.params.gravity * dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    this.rotation.x += this.angular.x * dt;
    this.rotation.y += this.angular.y * dt;
    this.rotation.z += this.angular.z * dt;

    const drag = Math.exp(-this.params.angularDamping * dt);
    this.angular.multiplyScalar(drag);

    const floor = this.params.floorY + this.params.radius;
    if (this.position.y <= floor) {
      this.position.y = floor;
      if (this.velocity.y < 0) {
        // Landing: most of the vertical energy goes into the floor, the rest
        // comes back as a bounce that shrinks every time.
        const impact = -this.velocity.y;
        this.velocity.y = impact * this.params.restitution;
        this.velocity.x *= this.params.friction;
        this.velocity.z *= this.params.friction;
        // Sliding converts some of the spin into the floor too.
        this.angular.multiplyScalar(this.params.friction);
        this.bounces += 1;
        if (this.velocity.y < this.params.sleepSpeed) this.velocity.y = 0;
      }
      this.grounded = true;

      // Rolling friction, so a body that lands does not slide forever.
      const roll = Math.exp(-2.6 * dt);
      this.velocity.x *= roll;
      this.velocity.z *= roll;

      const speed = Math.abs(this.velocity.x) + Math.abs(this.velocity.z) + Math.abs(this.velocity.y);
      if (speed < this.params.sleepSpeed && this.angular.lengthSq() < 0.5) {
        this.velocity.set(0, 0, 0);
        this.angular.multiplyScalar(0.5);
        if (this.angular.lengthSq() < 0.02) {
          this.angular.set(0, 0, 0);
          this.asleep = true;
        }
      }
    } else {
      this.grounded = false;
    }
  }

  /** Speed in metres/second, for driving secondary motion and effects. */
  get speed(): number {
    return this.velocity.length();
  }
}

/**
 * A critically damped spring: reaches its target quickly and never oscillates
 * past it unless `damping` is deliberately lowered.
 *
 * Used wherever something should FOLLOW rather than snap — a limb catching up
 * to the body that swung it, a head settling after a hit.
 */
export class Spring {
  value = 0;
  velocity = 0;

  constructor(
    private stiffness = 90,
    private damping = 18,
  ) {}

  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }

  configure(stiffness: number, damping: number): void {
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(target: number, dt: number): number {
    // Sub-stepped, because a stiff spring integrated in one large step diverges
    // rather than converging — and a stuttering browser frame hands back steps
    // large enough to do it. The cap is derived from the stiffness, so raising
    // stiffness cannot silently make the spring unstable.
    const maxStep = 1 / Math.max(60, Math.sqrt(this.stiffness) * 4);
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-6) {
      const h = Math.min(maxStep, remaining);
      const accel = (target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  /** Kicks the spring, e.g. an impact shoving a limb. */
  impulse(amount: number): void {
    this.velocity += amount;
  }
}

/**
 * Turns a transform's own movement into usable acceleration.
 *
 * A body that starts moving should leave its scarf, its head and its arms
 * behind for a moment, and a body that stops should let them swing through.
 * That lag is what separates a model being translated from a character moving,
 * and it costs one subtraction per frame.
 */
export class Inertia {
  private lastX = 0;
  private lastY = 0;
  private velX = 0;
  private velY = 0;
  /** Smoothed acceleration, the value secondary motion should react to. */
  accelX = 0;
  accelY = 0;
  started = false;

  reset(x = 0, y = 0): void {
    this.lastX = x;
    this.lastY = y;
    this.velX = 0;
    this.velY = 0;
    this.accelX = 0;
    this.accelY = 0;
    this.started = true;
  }

  step(x: number, y: number, dt: number): void {
    if (!this.started) {
      this.reset(x, y);
      return;
    }
    if (dt <= 1e-6) return;
    const vx = (x - this.lastX) / dt;
    const vy = (y - this.lastY) / dt;
    const ax = (vx - this.velX) / dt;
    const ay = (vy - this.velY) / dt;
    this.lastX = x;
    this.lastY = y;
    this.velX = vx;
    this.velY = vy;
    // Smoothed hard, because raw frame-to-frame acceleration is mostly noise.
    const blend = Math.min(1, dt * 12);
    this.accelX += (clamp(ax, -220, 220) - this.accelX) * blend;
    this.accelY += (clamp(ay, -220, 220) - this.accelY) * blend;
  }

  get velocityX(): number {
    return this.velX;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
