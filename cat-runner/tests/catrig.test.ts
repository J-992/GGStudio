import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

import {
  CAT_BONE_NAMES,
  CAT_SKELETON,
  CAT_SKELETON_DEF,
  buildCatSkeleton,
  computeSkinWeights,
  rigCat,
} from '../src/entities/CatRig';
import { buildCatClips, CAT_CLIP_NAMES } from '../src/entities/CatAnimations';

/**
 * The kitty rig is generated, not authored, so these tests are the only thing
 * standing between a tweak to a joint position and a cat whose hands are
 * welded to its skull. They run against the real mesh the game ships.
 *
 * That mesh used to be an untracked local art drop, so everything here had to
 * work against a synthetic stand-in too. `cat_model.glb` is 47 KB and lives
 * in `public/`, so it is tracked, and the real-geometry path is the one that
 * runs. The stand-in is kept for a checkout that somehow lacks it - a test
 * that silently measures nothing is worse than one that measures a stand-in.
 */

/** The shipping cat mesh - see AssetRegistry.loadCat's fallback chain. */
const GLB = new URL('../public/assets/cat/cat_model.glb', import.meta.url);

/**
 * Minimal GLB reader.
 *
 * three's GLTFLoader goes through FileLoader/XHR and cannot run under node, and
 * all these tests need is POSITION plus the index buffer.
 */
function loadGlbGeometry(path: URL): THREE.BufferGeometry {
  const buf = readFileSync(path);
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const bin = buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart));

  // Three component types, because the exporter picks the narrowest that
  // fits: a 1129-vertex mesh indexes fine in 16 bits, and reading those as
  // 32-bit would silently halve the triangle count and pair up unrelated
  // vertices rather than fail.
  const READERS: Record<number, { bytes: number; read: (at: number) => number }> = {
    5123: { bytes: 2, read: (at) => bin.readUInt16LE(at) },
    5125: { bytes: 4, read: (at) => bin.readUInt32LE(at) },
    5126: { bytes: 4, read: (at) => bin.readFloatLE(at) },
  };

  const read = (accessorIndex: number) => {
    const accessor = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[accessor.bufferView];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type as string]!;
    const total = accessor.count * components;

    const reader = READERS[accessor.componentType as number];
    if (!reader) throw new Error(`unsupported componentType ${accessor.componentType}`);

    const out = accessor.componentType === 5126 ? new Float32Array(total) : new Uint32Array(total);
    for (let i = 0; i < total; i++) out[i] = reader.read(offset + i * reader.bytes);
    return { array: out, components };
  };

  const primitive = gltf.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const pos = read(primitive.attributes.POSITION);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos.array as Float32Array, 3));
  if (primitive.indices !== undefined) {
    geometry.setIndex(new THREE.BufferAttribute(read(primitive.indices).array as Uint32Array, 1));
  }
  return geometry;
}

/**
 * A biped-shaped point cloud: legs, a torso, arms hanging at the sides, a
 * head with ears, and a short tail stub - roughly cat_model.glb's proportions
 * (0.773 wide, 1.0 tall, 0.527 deep, mirror plane at x=0.024) so bind-pose
 * geometry tests are meaningful even without the real mesh.
 */
function syntheticBipedGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  const push = (x: number, y: number, z: number) => points.push(x, y, z);
  const mp = 0.024;

  // Legs: hip to sole, both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 12; i++) {
      const y = -0.5 + (i / 12) * 0.28;
      push(mp + side * 0.06, y, 0.02);
    }
  }
  // Torso: hips to chest.
  for (let i = 0; i <= 10; i++) {
    const y = -0.24 + (i / 10) * 0.55;
    push(mp, y, 0.03);
  }
  // Arms: shoulder to hand, both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      push(mp + side * (0.18 + t * 0.15), 0.05 - t * 0.2, 0.03);
    }
  }
  // Head, with the nose forward and low relative to the ear tips (matches the
  // measured V2 mesh, where the face sits well below the ear tips).
  for (let i = 0; i <= 10; i++) {
    const y = 0.1 + (i / 10) * 0.4;
    push(mp, y, 0.05);
  }
  push(mp, 0.18, 0.26); // nose
  push(mp - 0.14, 0.49, 0.02); // ear L tip
  push(mp + 0.14, 0.49, 0.02); // ear R tip
  // Tail stub.
  push(mp, 0.19, -0.15);
  push(mp, 0.23, -0.17);
  // Corners, so the bounding box matches the real model's proportions.
  push(-0.375, -0.5, -0.256);
  push(0.383, 0.496, 0.26);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const indices: number[] = [];
  for (let i = 0; i + 2 < points.length / 3; i++) indices.push(i, i + 1, i + 2);
  geometry.setIndex(indices);
  return geometry;
}

function geometryUnderTest(): THREE.BufferGeometry {
  return existsSync(GLB) ? loadGlbGeometry(GLB) : syntheticBipedGeometry();
}

/** Bone index -> name, matching the order Skeleton() is built in. */
const nameOf = (index: number) => CAT_BONE_NAMES[index];

describe('cat skeleton', () => {
  it('declares every parent before its children', () => {
    const seen = new Set<string>();
    for (const spec of CAT_SKELETON) {
      if (spec.parent) expect(seen.has(spec.parent), `${spec.name} precedes ${spec.parent}`).toBe(true);
      seen.add(spec.name);
    }
  });

  it('is mirror-symmetric across every left/right pair', () => {
    for (const spec of CAT_SKELETON) {
      if (!spec.name.endsWith('L')) continue;
      const twin = CAT_SKELETON.find((s) => s.name === spec.name.replace(/L$/, 'R'));
      expect(twin, `${spec.name} has no right-hand twin`).toBeDefined();
      expect(twin!.at[0]).toBeCloseTo(-spec.at[0], 6);
      expect(twin!.at[1]).toBeCloseTo(spec.at[1], 6);
      expect(twin!.at[2]).toBeCloseTo(spec.at[2], 6);
      expect(twin!.reach).toBeCloseTo(spec.reach, 6);
    }
  });

  it('has the minimum joint set a biped rig needs', () => {
    const names = new Set(CAT_BONE_NAMES as readonly string[]);
    for (const required of [
      'root',
      'hips',
      'spine',
      'chest',
      'neck',
      'head',
      'earL',
      'earR',
      'tailA',
      'tailD',
      'shoulderL',
      'upperArmL',
      'lowerArmL',
      'handL',
      'shoulderR',
      'upperArmR',
      'lowerArmR',
      'handR',
      'thighL',
      'shinL',
      'footL',
      'thighR',
      'shinR',
      'footR',
    ]) {
      expect(names.has(required), `missing bone ${required}`).toBe(true);
    }
  });

  it('places the feet on the ground and the ears at the top', () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-0.375, -0.5, -0.256),
      new THREE.Vector3(0.383, 0.496, 0.26),
    );
    const { byName } = buildCatSkeleton(box);
    byName.get('root')!.updateMatrixWorld(true);

    const worldOf = (name: string) =>
      byName.get(name as never)!.getWorldPosition(new THREE.Vector3());

    for (const foot of ['footL', 'footR']) {
      expect(worldOf(foot).y).toBeCloseTo(box.min.y, 5);
    }
    // Hands hang well below the shoulders, ears sit above the head, and the
    // whole rig stacks hip -> chest -> head bottom to top.
    expect(worldOf('handL').y).toBeLessThan(worldOf('shoulderL').y);
    expect(worldOf('handR').y).toBeLessThan(worldOf('shoulderR').y);
    expect(worldOf('chest').y).toBeGreaterThan(worldOf('hips').y);
    expect(worldOf('head').y).toBeGreaterThan(worldOf('chest').y);
    expect(worldOf('earL').y).toBeGreaterThan(worldOf('head').y);
    expect(worldOf('earL').x).toBeLessThan(worldOf('earR').x);
    // The tail trails behind the body, same convention as the ground truth.
    expect(worldOf('tailD').z).toBeLessThan(worldOf('chest').z);
  });

  it('places the mirror plane at the measured offset, not the bbox centre', () => {
    // cat_model.glb's true mirror plane is x=0.024 against a bbox centre of
    // x=0.000 - see CAT_SKELETON_DEF.mirrorOffset's doc comment. A hip joint
    // authored at x=0 must resolve to the *plane*, not the centre. This mesh
    // makes the distinction sharper than the one before it did: its bounding
    // box is exactly symmetric, so "centre" and "mirror plane" cannot be
    // confused for each other by luck.
    const box = new THREE.Box3(
      new THREE.Vector3(-0.3867, -0.5, -0.2637),
      new THREE.Vector3(0.3867, 0.5, 0.2637),
    );
    const { byName } = buildCatSkeleton(box);
    byName.get('root')!.updateMatrixWorld(true);
    const hipsX = byName.get('hips')!.getWorldPosition(new THREE.Vector3()).x;
    expect(hipsX).toBeCloseTo(0.024, 3);
    expect(hipsX).not.toBeCloseTo(0, 3);
  });
});

