import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { LevelDef, SliceDef } from "../levels/types";
import { COLS, CRUMBLE_DELAY, HALF, SLAB_T, SLICE_LEN, TILE } from "../game/Constants";

function makePanelTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2c3644";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#313d4e";
  g.fillRect(14, 14, 228, 228);
  g.strokeStyle = "rgba(90,190,220,0.75)";
  g.lineWidth = 3;
  g.strokeRect(3, 3, 250, 250);
  g.strokeStyle = "rgba(0,0,0,0.4)";
  g.lineWidth = 2;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = "#242e3b";
  for (const [x, y] of [[26, 26], [230, 26], [26, 230], [230, 230]]) {
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(150,215,245,0.07)";
  g.fillRect(14, 14, 228, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function scaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const scales: [number, number][] = [
    [d / TILE, h / TILE], [d / TILE, h / TILE],
    [w / TILE, d / TILE], [w / TILE, d / TILE],
    [w / TILE, h / TILE], [w / TILE, h / TILE],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * scales[f][0], uv.getY(i) * scales[f][1]);
    }
  }
}

interface RunBox { x: number; y: number; z: number; w: number; h: number; d: number }

export class Tunnel {
  readonly group = new THREE.Group();
  readonly finishZ: number;
  readonly startZ = -6;
  private turbines: { obj: THREE.Object3D; speed: number }[] = [];
  private portalDisc!: THREE.Mesh;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private time = 0;

