import * as THREE from 'three';

/**
 * Catnip Rush's rainbow trail, painted as a flat ribbon on the rooftop
 * rather than as particles.
 *
 * Replaces the particle-based version (`ParticlePool.catnipTrail()`), which
 * read as floating rainbow debris rather than a mark left on the ground. One
 * `THREE.Mesh` for the whole game, its geometry rewritten in place every
 * frame from a small fixed-capacity ring buffer of ground-anchored samples -
 * no per-frame allocation, no per-sample object, no second mesh ever
 * created. `capacity` bounds both the vertex count and the worst-case cost
 * regardless of how long Catnip Rush runs.
 *
 * Ground-anchored, not cat-anchored: each sample takes its Y from
 * `PlayerController.lastGroundY` (the same anchor `Game.cameraTarget()`
 * uses), not the cat's raw position - so a jump's arc never lifts the trail
 * off the deck, and a roof-tier step (trampoline up, parapet down) is simply
 * whatever `lastGroundY` reads at the moment that stretch of trail was laid,
 * exactly like the deck itself. X/Z come straight from the cat's actual
 * world position, so a turn's curve is inherited for free rather than
 * re-derived from the route.
 */

/** Ring-buffer capacity. Bounds the worst-case vertex count (2 per sample)
 *  and, with `SAMPLE_MIN_DISTANCE`, the worst-case trail length - a hard cap
 *  independent of frame rate or how long the effect has been running. */
export const MAX_SAMPLES = 48;
/** Minimum world-space distance between consecutive samples. Keeps vertex
 *  density roughly constant across the range of speeds the trail can be laid
 *  at (base run speed, the difficulty ramp, Catnip's own boost stacked on
 *  top) rather than spiking on faster frames. */
export const SAMPLE_MIN_DISTANCE = 0.35;
/** Seconds a sample lives before it drops out of the trail. Governs both the
 *  ordinary trailing length (age-out from the tail while still emitting) and
 *  how long the whole ribbon takes to disappear once Catnip Rush ends and
 *  emission stops - see `update()`'s own comment. */
export const MAX_AGE = 0.7;
/** Half-width of the ribbon. Narrow on purpose - a mark on the ground, not a
 *  lane-wide carpet. */
const HALF_WIDTH = 0.18;
/** Lifted this far above `lastGroundY` - otherwise every sample sits exactly
 *  coplanar with the deck's own top face (both derive from the same surface
 *  Y with zero separation), which is a textbook Z-fight the material's
 *  `renderOrder`/`depthWrite:false` alone only partially hide. Small enough
 *  that the ribbon still reads as painted on the roof, not floating above it. */
const TRAIL_Y_EPSILON = 0.03;
/**
 * How far two consecutive samples' Y can differ before they're treated as
 * straddling a roof-tier seam rather than an ordinary bit of uneven ground.
 * `lastGroundY` freezes at the old deck's height for the whole time the cat
 * is airborne, then snaps straight to the new tier's height the instant it
 * lands (no interpolation) - so a jump across a tier change can otherwise
 * leave two samples a full `ROOF_TIER_HEIGHT` step (3 or 6 world units)
 * apart, and the ribbon would draw one continuous quad connecting them: a
 * near-vertical wall poking through whatever parapet/facade sits at that
 * seam. Comfortably above any normal per-sample Y delta on a single tier.
 */
const TIER_SEAM_THRESHOLD = 1.0;
/** Hue advance per new sample - small enough that the rainbow reads as one
 *  smooth gradient along the ribbon's length rather than banding. */
const HUE_STEP = 0.05;

const _dir = new THREE.Vector3();
const _left = new THREE.Vector3();
const _color = new THREE.Color();

interface Sample {
  readonly position: THREE.Vector3;
  hue: number;
  age: number;
}

/**
 * Builds the shared alpha-fade lookup: opaque at u=1 (freshly laid, nearest
 * the cat), transparent at u=0 (about to age out). Vertex colour alone
 * carries the rainbow; this is the only thing that needs a texture, and one
 * row is enough since it is sampled by `ageFraction` alone.
 *
 * Returns null outside a DOM (the test suite runs in plain Node, same as
 * every other canvas-texture builder in this game) - the caller falls back
 * to a flat, unfaded ribbon rather than failing to build one at all.
 */
function buildFadeTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class CatnipGroundTrail {
  readonly mesh: THREE.Mesh;
  /** Set false by the low graphics-quality setting, same switch
   *  `ParticlePool.enabled` already answers to. */
  enabled = true;

  private readonly geometry: THREE.BufferGeometry;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly fadeTexture: THREE.CanvasTexture | null;

  // Fixed pool of sample objects, reused for the life of the game - see the
  // class doc comment. `active` holds the currently-live ones in
  // chronological order (oldest first); `free` holds everything else.
  private readonly pool: Sample[];
  private active: Sample[] = [];
  private free: Sample[];

  constructor(scene: THREE.Object3D) {
    this.pool = Array.from({ length: MAX_SAMPLES }, () => ({
      position: new THREE.Vector3(),
      hue: 0,
      age: 0,
    }));
    this.free = this.pool.slice();

    const vertexCount = MAX_SAMPLES * 2;
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.uvAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setAttribute('uv', this.uvAttr);

    // Static index pattern for a triangle-strip-as-triangles ribbon: rung i's
    // two vertices (2i, 2i+1) join rung i+1's (2i+2, 2i+3). Valid for any
    // active sample count up to MAX_SAMPLES since rungs are always written
    // starting at vertex 0 - only the draw range changes frame to frame.
    const indices = new Uint16Array((MAX_SAMPLES - 1) * 6);
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const v = i * 2;
      const o = i * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 3;
      indices[o + 5] = v + 2;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.fadeTexture = buildFadeTexture();
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaMap: this.fadeTexture,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Called once a frame regardless of Catnip Rush's state. `active` gates
   * new emission only - ageing/removal always runs, which is the entire
   * removal mechanism: the instant Catnip Rush ends, the caller simply stops
   * passing `active: true`, the tail keeps ageing out on its own `MAX_AGE`
   * clock, and the last sample is gone within `MAX_AGE` seconds with no
   * separate "stop" path to get wrong.
   *
   * @param groundPos world position to sample from when emitting - already
   *   ground-anchored (`x`/`z` from the cat, `y` from `lastGroundY`) by the
   *   caller, so this file never has to know about the player controller.
   * @param grounded whether the cat is currently on the ground. Gates new
   *   samples the same way `active` does: while airborne, `lastGroundY` is
   *   frozen at the deck the cat left, so laying samples mid-jump would just
   *   pack extra points onto the takeoff deck's own height and then jump
   *   straight to the landing deck's height on the next grounded sample -
   *   see `TIER_SEAM_THRESHOLD`'s own comment for the wall that produces at
   *   a tier change. Not sampling at all while airborne means the trail
   *   naturally gaps across a jump and resumes cleanly on landing instead.
   */
  update(dt: number, active: boolean, groundPos: THREE.Vector3, grounded: boolean): void {
    for (const s of this.active) s.age += dt;

    while (this.active.length > 0 && this.active[0].age > MAX_AGE) {
      this.free.push(this.active.shift()!);
    }

    if (active && this.enabled && grounded) {
      const last = this.active[this.active.length - 1];

      // A short hop (not long enough to age every pre-jump sample out on its
      // own) can still land on a different tier while old samples are live -
      // restart the ribbon rather than bridge two tiers with a wall.
      if (last && Math.abs(groundPos.y - last.position.y) > TIER_SEAM_THRESHOLD) {
        while (this.active.length > 0) this.free.push(this.active.shift()!);
      }

      const newLast = this.active[this.active.length - 1];
      if (!newLast || newLast.position.distanceTo(groundPos) >= SAMPLE_MIN_DISTANCE) {
        // Capacity is a hard cap: once the pool is empty, recycle the
        // oldest live sample rather than growing - a shorter trail on an
        // exceptionally long Catnip Rush, never more vertices than budgeted.
        const sample = this.free.pop() ?? this.active.shift()!;
        sample.position.copy(groundPos);
        sample.position.y += TRAIL_Y_EPSILON;
        sample.hue = (newLast ? newLast.hue : 0) + HUE_STEP;
        if (sample.hue >= 1) sample.hue -= 1;
        sample.age = 0;
        this.active.push(sample);
      }
    }

    this.rebuild();
  }

  private rebuild(): void {
    const n = this.active.length;
    if (!this.enabled || n < 2) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    this.mesh.visible = true;

    const positions = this.positionAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;
    const uvs = this.uvAttr.array as Float32Array;

    for (let i = 0; i < n; i++) {
      const sample = this.active[i];
      const prev = this.active[Math.max(0, i - 1)];
      const next = this.active[Math.min(n - 1, i + 1)];
      _dir.subVectors(next.position, prev.position);
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
      _dir.normalize();
      _left.set(_dir.z, 0, -_dir.x);
      if (_left.lengthSq() < 1e-6) _left.set(1, 0, 0);
      _left.multiplyScalar(HALF_WIDTH);

      const p = sample.position;
      const v0 = i * 2 * 3;
      positions[v0] = p.x + _left.x;
      positions[v0 + 1] = p.y + _left.y;
      positions[v0 + 2] = p.z + _left.z;
      positions[v0 + 3] = p.x - _left.x;
      positions[v0 + 4] = p.y - _left.y;
      positions[v0 + 5] = p.z - _left.z;

      _color.setHSL(sample.hue, 0.85, 0.6);
      const c0 = i * 2 * 3;
      colors[c0] = _color.r;
      colors[c0 + 1] = _color.g;
      colors[c0 + 2] = _color.b;
      colors[c0 + 3] = _color.r;
      colors[c0 + 4] = _color.g;
      colors[c0 + 5] = _color.b;

      // ageFraction: 0 = about to expire (tail, transparent), 1 = just laid
      // (head, opaque) - see buildFadeTexture()'s own comment.
      const ageFraction = 1 - Math.min(1, sample.age / MAX_AGE);
      const u0 = i * 2 * 2;
      uvs[u0] = ageFraction;
      uvs[u0 + 1] = 0;
      uvs[u0 + 2] = ageFraction;
      uvs[u0 + 3] = 1;
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
    this.geometry.computeBoundingSphere();
  }

  /** Drops every live sample instantly - a full run teardown/restart, not
   *  the ordinary end-of-Catnip fade `update()` already handles on its own. */
  clear(): void {
    while (this.active.length > 0) this.free.push(this.active.shift()!);
    this.mesh.visible = false;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.fadeTexture?.dispose();
  }
}
