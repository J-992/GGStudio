import * as THREE from "three";

const MAX_PARTICLES = 320;

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grav: number;
  size: number;
  color: THREE.Color;
}

export class Effects {
  private pool: P[] = [];
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private cursor = 0;
  private dust: THREE.Points;
  private dustGeo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("color", this.colAttr);
    const mat = new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1,
        grav: 0, size: 1, color: new THREE.Color(),
      });
      this.posAttr.setXYZ(i, 0, -999, 0);
    }

    const DUST = 260;
    this.dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 30;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      dustPos[i * 3 + 2] = -Math.random() * 100;
    }
    this.dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.06, color: 0x3a5a75, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.dust = new THREE.Points(this.dustGeo, dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  burst(at: THREE.Vector3, color: number, count: number, speed: number, life: number, grav = 0) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      p.pos.copy(at);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      p.maxLife = life * (0.6 + Math.random() * 0.7);
      p.life = p.maxLife;
      p.grav = grav;
      p.color.copy(c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    }
  }

  update(dt: number, gravityDir: THREE.Vector3, camZ: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.posAttr.setXYZ(i, 0, -999, 0);
        continue;
      }
      p.vel.addScaledVector(gravityDir, p.grav * dt);
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      this.posAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      this.colAttr.setXYZ(i, p.color.r * k, p.color.g * k, p.color.b * k);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    const arr = this.dustGeo.attributes.position as THREE.BufferAttribute;
    const dz = 26 * dt;
    for (let i = 0; i < arr.count; i++) {
      let z = arr.getZ(i) + dz;
      if (z > camZ + 8) z -= 110;
      arr.setZ(i, z);
    }
    arr.needsUpdate = true;
    this.dust.position.z = camZ + 40;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.points);
    scene.remove(this.dust);
    this.geo.dispose();
    this.dustGeo.dispose();
  }
}
