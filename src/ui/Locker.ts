import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SKINS, TRAILS, type Skin, type Trail, skinById, trailById } from "../game/Skins";
import { makeGlowSprite } from "../effects/Glow";

const _up = new THREE.Vector3(0, 1, 0);

interface Puff {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  base: THREE.Vector3;
  rise: number;
  size: number;
}

/**
 * The locker's turntable: both robots wearing whatever is currently selected,
 * trails running, on their own tiny renderer. Cosmetics are bought sight-unseen
 * otherwise, which is a poor way to spend a hundred coins.
 */
export class LockerPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1.6, 0.1, 60);
  private rigs: { root: THREE.Group; body: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial; visor: THREE.MeshBasicMaterial; rim: THREE.Sprite }[] = [];
  private puffs: Puff[] = [];
  private puffGeo = new THREE.SphereGeometry(1, 8, 6);
  private trailSpecs: (Trail | null)[] = [null, null];
  private accents: number[] = [0xff8a3d, 0x35e0ff];
  private emit = [0, 0];
  private time = 0;
  private running = false;
  private raf = 0;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.scene.background = null;
    this.camera.position.set(0, 0.62, 3.1);
    this.camera.lookAt(0, 0.42, 0);

    this.scene.add(new THREE.AmbientLight(0xa8c6ff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.5, 3.5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x66d9ff, 0.9);
    rim.position.set(-3, 1, -2.5);
    this.scene.add(rim);

    for (let i = 0; i < 2; i++) this.rigs.push(this.buildRig(i === 0 ? -0.75 : 0.75));
  }

  /** A stand-in for the in-game robot: same silhouette, no physics attached. */
  private buildRig(x: number) {
    const root = new THREE.Group();
    root.position.x = x;
    const body = new THREE.MeshStandardMaterial({ color: 0x46536b, roughness: 0.5, metalness: 0.35 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.2 });
    const visor = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.38), body);
    torso.position.y = 0.34;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.06), accent);
    chest.position.set(0, 0.36, 0.21);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.44), body);
    head.position.y = 0.72;
    const vis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.03), visor);
    vis.position.set(0, 0.74, 0.23);
    root.add(torso, chest, head, vis);
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.24), accent);
      shoulder.position.set(sx * 0.3, 0.36, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.18), body);
      leg.position.set(sx * 0.13, 0, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.26), accent);
      foot.position.set(sx * 0.13, -0.17, 0.03);
      root.add(shoulder, leg, foot);
    }
    const rimMesh = makeGlowSprite(0xffffff, 1.7);
    rimMesh.visible = false;
    root.add(rimMesh);
    this.scene.add(root);
    return { root, body, accent, visor, rim: rimMesh };
  }

  setSkin(skinId: string) {
    const skin: Skin = skinById(skinId);
    this.accents = [skin.p1, skin.p2];
    for (let i = 0; i < 2; i++) {
      const r = this.rigs[i];
      const accent = i === 0 ? skin.p1 : skin.p2;
      r.body.color.setHex(skin.body);
      r.body.metalness = skin.metalness;
      r.body.roughness = skin.roughness;
      r.accent.color.setHex(accent);
      r.accent.emissive.setHex(accent);
      r.accent.emissiveIntensity = skin.glow;
      r.accent.metalness = skin.metalness;
      r.accent.roughness = skin.roughness;
      r.visor.color.setHex(accent);
      r.rim.visible = !!skin.rim;
      r.rim.material.color.setHex(accent);
    }
  }

  setTrail(player: number, trailId: string) {
    const t = trailById(trailId);
    this.trailSpecs[player] = t.rate > 0 ? t : null;
  }

  start() {
    if (this.running) return;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      // Same reason as the main scene: chrome and bullion need something to
      // reflect or they read as black plastic.
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.running = true;
    this.last = performance.now();
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = () => {
    if (!this.running || !this.renderer) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 200;
    if (this.canvas.width !== w * devicePixelRatio || this.canvas.height !== h * devicePixelRatio) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }

    for (let i = 0; i < 2; i++) {
      const rig = this.rigs[i];
      // A slow turn plus a small bob, so the finish catches the light.
      rig.root.rotation.y = Math.sin(this.time * 0.55 + i * 0.4) * 0.7;
      rig.root.position.y = Math.sin(this.time * 1.6 + i * 1.1) * 0.045;
      this.emitPuffs(i, dt, rig.root.position);
    }
    this.stepPuffs(dt);

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private emitPuffs(player: number, dt: number, at: THREE.Vector3) {
    const spec = this.trailSpecs[player];
    if (!spec) return;
    this.emit[player] += spec.rate * dt * 0.5;
    while (this.emit[player] >= 1 && this.puffs.length < 150) {
      this.emit[player] -= 1;
      const mat = new THREE.MeshBasicMaterial({
        color: spec.color ?? this.accents[player],
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.puffGeo, mat);
      const base = new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 0.24,
        -0.08 + Math.random() * 0.24,
        -0.34 - Math.random() * 0.2,
      );
      mesh.position.copy(base);
      this.scene.add(mesh);
      this.puffs.push({
        mesh, age: 0,
        life: spec.life * (0.7 + Math.random() * 0.6),
        base, rise: spec.rise, size: spec.size * 5,
      });
    }
  }

  private stepPuffs(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const k = 1 - p.age / p.life;
      p.mesh.position.addScaledVector(_up, p.rise * dt * 0.35);
      p.mesh.position.z -= dt * 0.55;
      p.mesh.scale.setScalar(p.size * (0.35 + k * 0.9));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.85;
    }
  }

  /** Clears the ribbon so switching trails does not blend the old one in. */
  clearPuffs() {
    for (const p of this.puffs) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.puffs.length = 0;
  }
}

export { SKINS, TRAILS };