describe('cat skinning', () => {
  const geometry = geometryUnderTest();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  computeSkinWeights(geometry, box);

  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const position = geometry.getAttribute('position');

  it('writes four influences for every vertex', () => {
    expect(skinIndex.count).toBe(position.count);
    expect(skinWeight.count).toBe(position.count);
    expect(skinIndex.itemSize).toBe(4);
  });

  it('normalises every vertex to a total weight of one', () => {
    for (let i = 0; i < skinWeight.count; i++) {
      const total =
        skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i);
      expect(total, `vertex ${i}`).toBeCloseTo(1, 4);
    }
  });

  it('emits no NaN weights and no out-of-range bone indices', () => {
    for (let i = 0; i < skinWeight.count; i++) {
      for (const get of [skinWeight.getX, skinWeight.getY, skinWeight.getZ, skinWeight.getW]) {
        const w = get.call(skinWeight, i);
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
      }
      for (const get of [skinIndex.getX, skinIndex.getY, skinIndex.getZ, skinIndex.getW]) {
        const index = get.call(skinIndex, i);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CAT_BONE_NAMES.length);
      }
    }
  });

  it('never binds a vertex to the opposite side of the body', () => {
    // The single strongest failure mode for distance-based skinning: the left
    // hand grabbing the right one, so the arms move as a welded pair.
    const mirrorX = 0.03;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) - mirrorX;
      if (Math.abs(x) < 0.05) continue;
      const wrongSide = x < 0 ? 'R' : 'L';

      let bad = 0;
      const idx = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
      const w = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      for (let k = 0; k < 4; k++) {
        if (nameOf(idx[k]).endsWith(wrongSide)) bad += w[k];
      }
      expect(bad, `vertex ${i} at x=${position.getX(i).toFixed(3)} leaks to the ${wrongSide} side`).toBeLessThan(
        0.05,
      );
    }
  });

  it('binds the soles to foot joints and the ears to ear joints', () => {
    const dominant = (i: number) => {
      const idx = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
      const w = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      let best = 0;
      for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
      return nameOf(idx[best]);
    };

    const size = box.getSize(new THREE.Vector3());
    let soles = 0;
    let solesOnLegs = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y > box.min.y + size.y * 0.06) continue;
      soles++;
      if (/foot|shin/i.test(dominant(i))) solesOnLegs++;
    }
    expect(soles).toBeGreaterThan(0);
    expect(solesOnLegs / soles).toBeGreaterThan(0.85);
  });
});

