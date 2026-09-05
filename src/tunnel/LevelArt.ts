import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FaceKey, LevelDef } from "../levels/types";
import { COLS, HALF, SLICE_LEN, TILE } from "../game/Constants";

type Environment = NonNullable<LevelDef["environment"]>;
export const ENVIRONMENTS: Record<Environment, { base: string; panel: string; trim: number; metal: number }> = {
  dock:      { base: "#263643", panel: "#3b5060", trim: 0x72bed0, metal: 0x243947 },
  orbital:   { base: "#292e49", panel: "#444765", trim: 0xa79bdb, metal: 0x303148 },
  induction: { base: "#213d3c", panel: "#355650", trim: 0x70bda2, metal: 0x243c39 },
  transit:   { base: "#30344a", panel: "#484b65", trim: 0x9eafd8, metal: 0x2d344d },
  reactor:   { base: "#403038", panel: "#5a454d", trim: 0xd99d78, metal: 0x442e36 },
};

export function panelTexture(environment: Environment, cracked = false): THREE.CanvasTexture {
  const palette = ENVIRONMENTS[environment];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.fillStyle = palette.base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = palette.panel;
  g.fillRect(7, 7, 242, 242);
  g.strokeStyle = "#101923";
  g.lineWidth = 4;
  g.strokeRect(12, 12, 232, 232);
  g.strokeStyle = "rgba(220,239,245,.18)";
  g.lineWidth = 2;
  g.strokeRect(16, 16, 224, 224);
  // Brushed metal and stamped service channels, deterministic across reloads.
  for (let i = 0; i < 42; i++) {
    g.fillStyle = `rgba(225,238,245,${0.012 + (i % 4) * 0.008})`;
    g.fillRect(24, 25 + i * 5, 208, 1);
  }
  for (const y of [38, 208]) {
    g.fillStyle = "rgba(0,0,0,.26)";
    g.fillRect(72, y, 112, 9);
    g.fillStyle = "rgba(220,239,245,.12)";
    g.fillRect(72, y + 9, 112, 2);
  }
  for (const x of [30, 226]) for (const y of [30, 226]) {
    g.fillStyle = "#141f29";
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#71818a";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.stroke();
  }
  if (cracked) {
    g.strokeStyle = "#ffbd69"; g.lineWidth = 5;
    g.beginPath();
    g.moveTo(8, 95); g.lineTo(76, 122); g.lineTo(115, 94);
    g.lineTo(139, 150); g.lineTo(194, 128); g.lineTo(250, 166);
    g.moveTo(139, 150); g.lineTo(121, 199); g.lineTo(162, 250);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

const normals: Record<FaceKey, THREE.Vector3> = {
  f: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, -1, 0),
  l: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(-1, 0, 0),
};
const column = (face: FaceKey) => face === "f" || face === "c"
  ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);

