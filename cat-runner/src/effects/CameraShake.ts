import * as THREE from 'three';

/**
 * Trauma-based camera shake.
 *
 * Callers add "trauma" (0..1); the visible shake is trauma squared, so small
 * bumps stay subtle while big hits are dramatic. Trauma decays linearly, which
 * reads better than an exponential falloff for short impacts.
 *
 * Offsets are driven by sampled value noise rather than Math.random() per frame
 * so the motion is smooth instead of buzzy.
 */
export class CameraShake {
  private trauma = 0;
  private time = 0;

  /** Scales all output. Driven by the "Reduced Screen Shake" setting. */
  intensityScale = 1;

  readonly positionOffset = new THREE.Vector3();
  readonly rotationOffset = new THREE.Euler();

  private seeds = [Math.random() * 100, Math.random() * 100, Math.random() * 100];

  /** @param amount trauma to add, 0..1. Accumulates and clamps. */
  add(amount: number): void {
    this.trauma = THREE.MathUtils.clamp(this.trauma + amount, 0, 1);
  }

  update(dt: number, maxPosition = 0.35, maxRotation = 0.06): void {
    this.time += dt;

    if (this.trauma <= 0) {
      this.positionOffset.set(0, 0, 0);
      this.rotationOffset.set(0, 0, 0);
      return;
    }

    // Decay: ~1.6 trauma per second, so a full-strength hit clears in ~0.6s.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    const shake = this.trauma * this.trauma * this.intensityScale;
    const f = this.time * 22;

    this.positionOffset.set(
      noise(f + this.seeds[0]) * maxPosition * shake,
      noise(f + this.seeds[1]) * maxPosition * shake,
      noise(f + this.seeds[2]) * maxPosition * shake * 0.5,
    );

    this.rotationOffset.set(
      noise(f * 0.8 + this.seeds[1]) * maxRotation * shake,
      noise(f * 0.8 + this.seeds[2]) * maxRotation * shake,
      noise(f * 0.8 + this.seeds[0]) * maxRotation * shake,
    );
  }

  reset(): void {
    this.trauma = 0;
    this.positionOffset.set(0, 0, 0);
    this.rotationOffset.set(0, 0, 0);
  }

  get active(): boolean {
    return this.trauma > 0;
  }
}

/** Cheap smooth value noise in [-1, 1]. */
function noise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f); // smoothstep
  return THREE.MathUtils.lerp(hash(i), hash(i + 1), s) * 2 - 1;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
