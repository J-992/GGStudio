import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { FaceKey, LevelDef, SliceDef } from "../levels/types";
import { SOLID_CHARS } from "../levels/types";
import { ENVIRONMENTS, LevelArt, movingDeckTexture, panelTexture, shutterTexture } from "./LevelArt";
import {
  COLS, CRUMBLE_DELAY, HALF, SLAB_T, SLICE_LEN, TILE,
  CONVEYOR_SPEED, LAUNCH_V,
  SLIDER_PERIOD, SLIDER_TRAVEL,
  SHUTTER_CLOSED_FRAC, SHUTTER_EDGE_FRAC, SHUTTER_HEIGHT,
  SHUTTER_LETHAL_FRAC, SHUTTER_PERIOD,
} from "../game/Constants";
import type { SurfaceFrame } from "./SurfaceOrientation";
import type { Player } from "../player/Player";
import { Drum } from "./Drum";

/**
 * Each face has an inward normal (the direction you launch or a shutter rises)
 * and a column axis (the direction a belt pushes and a slider tracks). Both are
 * fixed world vectors: the tunnel geometry never moves, only gravity turns.
 */
interface FaceAxes { normal: THREE.Vector3; colAxis: THREE.Vector3 }

const FACE_AXES: Record<FaceKey, FaceAxes> = {
  f: { normal: new THREE.Vector3(0, 1, 0), colAxis: new THREE.Vector3(1, 0, 0) },
  c: { normal: new THREE.Vector3(0, -1, 0), colAxis: new THREE.Vector3(1, 0, 0) },
  l: { normal: new THREE.Vector3(1, 0, 0), colAxis: new THREE.Vector3(0, 1, 0) },
  r: { normal: new THREE.Vector3(-1, 0, 0), colAxis: new THREE.Vector3(0, 1, 0) },
};

const _fd = new THREE.Vector3();
const _fv = new THREE.Vector3();