export function shutterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#230e17"; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#ef7055"; g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  for (let y = -96; y < 128; y += 26) {
    g.beginPath(); g.moveTo(10, y); g.lineTo(118, y + 108); g.stroke();
  }
  g.fillStyle = "#230e17"; g.fillRect(46, 28, 36, 73);
  g.fillStyle = "#ffceb0"; g.fillRect(59, 38, 10, 33); g.fillRect(59, 80, 10, 10);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function symbolTexture(symbol: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const colors: Record<string, string> = { "^": "#b4ffdc", "<": "#a0e6ff", ">": "#a0e6ff", "!": "#ffc0a3", "=": "#e1cfff", edge: "#ffce80" };
  g.strokeStyle = g.fillStyle = colors[symbol];
  g.lineWidth = 8; g.lineJoin = "round";
  if (symbol === "^" || symbol === "<" || symbol === ">") {
    g.save(); g.translate(64, 64);
    if (symbol === ">") g.rotate(Math.PI / 2);
    if (symbol === "<") g.rotate(-Math.PI / 2);
    for (const y of [-23, 18]) {
      g.beginPath(); g.moveTo(-29, y + 15); g.lineTo(0, y - 11); g.lineTo(29, y + 15); g.stroke();
    }
    g.restore();
  } else if (symbol === "!") {
    g.lineWidth = 5; g.strokeRect(9, 9, 110, 110);
    for (let x = 16; x < 120; x += 24) {
      g.beginPath(); g.moveTo(x, 16); g.lineTo(x - 10, 31); g.stroke();
      g.beginPath(); g.moveTo(x, 97); g.lineTo(x - 10, 112); g.stroke();
    }
    g.fillRect(59, 40, 10, 28); g.fillRect(59, 76, 10, 10);
  } else if (symbol === "=") {
    g.lineWidth = 4; g.strokeRect(7, 7, 114, 114);
    for (const y of [19, 109]) for (let x = 16; x < 115; x += 22) {
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 10, y + 5); g.stroke();
    }
  } else {
    // A discontinuous lip marking; unlike a filled rectangle it cannot read as ground.
    for (let x = 4; x < 128; x += 24) g.fillRect(x, 4, 14, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Batched environmental assets, with no collision, timers or gameplay authority. */
export class LevelArt {
  readonly group = new THREE.Group();
  private resources: { dispose(): void }[] = [];

  constructor(def: LevelDef) {
    const environment = def.environment ?? "dock";
    const palette = ENVIRONMENTS[environment];
    const structure: THREE.BufferGeometry[] = [];
    const lights: THREE.BufferGeometry[] = [];
    const box = (list: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(x, y, z); list.push(geo);
    };
    for (let slice = 4; slice < def.slices.length; slice += 12) {
      const z = -(slice + 0.5) * SLICE_LEN;
      // Ribs and machinery sit outside every walkable face.
      for (const sign of [-1, 1]) {
        box(structure, sign * 5.95, 0, z, 0.45, 11.8, 0.65);
        box(structure, 0, sign * 5.95, z, 11.8, 0.45, 0.65);
        box(lights, sign * 5.65, 0, z + 0.35, 0.12, 6.6, 0.12);
        box(lights, 0, sign * 5.65, z + 0.35, 6.6, 0.12, 0.12);
        if (environment === "induction" || environment === "reactor") {
          for (let i = -2; i <= 2; i++) {
            box(structure, sign * 7.0, i * 1.3, z, 1.3, 0.8, 2.8);
            box(lights, sign * 6.3, i * 1.3, z + 0.9, 0.12, 0.45, 0.8);
          }
        } else if (environment === "orbital") {
          const ring = new THREE.TorusGeometry(8, 0.2, 5, 8);
          ring.translate(0, 0, z + sign * 2); structure.push(ring);
        } else if (environment === "transit") {
          for (const y of [-3, 3]) box(structure, sign * 7.2, y, z, 1.8, 1.2, 8);
        } else {
          box(structure, sign * 6.6, -2, z, 1.1, 3.3, 2);
        }
      }
    }
    const body = new THREE.MeshStandardMaterial({ color: palette.metal, roughness: 0.65, metalness: 0.65 });
    const light = new THREE.MeshBasicMaterial({ color: palette.trim });
    this.resources.push(body, light);
    this.batch(structure, body);
    this.batch(lights, light);

    const decals = new Map<string, THREE.BufferGeometry[]>();
    for (const face of ["f", "r", "c", "l"] as FaceKey[]) {
      for (let i = 0; i < def.slices.length; i++) {
        const pattern = def.slices[i][face] ?? "#####";
        const next = def.slices[i + 1]?.[face] ?? "#####";
        for (let c = 0; c < COLS; c++) {
          const ch = pattern[c];
          let symbol = "^<>".includes(ch) ? ch : "!?".includes(ch) ? "!" : null;
          // Moving-deck markings attach to the moving mesh in Tunnel, not here.
          if (!symbol && ch === "#" && next[c] === ".") symbol = "edge";
          if (!symbol) continue;
          const geo = this.decal(face, c, i, symbol === "edge" ? 1 : 0.78);
          const list = decals.get(symbol) ?? [];
          list.push(geo); decals.set(symbol, list);
        }
      }
    }
    for (const [symbol, geos] of decals) {
      const texture = symbolTexture(symbol);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
      this.resources.push(texture, material);
      this.batch(geos, material);
    }
    // Stencilled phrase names provide landmarks without adding HUD interruptions.
    for (const [index, beat] of (def.beats ?? [{ atSlice: 0, label: def.name }]).entries()) {
      const slice = beat.atSlice + 3;
      if (def.slices[slice]?.f && def.slices[slice].f !== "#####") continue;
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 256;
      const g = canvas.getContext("2d")!;
      g.fillStyle = "#c6d7db";
      g.font = "600 26px monospace";
      g.fillText(`${environment.toUpperCase()} / ${String(index + 1).padStart(2, "0")}`, 16, 44);
      g.font = "700 48px monospace";
      g.fillText(beat.label, 16, 124, 990);
      g.fillRect(16, 154, 130, 5);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.65, depthWrite: false });
      const geo = new THREE.PlaneGeometry(6, 1.5);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -HALF + 0.02, -(slice + 0.5) * SLICE_LEN);
      this.resources.push(texture, material, geo);
      this.group.add(new THREE.Mesh(geo, material));
    }
  }

  private decal(face: FaceKey, col: number, slice: number, scale: number) {
    const normal = normals[face];
    const right = column(face);
    const up = new THREE.Vector3().crossVectors(normal, right);
    const position = normal.clone().multiplyScalar(-HALF + 0.16)
      .addScaledVector(right, -HALF + (col + 0.5) * TILE);
    position.z = -(slice + 0.5) * SLICE_LEN;
    const transform = new THREE.Matrix4().makeBasis(right, up, normal).setPosition(position);
    const geo = new THREE.PlaneGeometry(TILE * scale, SLICE_LEN * scale);
    // The leading lip is always -Z, including inverted faces.
    if (scale === 1 && up.z > 0) geo.rotateZ(Math.PI);
    geo.applyMatrix4(transform);
    return geo;
  }

  private batch(geos: THREE.BufferGeometry[], material: THREE.Material) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false)!;
    geos.forEach(g => g.dispose());
    this.resources.push(merged);
    this.group.add(new THREE.Mesh(merged, material));
  }

  dispose() { this.resources.forEach(r => r.dispose()); this.resources = []; }
}

/** Reused once per tunnel for moving-deck tops. */
export const movingDeckTexture = () => symbolTexture("=");
