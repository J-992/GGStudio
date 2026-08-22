import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { LevelDef, SliceDef } from "../levels/types";
import { COLS, HALF, SLAB_T, SLICE_LEN, TILE } from "../game/Constants";

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

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    def: LevelDef,
    addStaticBox: (x: number, y: number, z: number, hx: number, hy: number, hz: number) => void,
  ) {
    const slices = def.slices;
    this.finishZ = -(slices.length * SLICE_LEN - 5);

    const floorBoxes: RunBox[] = [];
    const ceilBoxes: RunBox[] = [];
    const leftBoxes: RunBox[] = [];
    const rightBoxes: RunBox[] = [];

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
          let solid = false;
          if (s && s[key]) solid = s[key]![col] === "#";
          else if (!s) solid = false;
          else if (!s[key]) solid = true;
          if (solid && runStart < 0) runStart = i;
          if (!solid && runStart >= 0) {
            out.push(this.boxForFace(key, col, runStart, i - runStart));
            runStart = -1;
          }
        }
      }
    }
    const all = [...floorBoxes, ...ceilBoxes, ...leftBoxes, ...rightBoxes];
    for (const b of all) {
      addStaticBox(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2);
    }

    const tex = makePanelTexture();
    this.disposables.push(tex);
    const slabMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.35 });
    this.disposables.push(slabMat);
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
  }
}
