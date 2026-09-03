import * as THREE from 'three';

/**
 * A handful of low-poly stylized clouds that drift along with the runner.
 *
 * Deliberately not route-aware: the endless track can turn 90° at any chunk
 * boundary, so "ahead" isn't a fixed axis the way it is for the campaign's
 * silhouette band (which only ever sees one authored route). Clouds instead
 * live in a horizontal annulus around the player's *world* position and get
 * recycled to a fresh spot in that same annulus once they fall out of it -
 * direction-agnostic, so it doesn't matter which way the last turn pointed.
 *
 * Geometry/material are module-level singletons shared across every puff in
 * every cloud (flat-shaded `IcosahedronGeometry(1, 0)` - about as low-poly as
 * a "cloud" reads at all, and `MeshBasicMaterial` so clouds cost zero
 * lighting calculations, per the "lightweight, performance-friendly" brief).
 */

export interface CloudFieldOptions {
  /** How many cloud clusters to keep alive at once. */
  count?: number;
  /** Clouds respawn at a random radius in [minRadius, maxRadius]. */
  minRadius?: number;
  /** Clouds recycle once they drift past this radius from the player. */
  maxRadius?: number;
  minHeight?: number;
  maxHeight?: number;
}

const DEFAULTS: Required<CloudFieldOptions> = {
  count: 10,
  minRadius: 150,
  maxRadius: 400,
  minHeight: 45,
  maxHeight: 78,
};

const puffGeometry = new THREE.IcosahedronGeometry(1, 0);
// A warm pale tint (was near-white, 0xfdfdfd) so clouds read as sunset-lit
// against the new gradient sky rather than stark white, while staying light
// enough to keep clear contrast against obstacles/deck geometry.
const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1e0, fog: true });

export class CloudField {
  readonly root = new THREE.Group();

  private readonly clouds: THREE.Group[];
  private readonly opts: Required<CloudFieldOptions>;
  private readonly rng: () => number;

  constructor(
    scene: THREE.Object3D,
    options: CloudFieldOptions = {},
    rng: () => number = Math.random,
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.rng = rng;
    scene.add(this.root);

    this.clouds = [];
    const origin = new THREE.Vector3();
    for (let i = 0; i < this.opts.count; i++) {
      const cloud = this.buildCloud();
      this.scatter(cloud, origin);
      this.root.add(cloud);
      this.clouds.push(cloud);
    }
  }

  /** RENDER RATE. Cheap - a handful of distance checks. */
  update(playerPosition: THREE.Vector3): void {
    const maxRadiusSq = this.opts.maxRadius * this.opts.maxRadius;
    for (const cloud of this.clouds) {
      const dx = cloud.position.x - playerPosition.x;
      const dz = cloud.position.z - playerPosition.z;
      if (dx * dx + dz * dz > maxRadiusSq) this.scatter(cloud, playerPosition);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    // Geometry/material are shared module-level singletons, intentionally
    // never disposed here - other CloudField instances (a second endless
    // run, tests) reuse them.
  }

  private buildCloud(): THREE.Group {
    const group = new THREE.Group();
    const puffCount = 2 + Math.floor(this.rng() * 3); // 2-4 puffs per cluster

    for (let i = 0; i < puffCount; i++) {
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
      const scale = 3 + this.rng() * 3;
      puff.scale.set(scale * (1 + this.rng() * 0.4), scale * 0.55, scale * (1 + this.rng() * 0.4));
      puff.position.set(
        (this.rng() - 0.5) * scale * 1.6,
        (this.rng() - 0.5) * scale * 0.3,
        (this.rng() - 0.5) * scale * 1.6,
      );
      group.add(puff);
    }

    return group;
  }

  private scatter(cloud: THREE.Group, around: THREE.Vector3): void {
    const { minRadius, maxRadius, minHeight, maxHeight } = this.opts;
    const angle = this.rng() * Math.PI * 2;
    const radius = minRadius + this.rng() * (maxRadius - minRadius);

    cloud.position.set(
      around.x + Math.cos(angle) * radius,
      minHeight + this.rng() * (maxHeight - minHeight),
      around.z + Math.sin(angle) * radius,
    );
  }
}
