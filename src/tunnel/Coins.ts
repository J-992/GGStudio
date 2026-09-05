import * as THREE from "three";
import type { FaceKey, LevelDef, SliceDef } from "../levels/types";
import { COLS, HALF, SLICE_LEN, TILE } from "../game/Constants";

const FACES: FaceKey[] = ["f", "r", "c", "l"];

/** Inward normal and column axis per face, matching Tunnel's own layout. */
const AXES: Record<FaceKey, { n: THREE.Vector3; c: THREE.Vector3 }> = {
  f: { n: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(1, 0, 0) },
  c: { n: new THREE.Vector3(0, -1, 0), c: new THREE.Vector3(1, 0, 0) },
  l: { n: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(0, 1, 0) },
  r: { n: new THREE.Vector3(-1, 0, 0), c: new THREE.Vector3(0, 1, 0) },
};

/** Anything you can stand on. Ferries move, so they are not coin ground. */
const STANDABLE = "#^<>!?~";

interface Coin {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  taken: boolean;
  spin: number;
}

/**
 * Coins laid along whichever face a level is actually routed down, at chest
 * height on flat ground and jump height across a gap. Placed by reading the
 * level rather than by hand, so all twenty get them and a level edit cannot
 * leave coins floating in a wall.
 */
export class Coins {
  private coins: Coin[] = [];
  private geo: THREE.TorusGeometry;
  private mat: THREE.MeshStandardMaterial;
  private group = new THREE.Group();
  private time = 0;
  private collected = 0;

  constructor(scene: THREE.Scene, def: LevelDef) {
    this.geo = new THREE.TorusGeometry(0.26, 0.09, 8, 16);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffd75e, emissive: 0xffae1a, emissiveIntensity: 0.9,
      roughness: 0.3, metalness: 0.6,
    });
    for (const spot of this.plan(def)) this.add(spot);
    scene.add(this.group);
  }

  /** Which face carries the route at a slice: the one with the most solid tiles. */
  private routeFace(s: SliceDef | undefined): FaceKey | null {
    if (!s) return null;
    let best: FaceKey | null = null;
    let bestCount = 0;
    for (const f of FACES) {
      const p = s[f];
      const count = p === undefined ? COLS : [...p].filter((ch) => STANDABLE.includes(ch)).length;
      if (count > bestCount) { bestCount = count; best = f; }
    }
    return bestCount > 0 ? best : null;
  }

  private solidCols(s: SliceDef | undefined, face: FaceKey): number[] {
    const p = s?.[face];
    if (p === undefined) return [0, 1, 2, 3, 4];
    const out: number[] = [];
    for (let c = 0; c < COLS; c++) if (STANDABLE.includes(p[c])) out.push(c);
    return out;
  }

  private plan(def: LevelDef): { face: FaceKey; col: number; slice: number; high: boolean }[] {
    const out: { face: FaceKey; col: number; slice: number; high: boolean }[] = [];
    const slices = def.slices;
    // Skip the opening runway so coins never crowd the level banner.
    for (let i = 6; i < slices.length - 4; i++) {
      const face = this.routeFace(slices[i]);
      if (!face) continue;

      // An arc of three over a gap: the reward for committing to the jump.
      const prevCols = this.solidCols(slices[i - 1], face);
      if (prevCols.length === 0) {
        const cols = this.solidCols(slices[i], face);
        if (cols.length) {
          out.push({ face, col: cols[Math.floor(cols.length / 2)], slice: i, high: true });
        }
        continue;
      }

      // Otherwise a line every few slices along a lane that stays put.
      if (i % 7 !== 0) continue;
      const run: number[] = [];
      for (const c of this.solidCols(slices[i], face)) {
        let ok = true;
        for (let d = 0; d < 4; d++) {
          if (!this.solidCols(slices[i + d], face).includes(c)) { ok = false; break; }
        }
        if (ok) run.push(c);
      }
      if (!run.length) continue;
      // Walk the lane along so a run of coins asks for a little steering rather
      // than sitting in one groove for the whole level.
      const col = run[(i / 7) % run.length | 0];
      for (let d = 0; d < 4; d++) out.push({ face, col, slice: i + d, high: false });
    }
    return out;
  }

  private add(spot: { face: FaceKey; col: number; slice: number; high: boolean }) {
    const ax = AXES[spot.face];
    const along = -HALF + (spot.col + 0.5) * TILE;
    // The face's own offset: walls sit on x, floor and ceiling on y.
    const base = new THREE.Vector3();
    if (spot.face === "f") base.set(along, -HALF, 0);
    else if (spot.face === "c") base.set(along, HALF, 0);
    else if (spot.face === "l") base.set(-HALF, along, 0);
    else base.set(HALF, along, 0);
    base.z = -(spot.slice + 0.5) * SLICE_LEN;

    const pos = base.clone().addScaledVector(ax.n, spot.high ? 1.75 : 0.7);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(pos);
    // A torus already faces +Z, which is straight back at a runner heading -Z.
    // Rotating it put the ring edge-on and it read as a thin bar at distance.
    this.group.add(mesh);
    this.coins.push({ mesh, pos, taken: false, spin: Math.random() * Math.PI });
  }

  /** Returns how many coins were picked up this step. */
  collect(players: { position(out: THREE.Vector3): THREE.Vector3 }[], out: THREE.Vector3[]): number {
    let got = 0;
    const p = new THREE.Vector3();
    for (const c of this.coins) {
      if (c.taken) continue;
      for (const player of players) {
        player.position(p);
        // A little magnetism: brushing past a coin should take it, so the reward
        // never feels like it needed pixel-accurate steering.
        if (p.distanceToSquared(c.pos) > 2.25) continue;
        c.taken = true;
        c.mesh.visible = false;
        this.collected++;
        got++;
        out.push(c.pos);
        break;
      }
    }
    return got;
  }

  update(dt: number) {
    this.time += dt;
    for (const c of this.coins) {
      if (c.taken) continue;
      c.mesh.rotation.z = this.time * 2.4 + c.spin;
      c.mesh.position.y = c.pos.y + Math.sin(this.time * 2 + c.spin) * 0.08;
    }
  }

  get total() { return this.coins.length; }
  get takenCount() { return this.collected; }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.geo.dispose();
    this.mat.dispose();
    this.coins = [];
  }
}