/** 0 while a shutter is stowed, 1 while it is fully across the lane. */
function shutterExtension(time: number, phase: number): number {
  const u = (((time / SHUTTER_PERIOD + phase) % 1) + 1) % 1;
  if (u < SHUTTER_EDGE_FRAC) return u / SHUTTER_EDGE_FRAC;
  if (u < SHUTTER_CLOSED_FRAC) return 1;
  if (u < SHUTTER_CLOSED_FRAC + SHUTTER_EDGE_FRAC) {
    return 1 - (u - SHUTTER_CLOSED_FRAC) / SHUTTER_EDGE_FRAC;
  }
  return 0;
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
  readonly drum: Drum;
  private scenery = new THREE.Group();
  private magnets: { pos: THREE.Vector3; axes: FaceAxes }[] = [];
  private magnetGeos: THREE.BufferGeometry[] = [];
  private turbines: { obj: THREE.Object3D; speed: number }[] = [];
  private portalDisc!: THREE.Mesh;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private time = 0;

  private crumbleTiles: CrumbleTile[] = [];
  private spinners: Spinner[] = [];
  private pads: Pad[] = [];
  private belts: Belt[] = [];
  private sliders: Slider[] = [];
  private shutters: Shutter[] = [];
  private featureTime = 0;
  get featureClock() { return this.featureTime; }
  syncClock(time: number, angle: number) {
    this.featureTime = time;
    this.drum.setAngle(angle, true);
    this.updateFeatures(0);
    for (const sp of this.spinners) sp.angle = sp.speed * time;
    this.updateSpinners(0);
  }
  private art: LevelArt;
  private crumbleMat!: THREE.MeshStandardMaterial;
  private padMat!: THREE.MeshStandardMaterial;
  private beltMat!: THREE.MeshStandardMaterial;
  private sliderMat!: THREE.MeshStandardMaterial;
  private shutterMat!: THREE.MeshStandardMaterial;

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    def: LevelDef,
    R: typeof RAPIER,
    addStaticBox: (x: number, y: number, z: number, hx: number, hy: number, hz: number) => void,
  ) {
    const slices = def.slices;
    if (def.drum && (!Number.isFinite(def.drum.speed) || slices.some(s => Object.values(s).some(pattern => /[^#.M]/.test(pattern))) || def.spinners?.length)) {
      throw new Error("Rotating drum courses support rigid # and M panels only");
    }
    this.drum = new Drum(def.drum?.speed ?? 0);
    this.finishZ = -(slices.length * SLICE_LEN - 5);

    const floorBoxes: RunBox[] = [];
    const ceilBoxes: RunBox[] = [];
    const leftBoxes: RunBox[] = [];
    const rightBoxes: RunBox[] = [];

    const environment = def.environment ?? "dock";
    const tex = panelTexture(environment);
    const cracked = panelTexture(environment, true);
    this.disposables.push(tex, cracked);
    const slabMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.35 });
    this.disposables.push(slabMat);
    this.crumbleMat = new THREE.MeshStandardMaterial({
      map: cracked, color: 0xffd9b0, emissive: 0x8a3c12, emissiveIntensity: 0.4,
      roughness: 0.7, metalness: 0.3, transparent: true,
    });
    this.disposables.push(this.crumbleMat);
    this.padMat = new THREE.MeshStandardMaterial({
      color: 0x0d3f33, emissive: 0x2effa8, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.2,
    });
    this.beltMat = new THREE.MeshStandardMaterial({
      color: 0x123a52, emissive: 0x1f9bd6, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.3,
    });
    const deckTexture = movingDeckTexture();
    this.disposables.push(deckTexture);
    this.sliderMat = new THREE.MeshStandardMaterial({
      map: deckTexture, color: 0xc9a7ff, emissive: 0x5a2ea8, emissiveIntensity: 0.55, roughness: 0.6, metalness: 0.4,
    });
    const grille = shutterTexture();
    this.disposables.push(grille);
    this.shutterMat = new THREE.MeshStandardMaterial({
      map: grille, emissiveMap: grille, color: 0xffffff, emissive: 0xff3a2f, emissiveIntensity: 0.8, roughness: 0.45, metalness: 0.3,
    });
    this.disposables.push(this.padMat, this.beltMat, this.sliderMat, this.shutterMat);

    const faces: { key: FaceKey; out: RunBox[] }[] = [
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
          let ch = "";
          let kind: "static" | "crumble" | "empty";
          if (!s) kind = "empty";
          else {
            const p = s[key];
            if (!p) kind = "static";
            else {
              ch = p[col];
              kind = SOLID_CHARS.includes(ch) ? "static" : ch === "~" ? "crumble" : "empty";
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
          if (ch === "^") this.addPad(key, col, i);
          else if (ch === "M") this.addMagnet(key, col, i);
          else if (ch === "<" || ch === ">") this.addBelt(key, col, i, ch === ">" ? 1 : -1);
          else if (ch === "=" || ch === "+") this.addSlider(key, col, i, ch === "+" ? 0.5 : 0, world, R);
          else if (ch === "!" || ch === "?") this.addShutter(key, col, i, ch === "?" ? 0.5 : 0, world, R);
        }
      }
    }
    const all = [...floorBoxes, ...ceilBoxes, ...leftBoxes, ...rightBoxes];
    if (this.magnetGeos.length) {
      const geometry = mergeGeometries(this.magnetGeos)!;
      this.magnetGeos.forEach(g => g.dispose());
      this.magnetGeos = [];
      const material = new THREE.MeshStandardMaterial({ color: 0xf4c45e, emissive: 0xffa825, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.3 });
      this.disposables.push(geometry, material);
      this.group.add(new THREE.Mesh(geometry, material));
    }
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

    const trimMat = new THREE.MeshBasicMaterial({ color: ENVIRONMENTS[environment].trim });
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
    // Keep distant machinery still so the rotating course has a visible reference.
    for (const child of [...this.group.children]) {
      if (child.userData.scenery) this.scenery.add(child);
    }
    this.buildPortal();
    this.art = new LevelArt(def);
    this.group.add(this.art.group);

    scene.add(this.group);
    scene.add(this.scenery);
    this.drum.attach(world, R);
  }

  private addMagnet(key: FaceKey, col: number, slice: number) {
    const axes = FACE_AXES[key];
    const pos = this.surfaceCenter(key, col, slice);
    // Twin gold rails + transverse ties are legible without relying on color.
    for (const offset of [-0.55, 0.55]) {
      const geo = key === "f" || key === "c"
        ? new THREE.BoxGeometry(0.12, 0.08, SLICE_LEN)
        : new THREE.BoxGeometry(0.08, 0.12, SLICE_LEN);
      const at = pos.clone().addScaledVector(axes.normal, 0.055).addScaledVector(axes.colAxis, offset);
      geo.translate(at.x, at.y, at.z);
      this.magnetGeos.push(geo);
    }
    const tie = key === "f" || key === "c" ? new THREE.BoxGeometry(1.1, 0.06, 0.11) : new THREE.BoxGeometry(0.06, 1.1, 0.11);
    const at = pos.clone().addScaledVector(axes.normal, 0.05);
    tie.translate(at.x, at.y, at.z);
    this.magnetGeos.push(tie);
    this.magnets.push({ pos, axes });
  }

  preparePlayers(players: Player[]) {
    for (const p of players) {
      p.position(_fv);
      p.supportVelocity.set(0, 0, 0);
      if (p.grounded || p.gripping) p.supportVelocity.set(-this.drum.speed * _fv.y, this.drum.speed * _fv.x, 0);
      this.drum.toLocal(_fv);
      const available = this.magnets.some(m => this.onFeature(_fv, m.pos, m.axes, TILE / 2 - 0.08, SLICE_LEN / 2 + 0.05, 0.85));
      p.updateGrip(available);
    }
  }

  private boxForFace(key: FaceKey, col: number, startSlice: number, len: number): RunBox {
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

  /** z of the first crumble tile, so QA can stand a player on one. */
  crumbleZ(): number {
    return this.crumbleTiles[0]?.z ?? 0;
  }

  crumbleBrokenCount(): number {
    return this.crumbleTiles.filter((t) => t.broken).length;
  }

  // --- Level mechanics -----------------------------------------------------

  private surfaceCenter(key: FaceKey, col: number, sliceIdx: number): THREE.Vector3 {
    const b = this.boxForFace(key, col, sliceIdx, 1);
    return new THREE.Vector3(b.x, b.y, b.z).addScaledVector(FACE_AXES[key].normal, SLAB_T / 2);
  }

  /** A thin slab lying flat on `key`, sized in that face's own axes. */
  private plateGeo(key: FaceKey, thickness: number, shrink: number): THREE.BoxGeometry {
    const w = TILE * shrink;
    const d = SLICE_LEN * shrink;
    const g = key === "f" || key === "c"
      ? new THREE.BoxGeometry(w, thickness, d)
      : new THREE.BoxGeometry(thickness, w, d);
    this.disposables.push(g);
    return g;
  }

  private addPad(key: FaceKey, col: number, sliceIdx: number) {
    const axes = FACE_AXES[key];
    const pos = this.surfaceCenter(key, col, sliceIdx);
    const plate = new THREE.Mesh(this.plateGeo(key, 0.16, 0.82), this.padMat);
    plate.position.copy(pos).addScaledVector(axes.normal, 0.06);
    this.group.add(plate);

    const barGeo = this.plateGeo(key, 0.09, 0.5);
    const bars: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(barGeo, this.padMat);
      this.group.add(bar);
      bars.push(bar);
    }
    this.pads.push({ pos, axes, bars });
  }

  private addBelt(key: FaceKey, col: number, sliceIdx: number, dir: number) {
    const axes = FACE_AXES[key];
    const pos = this.surfaceCenter(key, col, sliceIdx);
    const plate = new THREE.Mesh(this.plateGeo(key, 0.14, 0.9), this.beltMat);
    plate.position.copy(pos).addScaledVector(axes.normal, 0.05);
    this.group.add(plate);

    const barGeo = this.plateGeo(key, 0.1, 0.26);
    const bars: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(barGeo, this.beltMat);
      this.group.add(bar);
      bars.push(bar);
    }
    this.belts.push({ pos, axes, dir, bars });
  }

  private addSlider(
    key: FaceKey, col: number, sliceIdx: number, phase: number,
    world: RAPIER.World, R: typeof RAPIER,
  ) {
    const axes = FACE_AXES[key];
    const b = this.boxForFace(key, col, sliceIdx, 1);
    const base = new THREE.Vector3(b.x, b.y, b.z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), this.sliderMat);
    this.disposables.push(mesh.geometry);
    mesh.position.copy(base);
    this.group.add(mesh);

    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(base.x, base.y, base.z),
    );
    const desc = R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups((0x0001 << 16) | 0xffff);
    world.createCollider(desc, body);
    this.sliders.push({
      body, mesh, base, axes, phase,
      pos: base.clone().addScaledVector(axes.normal, SLAB_T / 2),
      vel: 0,
    });
  }

  private addShutter(
    key: FaceKey, col: number, sliceIdx: number, phase: number,
    world: RAPIER.World, R: typeof RAPIER,
  ) {
    const axes = FACE_AXES[key];
    const surface = this.surfaceCenter(key, col, sliceIdx);
    const across = TILE * 0.9;
    const thin = 0.36;
    const geo = key === "f" || key === "c"
      ? new THREE.BoxGeometry(across, SHUTTER_HEIGHT, thin)
      : new THREE.BoxGeometry(SHUTTER_HEIGHT, across, thin);
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, this.shutterMat);
    this.group.add(mesh);

    const half = key === "f" || key === "c"
      ? new THREE.Vector3(across / 2, SHUTTER_HEIGHT / 2, thin / 2)
      : new THREE.Vector3(SHUTTER_HEIGHT / 2, across / 2, thin / 2);
    this.shutters.push({
      mesh, axes, phase, half, surface,
      center: surface.clone(), ext: 0,
    });
    void world; void R;
  }

  /**
   * Hands each player the launch and carry it has earned this step. Called
   * before the players integrate, so the values land in the same frame.
   */
  applyFeatures(players: FeatureTarget[], frame: SurfaceFrame) {
    for (const p of players) {
      p.platformLat = 0;
      p.boostUp = 0;
      if (!p.grounded) continue;
      p.position(_fv);

      this.drum.toLocal(_fv);

      for (const pad of this.pads) {
        if (this.onFeature(_fv, pad.pos, pad.axes, TILE / 2 + 0.3, SLICE_LEN / 2 + 0.3, 1.25)) {
          p.boostUp = LAUNCH_V;
          break;
        }
      }
      for (const belt of this.belts) {
        if (this.onFeature(_fv, belt.pos, belt.axes, TILE / 2 + 0.1, SLICE_LEN / 2 + 0.25, 1.1)) {
          p.platformLat += CONVEYOR_SPEED * belt.dir * belt.axes.colAxis.dot(this.drum.toLocal(_localRight.copy(frame.right)));
          break;
        }
      }
      for (const sl of this.sliders) {
        if (this.onFeature(_fv, sl.pos, sl.axes, TILE / 2 + 0.2, SLICE_LEN / 2 + 0.25, 1.1)) {
          p.platformLat += sl.vel * sl.axes.colAxis.dot(frame.right);
          break;
        }
      }
    }
  }

  private onFeature(
    p: THREE.Vector3, center: THREE.Vector3, axes: FaceAxes,
    halfCol: number, halfZ: number, maxNormal: number,
  ): boolean {
    _fd.subVectors(p, center);
    const n = _fd.dot(axes.normal);
    if (n < -0.25 || n > maxNormal) return false;
    if (Math.abs(_fd.dot(axes.colAxis)) > halfCol) return false;
    return Math.abs(_fd.z) <= halfZ;
  }

  /** Advances everything time-driven. Runs inside the fixed step. */
  updateFeatures(dt: number) {
    this.featureTime += dt;
    this.drum.advance(dt);
    this.group.quaternion.copy(this.drum.rotation);
    const t = this.featureTime;

    for (const sl of this.sliders) {
      const w = (Math.PI * 2) / SLIDER_PERIOD;
      const a = w * (t + sl.phase * SLIDER_PERIOD);
      const offset = Math.sin(a) * SLIDER_TRAVEL;
      sl.vel = Math.cos(a) * SLIDER_TRAVEL * w;
      _fv.copy(sl.base).addScaledVector(sl.axes.colAxis, offset);
      sl.body.setNextKinematicTranslation({ x: _fv.x, y: _fv.y, z: _fv.z });
      sl.mesh.position.copy(_fv);
      sl.pos.copy(_fv).addScaledVector(sl.axes.normal, SLAB_T / 2);
    }

    for (const sh of this.shutters) {
      const ext = shutterExtension(t, sh.phase);
      sh.ext = ext;
      const reach = SHUTTER_HEIGHT * ext;
      sh.center.copy(sh.surface).addScaledVector(sh.axes.normal, reach / 2 - SHUTTER_HEIGHT * 0.02);
      sh.mesh.position.copy(sh.center);
      const squash = Math.max(0.01, ext);
      if (sh.axes.colAxis.y === 0) sh.mesh.scale.set(1, squash, 1);
      else sh.mesh.scale.set(squash, 1, 1);
      sh.mesh.visible = ext > 0.02;
    }
  }

  /**
   * True when a player at `p` is inside a barrier that is across the lane.
   * Across the face this tests the player's centre rather than their full width,
   * so standing in the neighbouring lane is genuinely safe — an inflated box made
   * barriers kill people who had correctly stepped aside.
   */
  shutterHazard(p: THREE.Vector3, _halfW: number, halfH: number): boolean {
    p = this.drum.toLocal(_localPoint.copy(p));
    for (const sh of this.shutters) {
      if (sh.ext < SHUTTER_LETHAL_FRAC) continue;
      const acrossIsX = sh.axes.colAxis.y === 0;
      const dAcross = acrossIsX ? Math.abs(p.x - sh.center.x) : Math.abs(p.y - sh.center.y);
      const dUp = acrossIsX ? Math.abs(p.y - sh.center.y) : Math.abs(p.x - sh.center.x);
      if (dAcross > (acrossIsX ? sh.half.x : sh.half.y)) continue;
      if (dUp > (SHUTTER_HEIGHT * sh.ext) / 2 + halfH) continue;
      if (Math.abs(p.z - sh.center.z) > sh.half.z + 0.28) continue;
      return true;
    }
    return false;
  }

  /** Where each slider is right now, in column space, for the verification bot. */
  sliderStates(): { z: number; col: number; baseCol: number; phase: number }[] {
    return this.sliders.map((sl) => ({
      z: sl.base.z,
      col: (sl.mesh.position.dot(sl.axes.colAxis) + HALF) / TILE - 0.5,
      baseCol: (sl.base.dot(sl.axes.colAxis) + HALF) / TILE - 0.5,
      phase: sl.phase,
    }));
  }

  /** Where a slider will be `ahead` seconds from now, in column space. */
  sliderColAt(ahead: number, baseCol: number, phase: number): number {
    const w = (Math.PI * 2) / SLIDER_PERIOD;
    const a = w * (this.featureTime + ahead + phase * SLIDER_PERIOD);
    return baseCol + (Math.sin(a) * SLIDER_TRAVEL) / TILE;
  }

  /** Shutter extension `ahead` seconds from now, so the bot can plan a lane. */
  shutterExtensionAt(ahead: number, phase: number): number {
    return shutterExtension(this.featureTime + ahead, phase);
  }

  /** Feature positions, for the QA harness to aim a player at one. */
  featurePositions(): {
    magnets: [number, number, number][];
    pads: [number, number, number][];
    belts: { pos: [number, number, number]; dir: number }[];
    shutters: [number, number, number][];
  } {
    return {
      magnets: this.magnets.map(m => {
        const p = this.drum.toWorld(m.pos.clone());
        return [p.x, p.y, p.z];
      }),
      pads: this.pads.map((p) => [p.pos.x, p.pos.y, p.pos.z]),
      belts: this.belts.map((b) => ({ pos: [b.pos.x, b.pos.y, b.pos.z], dir: b.dir })),
      shutters: this.shutters.map((sh) => [sh.surface.x, sh.surface.y, sh.surface.z]),
    };
  }

  /** Live shutter timing, so the verification bot can plan around a closed lane. */
  shutterStates(): { z: number; ext: number; phase: number }[] {
    return this.shutters.map((sh) => ({ z: sh.surface.z, ext: sh.ext, phase: sh.phase }));
  }

  private animateFeatures(dt: number) {
    const t = this.featureTime;
    for (const pad of this.pads) {
      for (let i = 0; i < pad.bars.length; i++) {
        const u = ((t * 1.5 + i / pad.bars.length) % 1);
        pad.bars[i].position.copy(pad.pos).addScaledVector(pad.axes.normal, 0.25 + u * 1.5);
        pad.bars[i].scale.setScalar(Math.max(0.05, 1 - u));
      }
    }
    for (const belt of this.belts) {
      for (let i = 0; i < belt.bars.length; i++) {
        const u = ((t * 1.4 * belt.dir + i / belt.bars.length) % 1 + 1) % 1;
        belt.bars[i].position.copy(belt.pos)
          .addScaledVector(belt.axes.colAxis, (u - 0.5) * TILE * 0.86)
          .addScaledVector(belt.axes.normal, 0.12);
      }
    }
    void dt;
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
      ring.userData.scenery = true;
      this.group.add(ring);
    }

    const pipeGeo = new THREE.CylinderGeometry(1, 1, length + 60, 10);
    this.disposables.push(pipeGeo);
    for (let i = 0; i < 11; i++) {
      const pipe = new THREE.Mesh(pipeGeo, darkMat);
      const ang = i * 2.3999632297;
      const rad = HALF + 3 + (i * 7 % 11) * 0.55;
      pipe.scale.set(0.3 + (i % 4) * 0.14, 1, 0.3 + (i % 4) * 0.14);
      pipe.position.set(Math.cos(ang) * rad, Math.sin(ang) * rad, -length / 2);
      pipe.rotation.x = Math.PI / 2;
      pipe.userData.scenery = true;
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
      this.turbines.push({ obj: t, speed: 0.5 + (i % 4) * 0.22 });
      t.userData.scenery = true;
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
    this.animateFeatures(dt);
    for (const t of this.turbines) t.obj.rotation.z += t.speed * dt;
    const pulse = 0.16 + Math.sin(this.time * 3.2) * 0.09;
    (this.portalDisc.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    scene.remove(this.scenery);
    this.art.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.turbines = [];
    this.crumbleTiles = [];
    this.spinners = [];
    this.pads = [];
    this.belts = [];
    this.sliders = [];
    this.shutters = [];
  }
}

const _localRight = new THREE.Vector3();
const _localPoint = new THREE.Vector3();


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

interface Pad {
  pos: THREE.Vector3;
  axes: FaceAxes;
  bars: THREE.Mesh[];
}

interface Belt {
  pos: THREE.Vector3;
  axes: FaceAxes;
  dir: number;
  bars: THREE.Mesh[];
}

interface Slider {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  pos: THREE.Vector3;
  axes: FaceAxes;
  phase: number;
  vel: number;
}

interface Shutter {
  mesh: THREE.Mesh;
  axes: FaceAxes;
  phase: number;
  half: THREE.Vector3;
  surface: THREE.Vector3;
  center: THREE.Vector3;
  ext: number;
}

/** What Tunnel needs from a player to hand it a launch or a carry. */
export interface FeatureTarget {
  grounded: boolean;
  platformLat: number;
  boostUp: number;
  position(out: THREE.Vector3): THREE.Vector3;
}
