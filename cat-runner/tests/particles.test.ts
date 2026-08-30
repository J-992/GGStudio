import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticlePool } from '../src/effects/ParticlePool';

/**
 * `ParticlePool` needs no WebGL context - `update()`'s camera usage is just
 * plain `.quaternion`/`.position`/`.fov` properties - so it can be exercised
 * headlessly.
 */
describe('ParticlePool', () => {
  it('embers() spawns the requested count and they die out within maxLife', () => {
    const pool = new ParticlePool(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, -10);

    pool.embers(new THREE.Vector3(0, 1, 0), 5);
    expect(pool.activeCount).toBe(5);

    // Comfortably longer than embers()'s longest possible maxLife (2.5s).
    for (let i = 0; i < 200; i++) pool.update(1 / 60, camera);

    expect(pool.activeCount).toBe(0);
  });

  it('embers() drifts upward rather than falling, unlike every other emitter', () => {
    const pool = new ParticlePool(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, -10);

    const origin = new THREE.Vector3(0, 1, 0);
    pool.embers(origin, 1);

    const readActiveY = (): number => {
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      for (let i = 0; i < pool.mesh.count; i++) {
        pool.mesh.getMatrixAt(i, matrix);
        matrix.decompose(position, quat, scale);
        if (scale.x > 0) return position.y;
      }
      throw new Error('no active particle found');
    };

    pool.update(1 / 60, camera);
    const early = readActiveY();
    for (let i = 0; i < 15; i++) pool.update(1 / 60, camera);
    const later = readActiveY();

    expect(later).toBeGreaterThan(early);
    pool.dispose();
  });

  it('does nothing when disabled (low graphics quality)', () => {
    const pool = new ParticlePool(new THREE.Scene());
    pool.enabled = false;
    pool.embers(new THREE.Vector3(), 5);
    expect(pool.activeCount).toBe(0);
  });
});
