import * as THREE from "three";
import type { Trail } from "../game/Skins";

const MAX_PUFFS = 220;
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

interface Puff {
  pos: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  rise: number;
}

/**
 * A ribbon of puffs left behind one robot. Instanced so a full tail costs one
 * draw call, and additive so it reads as light rather than as litter.
 */
export class RobotTrail {
  private mesh: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private emitAcc = 0;
  private spec: Trail | null = null;
  private tint = new THREE.Color(0xffffff);
  private mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(1, 8, 6);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_PUFFS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** `accent` is used when the trail has no colour of its own. */
  setTrail(spec: Trail | null, accent: number) {
    this.spec = spec && spec.rate > 0 ? spec : null;
    this.tint.setHex(this.spec?.color ?? accent);
    this.mat.color.copy(this.tint);
    if (!this.spec) this.clear();
  }

  clear() {
    this.puffs.length = 0;
    this.mesh.count = 0;
  }

  /** `up` is the surface normal, so puffs drift away from whatever is underfoot. */
  update(dt: number, at: THREE.Vector3, up: THREE.Vector3, moving: boolean) {
    const spec = this.spec;
    if (spec && moving) {
      this.emitAcc += spec.rate * dt;
      while (this.emitAcc >= 1 && this.puffs.length < MAX_PUFFS) {
        this.emitAcc -= 1;
        this.puffs.push({
          pos: at.clone().addScaledVector(up, 0.18 + Math.random() * 0.2)
            .add(new THREE.Vector3((Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22)),
          age: 0,
          life: spec.life * (0.7 + Math.random() * 0.6),
          size: spec.size * (0.6 + Math.random() * 0.8),
          rise: spec.rise * (0.6 + Math.random() * 0.8),
        });
      }
    } else {
      this.emitAcc = 0;
    }

    let live = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i];
      puff.age += dt;
      if (puff.age >= puff.life) continue;
      puff.pos.addScaledVector(up, puff.rise * dt);
      const k = 1 - puff.age / puff.life;
      const scale = puff.size * (0.35 + k * 0.9);
      _q.identity();
      _s.setScalar(scale);
      _m.compose(puff.pos, _q, _s);
      this.mesh.setMatrixAt(live, _m);
      this.puffs[live] = puff;
      live++;
    }
    this.puffs.length = live;
    this.mesh.count = live;
    this.mesh.instanceMatrix.needsUpdate = true;
    void _p;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
