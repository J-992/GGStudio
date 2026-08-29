/**
 * NINJA FLOW weapon pipeline.
 *
 * Turns downloaded weapon packs into one small GLB per weapon, normalised so
 * the game can attach any of them to any hand without per-weapon fiddling:
 *
 *   - the grip sits at the origin, so a hand holds it where a hand would
 *   - the blade points along +Y, so one hold transform works for every weapon
 *   - every weapon is scaled to a target length in metres, so a tanto is short
 *     and a nagamaki is long RELATIVE TO EACH OTHER rather than to whatever
 *     units the artist happened to model in
 *
 * Which end is the grip is not guessed from the bounding box: it is taken from
 * the part names, by comparing the centroid of the handle parts against the
 * centroid of the blade parts. A pack that names its parts differently will
 * fail loudly here rather than shipping a weapon held by the blade.
 *
 * Sources are CC-BY and their attribution travels with the output — see
 * ASSET_LICENSES.md, which this script's manifest feeds.
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  cloneDocument,
  dedup,
  prune,
  simplify,
  textureCompress,
  weld,
  quantize,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RAW = path.join('.assets_raw', 'weapons');
const OUT = path.join('public', 'weapons');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Weapons to emit. `parts` matches mesh names; `exclude` drops variants we do
 * not want (sheaths, belts, and the covers that only make sense sheathed).
 * `length` is the finished blade-tip-to-pommel size in metres.
 */
const RECIPES = [
  // --- Brunoszwa pack: five weapon types, each in a plain and a decorated cut
  { id: 'katana', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Katana_/,
    exclude: /Sheath|Cover|Decorated|Detailed|_H_/, length: 1.04, name: 'Katana' },
  { id: 'katana-ornate', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Katana_/,
    exclude: /Sheath|Cover|_L_|Handguard_Blade|Handle_Grip/, length: 1.04, name: 'Ornate katana' },
  { id: 'wakizashi', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Wakizashi_/,
    exclude: /Sheath|Serrated|Decorated/, length: 0.72, name: 'Wakizashi' },
  { id: 'wakizashi-serrated', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Wakizashi_/,
    exclude: /Sheath|Handguard_Grip|Handguard_Golden|Blade_Blade/, length: 0.72, name: 'Serrated wakizashi' },
  { id: 'ninjato', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Ninjato_/,
    exclude: /Sheath|Cover|Decorated|\.001/, length: 0.88, name: 'Ninjato' },
  { id: 'ninjato-gold', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Ninjato_/,
    exclude: /Sheath|Cover|Handle_Blade|Handle_Grip_Black_0|Handguard_Blade_Rough_Dark_0|Blade_Blade/, length: 0.88, name: 'Gilded ninjato' },
  { id: 'nagamaki', file: 'low-poly_japanese_swords.glb', match: /^Sword_Japan_Nagamaki_/,
    exclude: /Sheath|Cover|Decorated|\.001/, length: 1.5, name: 'Nagamaki' },
  // The pack's "Tanto" is really eleven blade shapes sharing one handle, so it
  // is split into separate weapons rather than shipped as one 5k-vertex prop
  // with every blade stacked inside it.
  { id: 'tanto', file: 'low-poly_japanese_swords.glb',
    match: /^Sword_Japan_Tanto_(Handle_Light|Handle_Rope|Handguard|Blade_1_)/,
    exclude: /Sheath|Curved/, length: 0.42, name: 'Tanto' },
  { id: 'tanto-hooked', file: 'low-poly_japanese_swords.glb',
    match: /^Sword_Japan_Tanto_(Handle_Light|Handle_Rope|Handguard|Blade_7_)/,
    exclude: /Sheath|Curved/, length: 0.44, name: 'Hooked tanto' },
  { id: 'tanto-broad', file: 'low-poly_japanese_swords.glb',
    match: /^Sword_Japan_Tanto_(Handle_Light|Handle_Rope|Handguard|Blade_11_)/,
    exclude: /Sheath|Curved/, length: 0.46, name: 'Broad tanto' },
  // --- single-model packs
  // These two are single weapons whose parts are not named by function, so the
  // long axis is found by principal component and the grip end is stated here
  // rather than guessed. Both were checked in-engine after the first build.
  { id: 'katana-worn', file: 'katana_low_poly.glb', match: /./, exclude: /$^/, length: 1.02,
    name: 'Worn katana', orient: 'pca', gripEnd: 'min' },
  { id: 'katana-scifi', file: 'low-poly_scifi_katana.glb', match: /./, exclude: /$^/, length: 1.06,
    name: 'Sci-fi katana', orient: 'pca', gripEnd: 'min' },
];

