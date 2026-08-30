import * as THREE from 'three';

/**
 * Fixed-size instanced particle pool.
 *
 * One InstancedMesh draws every particle in the game in a single call. Slots
 * are recycled from a free list, and dead particles are hidden by writing a
 * zero-scale matrix rather than by resizing the buffer - so the update loop
 * allocates nothing and the draw call count never changes.
 *
 * When the pool is exhausted the oldest particle is reused. Dropping the new
 * particle instead would make heavy moments (a big collision) silently stop
 * emitting, which looks worse than a slightly shortened tail on an old one.
 */

const MAX_PARTICLES = 320;

/**
 * Fraction of viewport height at which a single quad starts to fade out, and
 * at which it is gone entirely. Dust normally projects to well under 10% of the
 * screen; anything approaching a third of it is a particle sitting on the lens.
 */
const LENS_FADE_START = 0.1;
const LENS_FADE_END = 0.28;

interface Particle {
  active: boolean;
  life: number;
  maxLife: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: number;
  rotation: number;
  size: number;
  startSize: number;
  color: THREE.Color;
  /** Peak opacity, before the lifetime fade is applied. */
  alpha: number;
  gravity: number;
  drag: number;
  /** Frame counter at spawn, used to pick a victim when the pool is full. */
  age: number;
}

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);
const _tmp = new THREE.Vector3();

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;

  private particles: Particle[] = [];
  private free: number[] = [];
  private counter = 0;
  private alphaAttr: THREE.InstancedBufferAttribute;

  /** Set false by the low graphics-quality setting. */
  enabled = true;

  constructor(scene: THREE.Object3D) {
    // A flat quad is enough - these are small, fast-moving and short-lived.
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    // One shared material means one `opacity`, so per-particle transparency is
    // injected as an instanced attribute. It also lets a particle fade out to
    // transparent instead of darkening toward black, which matters now that the
    // dust is a pale colour.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;',
        );
    };

    const alphas = new Float32Array(MAX_PARTICLES);
    this.alphaAttr = new THREE.InstancedBufferAttribute(alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = MAX_PARTICLES;

    const colors = new Float32Array(MAX_PARTICLES * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: 0,
        rotation: 0,
        size: 0,
        startSize: 0,
        color: new THREE.Color(),
        alpha: 1,
        gravity: -9,
        drag: 1.4,
        age: 0,
      });
      this.free.push(i);
      // Start every slot collapsed so nothing is visible before first use.
      _matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  // -------------------------------------------------------------------------
  // Emission
  // -------------------------------------------------------------------------

  /** Generic radial burst - collisions, debris, breaking props. */
  burst(position: THREE.Vector3, count: number, color: number, speed = 4): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;

      p.position.copy(position);
      p.velocity
        .set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.8));

      p.maxLife = 0.5 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.startSize = 0.18 + Math.random() * 0.16;
      p.size = p.startSize;
      p.spin = (Math.random() - 0.5) * 12;
      p.rotation = Math.random() * Math.PI;
      p.gravity = -11;
      p.drag = 1.6;
      p.color.setHex(color);
    }
  }

  /**
   * Dust kicked up by a slide. Emitted along the slide direction so the trail
   * sits behind the cat rather than around it.
   */
  slideDust(position: THREE.Vector3, direction: THREE.Vector3, intensity: number): void {
    if (!this.enabled) return;
    // Rate-limited by the caller; one particle per call keeps the trail even.
    const p = this.acquire();
    if (!p) return;

    p.position.copy(position);
    p.position.x += (Math.random() - 0.5) * 0.4;
    p.position.z += (Math.random() - 0.5) * 0.4;

    _tmp.copy(direction).multiplyScalar(-1.4 * intensity);
    p.velocity.set(
      _tmp.x + (Math.random() - 0.5) * 1.2,
      0.6 + Math.random() * 0.9,
      _tmp.z + (Math.random() - 0.5) * 1.2,
    );

    p.maxLife = 0.45 + Math.random() * 0.3;
    p.life = p.maxLife;
    p.startSize = 0.3 + Math.random() * 0.25;
    p.size = p.startSize;
    p.spin = (Math.random() - 0.5) * 5;
    p.rotation = Math.random() * Math.PI;
    p.gravity = -2.2;
    p.drag = 2.4;
    // Pale and thin, so the trail reads as airborne dust rather than as solid
    // chips of debris.
    p.color.setHex(0xf3ecdd);
    p.alpha = 0.45;
  }

  /** Paw prints puffed out on a clean landing. */
  pawPrints(position: THREE.Vector3, forward: THREE.Vector3): void {
    if (!this.enabled) return;
    for (let i = 0; i < 4; i++) {
      const p = this.acquire();
      if (!p) return;

      const side = i % 2 === 0 ? -0.22 : 0.22;
      const back = Math.floor(i / 2) * -0.3;

      p.position.copy(position);
      p.position.x += forward.z * side + forward.x * back;
      p.position.z += -forward.x * side + forward.z * back;
      p.position.y += 0.05;

      p.velocity.set(0, 0.35, 0);
      p.maxLife = 0.55;
      p.life = p.maxLife;
      p.startSize = 0.22;
      p.size = p.startSize;
      p.spin = 0;
      p.rotation = Math.atan2(forward.x, forward.z);
      p.gravity = 0;
      p.drag = 4;
      p.color.setHex(0xfff8ec);
      p.alpha = 0.5;
    }
  }

  /** Slow rising sparkle around an uncollected fish token. */
  sparkle(position: THREE.Vector3): void {
    if (!this.enabled) return;
    const p = this.acquire();
    if (!p) return;

    p.position.copy(position);
    p.position.x += (Math.random() - 0.5) * 1.1;
    p.position.y += (Math.random() - 0.5) * 0.9;
    p.position.z += (Math.random() - 0.5) * 1.1;

    p.velocity.set(0, 0.5 + Math.random() * 0.4, 0);
    p.maxLife = 0.9;
    p.life = p.maxLife;
    p.startSize = 0.13;
    p.size = p.startSize;
    p.spin = 3;
    p.rotation = Math.random() * Math.PI;
    p.gravity = 0;
    p.drag = 1;
    p.color.setHex(0xffe08a);
  }

  /**
   * Warm embers drifting up and outward - Nine Lives' one-shot pickup
   * flourish. Nine Lives is instant (no active/duration state in
   * `PowerUpManager` to gate an ongoing effect on - see `Game.ts`'s pickup
   * handling), so this fires once at the moment of pickup rather than
   * tracking "while active." Positive `gravity` is deliberate and unique to
   * this emitter: `update()`'s integration does `velocity.y += gravity * dt`,
   * so embers keep drifting *up* instead of arcing back down like every
   * other emitter here.
   */
  embers(position: THREE.Vector3, count = 12, color = 0xff8a3d): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;

      p.position.copy(position);
      p.position.x += (Math.random() - 0.5) * 0.6;
      p.position.z += (Math.random() - 0.5) * 0.6;

      const angle = Math.random() * Math.PI * 2;
      const outward = 0.6 + Math.random() * 0.8;
      p.velocity.set(Math.cos(angle) * outward, 1.2 + Math.random() * 1.1, Math.sin(angle) * outward);

      p.maxLife = 1.8 + Math.random() * 0.7;
      p.life = p.maxLife;
      p.startSize = 0.16 + Math.random() * 0.08;
      p.size = p.startSize;
      p.spin = (Math.random() - 0.5) * 4;
      p.rotation = Math.random() * Math.PI;
      p.gravity = 0.6;
      p.drag = 1.1;
      p.color.setHex(color);
    }
  }

  /** Feathers from a startled pigeon. */
  feathers(position: THREE.Vector3, count = 5): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;

      p.position.copy(position);
      p.velocity.set(
        (Math.random() - 0.5) * 2.4,
        Math.random() * 1.4,
        (Math.random() - 0.5) * 2.4,
      );

      p.maxLife = 1.4 + Math.random() * 0.8;
      p.life = p.maxLife;
      p.startSize = 0.16;
      p.size = p.startSize;
      p.spin = (Math.random() - 0.5) * 7;
      p.rotation = Math.random() * Math.PI;
      // Feathers flutter: near-zero gravity plus heavy drag.
      p.gravity = -0.9;
      p.drag = 3.2;
      p.color.setHex(0xf0ece4);
    }
  }

  // -------------------------------------------------------------------------

  /**
   * @param dt     real frame delta - particles are cosmetic and run at render rate
   * @param camera used to billboard the quads and to fade the ones on the lens
   */
  update(dt: number, camera: THREE.Camera): void {
    const colorAttr = this.mesh.instanceColor!;
    const alphaAttr = this.alphaAttr;
    const cameraQuaternion = camera.quaternion;

    // Half-height of the view volume one unit from the eye, for the lens fade.
    const persp = camera as THREE.PerspectiveCamera;
    const tanHalfFov = persp.isPerspectiveCamera
      ? Math.tan(THREE.MathUtils.degToRad(persp.fov) * 0.5)
      : 0.5;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.free.push(i);
        _matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _matrix);
        continue;
      }

      p.velocity.y += p.gravity * dt;
      const damping = Math.exp(-p.drag * dt);
      p.velocity.multiplyScalar(damping);
      p.position.addScaledVector(p.velocity, dt);
      p.rotation += p.spin * dt;

      // Fade and shrink together over the back half of the lifetime.
      const t = p.life / p.maxLife;
      p.size = p.startSize * (0.35 + t * 0.65);

      // Billboard toward the camera, then roll about the view axis.
      _roll.setFromAxisAngle(_axis, p.rotation);
      _quat.copy(cameraQuaternion).multiply(_roll);
      _scale.setScalar(p.size);

      _matrix.compose(p.position, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);

      const fade = Math.min(1, t * 1.8);

      // Every emitter spawns at the cat, and the follow camera is pulled in to
      // barely a unit behind it in tight corners - so a particle can drift onto
      // the lens and smear one quad across a fifth of the screen, which reads as
      // a grey slab rather than as dust. Fade by *projected* size, so ordinary
      // dust is untouched however close the camera happens to be.
      const dist = Math.max(p.position.distanceTo(camera.position), 1e-4);
      const screenFraction = p.size / (2 * dist * tanHalfFov);
      const lensFade =
        1 - THREE.MathUtils.smoothstep(screenFraction, LENS_FADE_START, LENS_FADE_END);

      colorAttr.setXYZ(i, p.color.r, p.color.g, p.color.b);
      alphaAttr.setX(i, p.alpha * fade * lensFade);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  /** Retires every live particle. Used on level restart. */
  clear(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.active = false;
      this.free.push(i);
      _matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get activeCount(): number {
    return MAX_PARTICLES - this.free.length;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }

  private acquire(): Particle | null {
    let index = this.free.pop();

    if (index === undefined) {
      // Pool exhausted - steal the oldest live particle.
      let oldest = 0;
      let oldestAge = Infinity;
      for (let i = 0; i < this.particles.length; i++) {
        if (this.particles[i].age < oldestAge) {
          oldestAge = this.particles[i].age;
          oldest = i;
        }
      }
      index = oldest;
    }

    const p = this.particles[index];
    p.active = true;
    p.age = this.counter++;
    // Emitters opt into transparency; everything else stays fully opaque.
    p.alpha = 1;
    return p;
  }
}
