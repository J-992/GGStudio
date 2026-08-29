import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../config';

/**
 * Gameplay camera.
 *
 * Both approach lanes must stay visible at all times, so the rig only ever
 * *adds* impulse to a fixed framing and always decays back. Trauma-based shake
 * (squared falloff) keeps a Perfect punchy without ever making the next threat
 * unreadable — the shake is gone well inside one approach.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  private trauma = 0;
  private punch = 0;
  private punchVel = 0;
  private impulse = new Vector3();
  private flowAmount = 0;
  private flowTarget = 0;
  private portrait = false;
  private time = 0;
  private readonly lookAt = new Vector3(0, CAMERA.lookHeight, 0);
  private readonly basePos = new Vector3();
  private cineAmount = 0;
  private cineTarget = 0;
  private readonly cinePos = new Vector3();
  private readonly cineLook = new Vector3();
  private readonly cineTmp = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAMERA.fov.landscape, aspect, 0.1, 120);
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.portrait = height > width;
    this.camera.aspect = width / height;
    this.camera.fov = this.portrait ? CAMERA.fov.portrait : CAMERA.fov.landscape;
    // Narrow viewports lose horizontal room first, so pull back proportionally
    // to keep both lanes inside the frustum instead of cropping them.
    const wide = MathUtils.clamp(this.camera.aspect / 1.6, 0.62, 1.15);
    this.pullback = this.portrait ? 1.18 / wide : 1 / wide;
    this.camera.updateProjectionMatrix();
  }

  private pullback = 1;

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Directional kick — pushes the frame toward the struck side. */
  addImpulse(x: number, strength: number): void {
    this.impulse.x += x * strength;
    this.punchVel -= strength;
  }

  setFlow(active: boolean): void {
    this.flowTarget = active ? 1 : 0;
  }

  /** Hands the frame to an authored cinematic shot (the death reel). */
  setCinematic(active: boolean): void {
    this.cineTarget = active ? 1 : 0;
  }

  /** Where the cinematic shot wants the camera this frame. */
  cineShot(px: number, py: number, pz: number, lx: number, ly: number, lz: number): void {
    this.cinePos.set(px, py, pz);
    this.cineLook.set(lx, ly, lz);
  }

  update(dtReal: number, focusX: number): void {
    this.time += dtReal;

    this.trauma = Math.max(0, this.trauma - dtReal * CAMERA.traumaDecay);
    this.flowAmount += (this.flowTarget - this.flowAmount) * Math.min(1, dtReal * 4.5);

    // Spring the dolly punch back to rest.
    this.punchVel += -this.punch * 190 * dtReal;
    this.punchVel *= Math.exp(-dtReal * 11);
    this.punch += this.punchVel * dtReal;

    this.impulse.multiplyScalar(Math.exp(-dtReal * 7));

    const distance =
      CAMERA.distance[this.portrait ? 'portrait' : 'landscape'] *
      this.pullback *
      MathUtils.lerp(1, CAMERA.flowDistanceScale, this.flowAmount);
    const height = CAMERA.height * MathUtils.lerp(1, CAMERA.flowHeightScale, this.flowAmount);

    this.basePos.set(
      Math.sin(CAMERA.yawOffset) * distance + focusX * 0.14,
      height,
      Math.cos(CAMERA.yawOffset) * distance + this.punch,
    );

    // Squared trauma so small hits stay subtle and Perfects feel earned.
    const shake = this.trauma * this.trauma * CAMERA.shakeAmplitude;
    const t = this.time * 34;
    this.camera.position.set(
      this.basePos.x + this.impulse.x + Math.sin(t) * shake,
      this.basePos.y + this.impulse.y + Math.sin(t * 1.37 + 1.1) * shake * 0.7,
      this.basePos.z + Math.sin(t * 0.83 + 2.3) * shake * 0.4,
    );

    this.lookAt.set(focusX * 0.25 + this.impulse.x * 0.4, CAMERA.lookHeight, 0);

    // Cinematic override: blend toward the authored shot but keep a taste of
    // the live shake and impulse so strikes still kick the frame.
    this.cineAmount += (this.cineTarget - this.cineAmount) * Math.min(1, dtReal * 3.2);
    if (this.cineAmount > 0.001) {
      this.cineTmp.set(
        this.cinePos.x + this.impulse.x * 0.6 + Math.sin(t) * shake * 0.6,
        this.cinePos.y + Math.sin(t * 1.37 + 1.1) * shake * 0.4,
        this.cinePos.z,
      );
      this.camera.position.lerp(this.cineTmp, this.cineAmount);
      this.lookAt.lerp(this.cineLook, this.cineAmount);
    }
    this.camera.lookAt(this.lookAt);
  }

  /** Snaps the rig back to neutral, used when a run restarts. */
  reset(): void {
    this.trauma = 0;
    this.punch = 0;
    this.punchVel = 0;
    this.impulse.set(0, 0, 0);
    this.flowAmount = 0;
    this.flowTarget = 0;
    this.cineAmount = 0;
    this.cineTarget = 0;
  }
}
