// Fixed-size instanced particle pool for hit sparks/muzzle flashes, plus a
// small pool of stretched-box tracers for hitscan shots. One draw call per
// pool regardless of how many effects are alive — the free-list + zero-scale-
// to-hide pattern is a port of `cat-runner/src/effects/ParticlePool.ts`,
// simplified: particles here are small tumbling cubes rather than camera-
// facing quads, so `update(dt)` never needs a camera reference.
import * as THREE from 'three';

const MAX_PARTICLES = 256;
const MAX_TRACERS = 32;
const TRACER_LIFE_S = 0.06;

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _color = new THREE.Color();

class Particle {
  constructor() {
    this.active = false;
    this.life = 0;
    this.maxLife = 1;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.rotation = new THREE.Euler();
    this.spin = new THREE.Vector3();
    this.startSize = 0.15;
    this.gravity = -9;
    this.drag = 1.5;
  }
}

class Tracer {
  constructor() {
    this.active = false;
    this.life = 0;
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.thickness = 0.03;
  }
}

export class Effects {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene;

    const particleGeom = new THREE.BoxGeometry(1, 1, 1);
    const particleMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this._particleMesh = new THREE.InstancedMesh(particleGeom, particleMat, MAX_PARTICLES);
    this._particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this._particleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._particleMesh.frustumCulled = false;
    this._particleMesh.count = MAX_PARTICLES;
    scene.add(this._particleMesh);

    const tracerGeom = new THREE.BoxGeometry(1, 1, 1);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.85, depthWrite: false });
    this._tracerMesh = new THREE.InstancedMesh(tracerGeom, tracerMat, MAX_TRACERS);
    this._tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._tracerMesh.frustumCulled = false;
    this._tracerMesh.count = MAX_TRACERS;
    scene.add(this._tracerMesh);

    /** @type {Particle[]} */
    this._particles = Array.from({ length: MAX_PARTICLES }, () => new Particle());
    /** @type {number[]} */
    this._freeParticles = [];
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) {
      this._freeParticles.push(i);
      this._particleMesh.setMatrixAt(i, _zeroScale);
    }
    this._particleMesh.instanceMatrix.needsUpdate = true;

    /** @type {Tracer[]} */
    this._tracers = Array.from({ length: MAX_TRACERS }, () => new Tracer());
    /** @type {number[]} */
    this._freeTracers = [];
    for (let i = MAX_TRACERS - 1; i >= 0; i--) {
      this._freeTracers.push(i);
      this._tracerMesh.setMatrixAt(i, _zeroScale);
    }
    this._tracerMesh.instanceMatrix.needsUpdate = true;

    this._counter = 0;
  }

  /**
   * @returns {number} A slot index, stealing the oldest active one when the pool is full.
   */
  _acquireParticle() {
    let index = this._freeParticles.pop();
    if (index === undefined) {
      // Pool exhausted: steal the particle nearest death rather than drop
      // the new effect, so a heavy moment never silently stops emitting.
      let best = 0;
      let bestLife = Infinity;
      for (let i = 0; i < this._particles.length; i++) {
        if (this._particles[i].life < bestLife) {
          bestLife = this._particles[i].life;
          best = i;
        }
      }
      index = best;
    }
    return index;
  }

  /**
   * Generic radial burst — hit sparks, kill puffs.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} color Hex.
   * @param {number} n Particle count.
   */
  burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      const index = this._acquireParticle();
      const p = this._particles[index];
      p.active = true;
      p.position.set(x, y, z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const speed = 2 + Math.random() * 3;
      p.velocity.set(
        Math.cos(theta) * Math.sin(phi) * speed,
        Math.cos(phi) * speed,
        Math.sin(theta) * Math.sin(phi) * speed,
      );
      p.maxLife = 0.25 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.startSize = 0.08 + Math.random() * 0.06;
      p.gravity = -9;
      p.drag = 2.2;
      p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      p.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      _color.setHex(color);
      this._particleMesh.setColorAt(index, _color);
    }
  }

  /**
   * Muzzle flash: one bright, very short-lived particle.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  flash(x, y, z) {
    const index = this._acquireParticle();
    const p = this._particles[index];
    p.active = true;
    p.position.set(x, y, z);
    p.velocity.set(0, 0, 0);
    p.maxLife = 0.06;
    p.life = p.maxLife;
    p.startSize = 0.22;
    p.gravity = 0;
    p.drag = 0;
    p.rotation.set(0, 0, 0);
    p.spin.set(0, 0, 0);
    _color.setHex(0xfff2c8);
    this._particleMesh.setColorAt(index, _color);
  }

  /**
   * A short-lived hitscan tracer from `a` to `b`.
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   */
  tracer(a, b) {
    let index = this._freeTracers.pop();
    if (index === undefined) {
      // Pool exhausted: reuse slot 0 rather than drop the shot.
      index = 0;
    }
    const t = this._tracers[index];
    t.active = true;
    t.life = TRACER_LIFE_S;
    t.a.copy(a);
    t.b.copy(b);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    let particlesTouched = false;
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      if (!p.active) continue;
      particlesTouched = true;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._freeParticles.push(i);
        this._particleMesh.setMatrixAt(i, _zeroScale);
        continue;
      }

      p.velocity.y += p.gravity * dt;
      const damping = Math.exp(-p.drag * dt);
      p.velocity.multiplyScalar(damping);
      p.position.addScaledVector(p.velocity, dt);
      p.rotation.x += p.spin.x * dt;
      p.rotation.y += p.spin.y * dt;
      p.rotation.z += p.spin.z * dt;

      const t = p.life / p.maxLife;
      const size = p.startSize * (0.3 + t * 0.7);
      _quat.setFromEuler(p.rotation);
      _scale.setScalar(size);
      _matrix.compose(p.position, _quat, _scale);
      this._particleMesh.setMatrixAt(i, _matrix);
    }
    if (particlesTouched || this._freeParticles.length < MAX_PARTICLES) {
      this._particleMesh.instanceMatrix.needsUpdate = true;
      if (this._particleMesh.instanceColor) this._particleMesh.instanceColor.needsUpdate = true;
    }

    let tracersTouched = false;
    for (let i = 0; i < this._tracers.length; i++) {
      const t = this._tracers[i];
      if (!t.active) continue;
      tracersTouched = true;

      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        this._freeTracers.push(i);
        this._tracerMesh.setMatrixAt(i, _zeroScale);
        continue;
      }

      _dir.subVectors(t.b, t.a);
      const length = Math.max(1e-4, _dir.length());
      _dir.normalize();
      _mid.addVectors(t.a, t.b).multiplyScalar(0.5);
      _quat.setFromUnitVectors(_up, _dir);
      _scale.set(t.thickness, length, t.thickness);
      _matrix.compose(_mid, _quat, _scale);
      this._tracerMesh.setMatrixAt(i, _matrix);
    }
    if (tracersTouched || this._freeTracers.length < MAX_TRACERS) {
      this._tracerMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this._particleMesh.geometry.dispose();
    this._particleMesh.material.dispose();
    this._particleMesh.removeFromParent();
    this._tracerMesh.geometry.dispose();
    this._tracerMesh.material.dispose();
    this._tracerMesh.removeFromParent();
  }
}