  private crumbleTiles: CrumbleTile[] = [];
  private spinners: Spinner[] = [];
  private crumbleMat!: THREE.MeshStandardMaterial;

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    def: LevelDef,
    R: typeof RAPIER,
    addStaticBox: (x: number, y: number, z: number, hx: number, hy: number, hz: number) => void,
  ) {
    const slices = def.slices;
    this.finishZ = -(slices.length * SLICE_LEN - 5);

    const floorBoxes: RunBox[] = [];
    const ceilBoxes: RunBox[] = [];
    const leftBoxes: RunBox[] = [];
    const rightBoxes: RunBox[] = [];

    const tex = makePanelTexture();
    this.disposables.push(tex);
    const slabMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.35 });
    this.disposables.push(slabMat);
    this.crumbleMat = new THREE.MeshStandardMaterial({
      map: tex, color: 0xffd9b0, emissive: 0x8a3c12, emissiveIntensity: 0.4,
      roughness: 0.7, metalness: 0.3, transparent: true,
    });
    this.disposables.push(this.crumbleMat);

    const faces: { key: keyof SliceDef; out: RunBox[] }[] = [
      { key: "f", out: floorBoxes },
      { key: "c", out: ceilBoxes },
      { key: "l", out: leftBoxes },
      { key: "r", out: rightBoxes },
    ];

    for (const { key, out } of faces) {
      for (let col = 0; col < COLS; col++) {
        let runStart = -1;
        for (let i = 0; i <= slices.length; i++) {
          const s: SliceDef | undefined = slices[i];
          let kind: "static" | "crumble" | "empty";
          if (!s) kind = "empty";
          else {
            const p = s[key];
            if (!p) kind = "static";
            else {
              const ch = p[col];
              kind = ch === "#" ? "static" : ch === "~" ? "crumble" : "empty";
            }
          }
          if (kind === "static" && runStart < 0) runStart = i;
          if (kind !== "static" && runStart >= 0) {
            out.push(this.boxForFace(key, col, runStart, i - runStart));
            runStart = -1;
          }
          if (kind === "crumble") {
            this.addCrumbleTile(this.boxForFace(key, col, i, 1), world, R);
          }
        }
      }
    }
    const all = [...floorBoxes, ...ceilBoxes, ...leftBoxes, ...rightBoxes];
    for (const b of all) {
      addStaticBox(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2);
    }

    const geos: THREE.BoxGeometry[] = [];
    for (const b of all) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      scaleBoxUVs(g, b.w, b.h, b.d);
      g.translate(b.x, b.y, b.z);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    this.disposables.push(merged);
    this.group.add(new THREE.Mesh(merged, slabMat));

    const trimMat = new THREE.MeshBasicMaterial({ color: 0x2a7d96 });
    const railGeo = new THREE.BoxGeometry(0.14, 0.14, slices.length * SLICE_LEN + 8);
    this.disposables.push(trimMat, railGeo);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, trimMat);
        rail.position.set(sx * (HALF - 0.02), sy * (HALF - 0.02), -(slices.length * SLICE_LEN) / 2);
        this.group.add(rail);
      }
    }

    this.buildSpinners(def, world, R);
    this.buildBackground(slices.length * SLICE_LEN);
    this.buildPortal();

    scene.add(this.group);
  }

  private boxForFace(key: keyof SliceDef, col: number, startSlice: number, len: number): RunBox {
    const c = -HALF + (col + 0.5) * TILE;
    const z = -(startSlice + len / 2) * SLICE_LEN;
    const depth = len * SLICE_LEN;
    switch (key) {
      case "f": return { x: c, y: -HALF - SLAB_T / 2, z, w: TILE, h: SLAB_T, d: depth };
      case "c": return { x: c, y: HALF + SLAB_T / 2, z, w: TILE, h: SLAB_T, d: depth };
      case "l": return { x: -HALF - SLAB_T / 2, y: c, z, w: SLAB_T, h: TILE, d: depth };
      default: return { x: HALF + SLAB_T / 2, y: c, z, w: SLAB_T, h: TILE, d: depth };
    }
  }

  private addCrumbleTile(b: RunBox, world: RAPIER.World, R: typeof RAPIER) {
    const mat = this.crumbleMat.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.y, b.z);
    this.group.add(mesh);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z));
    const desc = R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups((0x0001 << 16) | 0xffff);
    const collider = world.createCollider(desc, body);
    this.disposables.push(mesh.geometry, mat);
    this.crumbleTiles.push({
      mesh, body, collider, desc, mat,
      x: b.x, y: b.y, z: b.z, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2,
      origPos: new THREE.Vector3(b.x, b.y, b.z),
      fallDir: new THREE.Vector3(),
      timer: -1, broken: false, fallT: 0,
    });
  }

  updateCrumble(
    dt: number,
    players: { grounded: boolean; position(out: THREE.Vector3): THREE.Vector3 }[],
    world: RAPIER.World,
    up: THREE.Vector3,
  ): { broken: THREE.Vector3[] } {
    const broken: THREE.Vector3[] = [];
    const pp = new THREE.Vector3();
    for (const t of this.crumbleTiles) {
      if (t.broken) {
        t.fallT += dt;
        t.mesh.position.addScaledVector(t.fallDir, 9 * dt);
        t.mesh.rotation.z += 3.5 * dt;
        t.mat.opacity = Math.max(0, 1 - t.fallT / 0.9);
        if (t.fallT > 0.9) t.mesh.visible = false;
        continue;
      }
      let touched = false;
      for (const p of players) {
        if (!p.grounded) continue;
        p.position(pp);
        if (
          Math.abs(pp.x - t.x) < t.hx + 0.45 &&
          Math.abs(pp.y - t.y) < t.hy + 0.6 &&
          Math.abs(pp.z - t.z) < t.hz + 0.35
        ) {
          touched = true;
          break;
        }
      }
      if (touched) {
        if (t.timer < 0) t.timer = 0;
        else t.timer += dt;
        if (t.timer > CRUMBLE_DELAY) {
          t.broken = true;
          t.fallT = 0;
          t.fallDir.copy(up).negate();
          world.removeCollider(t.collider, true);
          broken.push(new THREE.Vector3(t.x, t.y, t.z));
        }
      } else {
        t.timer = -1;
      }
    }
    return { broken };
  }

  resetCrumbles(world: RAPIER.World) {
    for (const t of this.crumbleTiles) {
      if (!t.broken) continue;
      t.collider = world.createCollider(t.desc, t.body);
      t.broken = false;
      t.timer = -1;
      t.fallT = 0;
      t.mesh.visible = true;
      t.mesh.position.copy(t.origPos);
      t.mesh.rotation.set(0, 0, 0);
      t.mat.opacity = 1;
    }
  }

  crumbleBrokenCount(): number {
    return this.crumbleTiles.filter((t) => t.broken).length;
  }

  updateSpinners(dt: number) {
    for (const sp of this.spinners) {
      sp.angle = (sp.angle + sp.speed * dt) % (Math.PI * 2);
      sp.body.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(sp.angle / 2), w: Math.cos(sp.angle / 2) });
      sp.mesh.rotation.z = sp.angle;
    }
  }

  spinnerStates(): { z: number; angle: number }[] {
    return this.spinners.map((s) => ({ z: s.z, angle: s.angle }));
  }

  private buildSpinners(def: LevelDef, world: RAPIER.World, R: typeof RAPIER) {
    for (const sp of def.spinners ?? []) {
      const z = -(sp.atSlice + 0.5) * SLICE_LEN;
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -4.0, z),
      );
      const col = R.ColliderDesc.cuboid(2.6, 0.175, 1.0)
        .setFriction(0.1)
        .setRestitution(0)
        .setCollisionGroups((0x0001 << 16) | 0xffff);
      world.createCollider(col, body);
      const barMat = new THREE.MeshStandardMaterial({
        color: 0xffb347, emissive: 0xff8c1a, emissiveIntensity: 0.8, roughness: 0.4,
      });
      const barGeo = new THREE.BoxGeometry(5.2, 0.35, 1.0);
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, -4.0, z);
      this.group.add(bar);
      const hubGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10);
      const hub = new THREE.Mesh(hubGeo, barMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, -4.0, z);
      this.group.add(hub);
      this.disposables.push(barMat, barGeo, hubGeo);
      this.spinners.push({ body, mesh: bar, angle: 0, speed: sp.speed ?? 2.2, z });
    }
  }

  private buildBackground(length: number) {
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121a26, roughness: 0.95, metalness: 0.2 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x17495e });
    this.disposables.push(darkMat, ringMat);

    const nRings = Math.floor(length / 13);
    const ringGeo = new THREE.TorusGeometry(HALF + 1.7, 0.08, 6, 40);
    this.disposables.push(ringGeo);
    for (let i = 0; i < nRings; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.z = -i * 13 - 6;
      this.group.add(ring);
    }

    const pipeGeo = new THREE.CylinderGeometry(1, 1, length + 60, 10);
    this.disposables.push(pipeGeo);
    for (let i = 0; i < 11; i++) {
      const pipe = new THREE.Mesh(pipeGeo, darkMat);
      const ang = Math.random() * Math.PI * 2;
      const rad = HALF + 3 + Math.random() * 6;
      pipe.scale.setScalar(0.3 + Math.random() * 0.55);
      pipe.position.set(Math.cos(ang) * rad, Math.sin(ang) * rad, -length / 2);
      pipe.rotation.x = Math.PI / 2;
      this.group.add(pipe);
    }

    const bladeGeo = new THREE.BoxGeometry(7.5, 1.1, 0.18);
    const hubGeo = new THREE.CylinderGeometry(1.1, 1.1, 1.2, 12);
    this.disposables.push(bladeGeo, hubGeo);
    for (let i = 0; i < Math.max(2, Math.floor(length / 45)); i++) {
      const t = new THREE.Group();
      const hub = new THREE.Mesh(hubGeo, darkMat);
      hub.rotation.x = Math.PI / 2;
      t.add(hub);
      for (let b = 0; b < 5; b++) {
        const blade = new THREE.Mesh(bladeGeo, darkMat);
        blade.position.set(Math.cos((b / 5) * Math.PI * 2) * 3.75, Math.sin((b / 5) * Math.PI * 2) * 3.75, 0);
        blade.rotation.z = (b / 5) * Math.PI * 2;
        t.add(blade);
      }
      const ang = (i / Math.max(2, Math.floor(length / 45))) * Math.PI * 2 + 0.7;
      t.position.set(Math.cos(ang) * (HALF + 5.5), Math.sin(ang) * (HALF + 5.5), -18 - i * 45);
      this.turbines.push({ obj: t, speed: 0.5 + Math.random() * 0.9 });
      this.group.add(t);
    }
  }

  private buildPortal() {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66f2ff });
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x9ff5ff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const ringGeo = new THREE.TorusGeometry(HALF * 0.92, 0.22, 10, 48);
    const discGeo = new THREE.CircleGeometry(HALF * 0.88, 48);
    this.disposables.push(ringMat, discMat, ringGeo, discGeo);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = this.finishZ;
    this.group.add(ring);
    this.portalDisc = new THREE.Mesh(discGeo, discMat);
    this.portalDisc.position.z = this.finishZ;
    this.group.add(this.portalDisc);
    const pillarGeo = new THREE.BoxGeometry(0.7, 0.7, 3.4);
    this.disposables.push(pillarGeo);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, ringMat);
      p.position.set(sx * (HALF + 0.9), 0, this.finishZ);
      this.group.add(p);
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const t of this.turbines) t.obj.rotation.z += t.speed * dt;
    const pulse = 0.16 + Math.sin(this.time * 3.2) * 0.09;
    (this.portalDisc.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.turbines = [];
    this.crumbleTiles = [];
    this.spinners = [];
  }
}


interface CrumbleTile {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  desc: RAPIER.ColliderDesc;
  mat: THREE.MeshStandardMaterial;
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  origPos: THREE.Vector3;
  fallDir: THREE.Vector3;
  timer: number;
  broken: boolean;
  fallT: number;
}

interface Spinner {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  angle: number;
  speed: number;
  z: number;
}