/** Part-name fragments that identify the handle end of a weapon. */
const HANDLE_HINT = /handle|grip|handguard|guard|pommel|tsuka/i;
const BLADE_HINT = /blade|edge/i;

const SOURCES = new Map();
async function load(file) {
  if (!SOURCES.has(file)) SOURCES.set(file, await io.read(path.join(RAW, file)));
  return SOURCES.get(file);
}

/**
 * Longest axis of a point cloud, by power iteration on its covariance.
 *
 * Used for weapons whose parts are not named by function: a bounding box is no
 * help when the model was authored on a diagonal, but an elongated object has
 * one dominant principal component and that is its length.
 */
function principalAxis(points, mean) {
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const d = new Vector3();
  for (const p of points) {
    d.copy(p).sub(mean);
    cov[0] += d.x * d.x; cov[1] += d.x * d.y; cov[2] += d.x * d.z;
    cov[3] += d.y * d.x; cov[4] += d.y * d.y; cov[5] += d.y * d.z;
    cov[6] += d.z * d.x; cov[7] += d.z * d.y; cov[8] += d.z * d.z;
  }
  let v = new Vector3(1, 1, 1).normalize();
  const next = new Vector3();
  for (let i = 0; i < 48; i++) {
    next.set(
      cov[0] * v.x + cov[1] * v.y + cov[2] * v.z,
      cov[3] * v.x + cov[4] * v.y + cov[5] * v.z,
      cov[6] * v.x + cov[7] * v.y + cov[8] * v.z,
    );
    if (next.lengthSq() < 1e-12) break;
    v = next.clone().normalize();
  }
  return v;
}

/** Sampled world-space vertices of every kept node. */
function samplePoints(nodes) {
  const out = [];
  const v = new Vector3();
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const step = Math.max(1, Math.floor(pos.getCount() / 240));
      for (let i = 0; i < pos.getCount(); i += step) {
        const e = [0, 0, 0];
        pos.getElement(i, e);
        out.push(v.set(e[0], e[1], e[2]).applyMatrix4(world).clone());
      }
    }
  }
  return out;
}

/** World-space centroid of a node's mesh vertices. */
function centroid(node, out = new Vector3()) {
  const mesh = node.getMesh();
  out.set(0, 0, 0);
  if (!mesh) return out;
  const world = new Matrix4().fromArray(node.getWorldMatrix());
  const v = new Vector3();
  let n = 0;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const step = Math.max(1, Math.floor(pos.getCount() / 64));
    for (let i = 0; i < pos.getCount(); i += step) {
      const e = [0, 0, 0];
      pos.getElement(i, e);
      v.set(e[0], e[1], e[2]).applyMatrix4(world);
      out.add(v);
      n++;
    }
  }
  if (n > 0) out.multiplyScalar(1 / n);
  return out;
}