describe('rigCat', () => {
  it('turns a plain mesh into a bound SkinnedMesh', () => {
    const mesh = new THREE.Mesh(geometryUnderTest(), new THREE.MeshBasicMaterial());
    const rig = rigCat(mesh);

    expect(rig).not.toBeNull();
    expect(rig!.mesh.isSkinnedMesh).toBe(true);
    expect(rig!.skeleton.bones.length).toBe(CAT_BONE_NAMES.length);
    expect(rig!.skeleton.bones.map((b) => b.name)).toEqual([...CAT_BONE_NAMES]);
    expect(rig!.bones.get('head')).toBeDefined();
    // The bone hierarchy and the mesh must share a parent, or posing the rig
    // moves the skeleton without moving the cat.
    expect(rig!.mesh.parent).toBe(rig!.root);
    expect(rig!.bones.get('root')!.parent).toBe(rig!.root);
  });

  it('returns null for an object with no mesh', () => {
    expect(rigCat(new THREE.Group())).toBeNull();
  });

  it('actually deforms the mesh when a joint is rotated', () => {
    const mesh = new THREE.Mesh(geometryUnderTest(), new THREE.MeshBasicMaterial());
    const rig = rigCat(mesh)!;
    const before = rig.mesh.geometry.getAttribute('position');

    const sample = new THREE.Vector3();
    const posed = new THREE.Vector3();
    rig.bones.get('head')!.rotation.x = 0.8;
    rig.root.updateMatrixWorld(true);

    // The skull should swing; the feet should not care at all.
    let headMoved = 0;
    let footMoved = 0;
    for (let i = 0; i < before.count; i++) {
      sample.fromBufferAttribute(before, i);
      posed.copy(sample);
      rig.mesh.applyBoneTransform(i, posed);
      const delta = posed.distanceTo(sample);
      if (sample.y > 0.35) headMoved = Math.max(headMoved, delta);
      if (sample.y < -0.4) footMoved = Math.max(footMoved, delta);
    }
    expect(headMoved).toBeGreaterThan(0.02);
    expect(footMoved).toBeLessThan(0.005);
  });
});

describe('SkeletonDef', () => {
  it('exposes the biped def with a Y reach axis, matching the model standing tall', () => {
    expect(CAT_SKELETON_DEF.reachAxis).toBe('y');
    expect(CAT_SKELETON_DEF.bones).toBe(CAT_SKELETON);
  });
});