async function buildWeapon(recipe) {
  const source = await load(recipe.file);
  const doc = cloneDocument(source);
  const scene = doc.getRoot().listScenes()[0];

  // Drop every node that is not part of this weapon.
  const kept = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = mesh.getName();
    if (!recipe.match.test(name) || recipe.exclude.test(name)) {
      node.setMesh(null);
    } else {
      kept.push(node);
    }
  }
  if (kept.length === 0) throw new Error(`${recipe.id}: no parts matched`);

  // Work out which end the hand goes on from the part names, never from a
  // guess about geometry.
  const handle = new Vector3();
  const blade = new Vector3();
  if (recipe.orient === 'pca') {
    const points = samplePoints(kept);
    const mean = new Vector3();
    for (const p of points) mean.add(p);
    mean.multiplyScalar(1 / points.length);
    const axis = principalAxis(points, mean);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      const t = new Vector3().subVectors(p, mean).dot(axis);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    const gripT = recipe.gripEnd === 'max' ? hi : lo;
    const tipT = recipe.gripEnd === 'max' ? lo : hi;
    handle.copy(mean).addScaledVector(axis, gripT);
    blade.copy(mean).addScaledVector(axis, tipT);
  } else {
    let handleN = 0;
    let bladeN = 0;
    const c = new Vector3();
    for (const node of kept) {
      const name = node.getMesh().getName();
      centroid(node, c);
      if (HANDLE_HINT.test(name)) {
        handle.add(c);
        handleN++;
      } else if (BLADE_HINT.test(name)) {
        blade.add(c);
        bladeN++;
      }
    }
    if (handleN === 0 || bladeN === 0) {
      throw new Error(`${recipe.id}: could not identify handle (${handleN}) and blade (${bladeN}) parts`);
    }
    handle.multiplyScalar(1 / handleN);
    blade.multiplyScalar(1 / bladeN);
  }

  await doc.transform(prune(), dedup());

  // Orient: the handle→blade axis becomes +Y.
  const axis = new Vector3().subVectors(blade, handle).normalize();
  const up = new Vector3(0, 1, 0);
  const quat = new Quaternion().setFromUnitVectors(axis, up);
  const rotate = new Matrix4().makeRotationFromQuaternion(quat);

  const bounds = getBounds(scene);
  const box = new Box3(
    new Vector3(...bounds.min).applyMatrix4(rotate),
    new Vector3(...bounds.max).applyMatrix4(rotate),
  );
  // applyMatrix4 on the corners alone is not a rotated AABB, so rebuild it.
  const rotated = new Box3().makeEmpty();
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? bounds.max[0] : bounds.min[0],
      i & 2 ? bounds.max[1] : bounds.min[1],
      i & 4 ? bounds.max[2] : bounds.min[2],
    );
    rotated.expandByPoint(corner.applyMatrix4(rotate));
  }
  void box;

  const length = rotated.max.y - rotated.min.y;
  const scale = recipe.length / length;
  // The origin goes at the BUTT of the weapon, not at the centroid of its
  // handle parts. For a katana those are nearly the same point; for a nagamaki
  // with a metre of handle the centroid sits halfway up the shaft, which would
  // hand the holder a weapon gripped in the middle. A small inset keeps the
  // hand just above the pommel rather than exactly on its end.
  const inset = (recipe.gripInset ?? 0.05) / scale;
  const gripY = rotated.min.y + inset;

  // One wrapper node carries orientation, scale and the grip-to-origin shift,
  // so the exported weapon needs no runtime correction at all.
  const wrapper = doc.createNode(recipe.id);
  const matrix = new Matrix4()
    .makeTranslation(0, -gripY * scale, 0)
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(rotate);
  wrapper.setMatrix(matrix.toArray());
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  // A weapon is a prop held at arm's length in a 2.5D frame: it never needs a
  // 16k-triangle blade or a 1024px texture. Welding first gives the simplifier
  // a connected surface to work on, or it can only collapse within a triangle.
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: recipe.detail ?? 0.4, error: 0.01 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256] }),
    prune(),
    dedup(),
    quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD)/ }),
  );

  mkdirSync(OUT, { recursive: true });
  const bytes = await io.writeBinary(doc);
  writeFileSync(path.join(OUT, `${recipe.id}.glb`), bytes);

  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) verts += prim.getAttribute('POSITION').getCount();
  }
  return { id: recipe.id, name: recipe.name, bytes: bytes.byteLength, verts, parts: kept.length };
}

mkdirSync(OUT, { recursive: true });

const report = [];
for (const recipe of RECIPES) {
  try {
    const r = await buildWeapon(recipe);
    report.push(r);
    console.log(
      `${r.id.padEnd(20)} ${String(r.parts).padStart(2)} parts  ${String(r.verts).padStart(6)} verts  ${(r.bytes / 1024).toFixed(1)} KB`,
    );
  } catch (err) {
    console.error(`${recipe.id}: ${err.message}`);
    process.exitCode = 1;
  }
}

writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(report, null, 2));
const total = report.reduce((n, r) => n + r.bytes, 0);
console.log(`\n${report.length} weapons, ${(total / 1024).toFixed(0)} KB total`);