describe('cat animation clips', () => {
  const clips = buildCatClips();
  const names = new Set(CAT_BONE_NAMES as readonly string[]);

  it('builds every clip the cat asks for', () => {
    for (const name of CAT_CLIP_NAMES) {
      expect(clips.find((c) => c.name === name), `missing clip ${name}`).toBeDefined();
    }
  });

  it('only targets bones the skeleton actually has', () => {
    for (const clip of clips) {
      for (const track of clip.tracks) {
        const bone = track.name.split('.')[0];
        expect(names.has(bone), `${clip.name} targets unknown bone "${bone}"`).toBe(true);
      }
    }
  });

  it('gives every clip a positive duration and finite keyframes', () => {
    for (const clip of clips) {
      expect(clip.duration, clip.name).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        expect(track.times.length, `${clip.name}/${track.name}`).toBeGreaterThan(1);
        for (const t of track.times) expect(Number.isFinite(t)).toBe(true);
        for (const v of track.values) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('loops the run, idle and eat cycles seamlessly', () => {
    // `eat` is here for the same reason as the other two: it is played on
    // repeat with nothing to blend back out to (the attract screen behind the
    // main menu holds it indefinitely), so a mismatch between its first and
    // last key is a visible jolt once every cycle, forever.
    for (const name of ['run', 'idle', 'eat'] as const) {
      const clip = clips.find((c) => c.name === name)!;
      for (const track of clip.tracks) {
        const stride = track.getValueSize();
        const last = track.values.length - stride;
        for (let k = 0; k < stride; k++) {
          expect(track.values[last + k], `${name}/${track.name}[${k}]`).toBeCloseTo(
            track.values[k],
            4,
          );
        }
      }
    }
  });

  it('leaves the tail to the procedural layer', () => {
    // Cat.update() writes the tail bones directly after the mixer runs, so any
    // tail track here would be silently thrown away every frame.
    for (const clip of clips) {
      for (const track of clip.tracks) {
        expect(track.name.startsWith('tail'), `${clip.name} animates ${track.name}`).toBe(false);
      }
    }
  });

  it('alternates the legs 180 degrees out of phase in the run cycle', () => {
    const run = clips.find((c) => c.name === 'run')!;
    // AnimationMixer needs a real target hierarchy to bind to; build one with
    // just the bones the run clip touches.
    const root = new THREE.Object3D();
    const bones = new Map<string, THREE.Object3D>();
    for (const track of run.tracks) {
      const boneName = track.name.split('.')[0];
      if (!bones.has(boneName)) {
        const obj = new THREE.Object3D();
        obj.name = boneName;
        root.add(obj);
        bones.set(boneName, obj);
      }
    }
    const action = new THREE.AnimationMixer(root).clipAction(run);
    action.play();

    // Sample the two thighs across the cycle: at every instant, one should be
    // near its extreme while the other is near the opposite extreme (a true
    // alternating gait), not moving in lockstep.
    let sumProduct = 0;
    const samples = 20;
    const m = action.getMixer();
    for (let i = 0; i < samples; i++) {
      m.setTime((i / samples) * run.duration);
      const l = bones.get('thighL')!.rotation.x;
      const r = bones.get('thighR')!.rotation.x;
      sumProduct += l * r;
    }
    // Two curves exactly out of phase have a negative-leaning product on
    // average; two curves moving together would not.
    expect(sumProduct).toBeLessThan(0);
  });
});

describe('run cycle ground contact', () => {
  /**
   * The regression guard for the defect that shipped: the run clip drove the
   * cat's feet up to 0.108 through the roof on every single frame, and the
   * check that was supposed to catch it measured *joint* height instead.
   *
   * Joints are not enough. The foot mesh wraps around its joint, so a foot
   * joint sitting exactly on the floor reports "planted" while the toe and
   * heel sweep well below it. Only the posed vertices know.
   */
  it('never drives a vertex through the floor across the run cycle', () => {
    if (!existsSync(GLB)) return; // synthetic stand-in has no real feet to plant

    const rig = rigCat(new THREE.Mesh(geometryUnderTest(), new THREE.MeshBasicMaterial()))!;
    const geometry = rig.mesh.geometry;
    const position = geometry.getAttribute('position');
    geometry.computeBoundingBox();
    const floor = geometry.boundingBox!.min.y;

    const run = buildCatClips().find((c) => c.name === 'run')!;
    const mixer = new THREE.AnimationMixer(rig.root);
    mixer.clipAction(run).play();

    const source = new THREE.Vector3();
    const posed = new THREE.Vector3();

    // Sampled far more finely than the clip's 9 keyframes. The mixer slerps
    // between keys and foot height is not linear in the joint angles, so a
    // keyframe-only check passes while the in-between frames clip.
    const SAMPLES = 120;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let s = 0; s < SAMPLES; s++) {
      mixer.setTime((s / SAMPLES) * run.duration);
      rig.root.updateMatrixWorld(true);
      let frameLow = Infinity;
      for (let i = 0; i < position.count; i++) {
        source.fromBufferAttribute(position, i);
        posed.copy(source);
        rig.mesh.applyBoneTransform(i, posed);
        if (posed.y < frameLow) frameLow = posed.y;
      }
      lowest = Math.min(lowest, frameLow);
      highest = Math.max(highest, frameLow);
    }

    // A hair of tolerance for float error in the skinning maths, and no more.
    expect(lowest, 'lowest posed vertex dips below the bind-pose floor').toBeGreaterThan(
      floor - 1e-4,
    );
    // The other failure mode: over-correcting until the cat skates along above
    // the roof instead of touching it.
    expect(highest - floor, 'cat hovers instead of planting').toBeLessThan(0.06);
  });
});
