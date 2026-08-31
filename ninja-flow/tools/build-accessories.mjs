/**
 * NINJA FLOW accessory pipeline.
 *
 * Turns downloaded cosmetic props into one small GLB per item, normalised so
 * the wardrobe can hang any of them on any character without per-item fiddling:
 *
 *   - +Y is up and +Z is the way the character faces, whatever the artist used
 *   - the piece is centred on its own bounding box and scaled so its longest
 *     side is 1, so the runtime fitter's "as wide as the head" arithmetic works
 *     in one consistent range instead of on a hat authored at 662 units
 *   - a prop modelled as a PAIR (boots, pauldrons) is cut down to its right-hand
 *     half, because a pair mounts on two separate foot bones, not one
 *
 * The orientation of each source is stated in the recipe, not guessed. Every one
 * was read off a three-view contact sheet before it was written down here — a
 * bounding box cannot tell a hat's brim from its back, and a helmet that ships
 * facing sideways is worse than no helmet.
 *
 * Sizes come almost entirely from textures: the fox mask arrives as 21 MB of
 * 4096px maps for a prop that is forty pixels tall on a phone. Normal, ORM and
 * emissive maps are dropped outright and what remains is resized, which is what
 * turns 39 MB of downloads into something a first load can carry.
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
  dedup,
  prune,
  simplify,
  textureCompress,
  transformMesh,
  weld,
  quantize,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Matrix4, Vector3 } from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RAW = path.join('.assets_raw', 'accessories');
const OUT = path.join('public', 'cosmetics');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * `yaw` is the turn, in degrees about +Y, that puts the piece's own forward on
 * +Z. `half` keeps only the +X side of a modelled pair. `detail` is the share
 * of triangles kept — these are already low-poly, so most keep all of them.
 */
const RECIPES = [
  // --- headwear
  { id: 'head-warhelm', file: 'low_poly_samurai_helmet.glb', yaw: -90, name: 'Black kabuto', detail: 0.5 },
  { id: 'head-onimen', file: 'oni_mask__stylized_samurai_demon_mask_low_poly.glb', yaw: 0, name: 'Oni men' },
  { id: 'head-kitsune', file: 'inari_fox_mask.glb', yaw: 0, name: 'Kitsune mask', texture: 256 },
  { id: 'head-drifter', file: 'low_poly_cowboy_hat.glb', yaw: 0, name: 'Drifter hat', texture: 256 },
  { id: 'head-sunhat', file: 'summer_hat.glb', yaw: 0, name: 'Sun hat', texture: 256, detail: 0.6 },
  { id: 'head-cap', file: 'low_poly_game_ready_simple_cap.glb', yaw: 0, name: 'Ball cap', texture: 256 },
  // The headphones are the one source the simplifier cannot touch: every face
  // carries its own split vertices, so a weld finds nothing to merge and meshopt
  // has no connected surface to collapse. They stay at full density.
  { id: 'head-cans', file: 'low_poly_headphones.glb', yaw: 0, name: 'Headphones' },
  // --- shoulders: modelled as a pair split along Z, so it is turned first and
  // then cut, which leaves the split on X where the mirror can use it.
  { id: 'arms-pauldrons', file: 'lowpoly_shoulders_armor.glb', yaw: 90, half: true, name: 'Steel pauldrons', texture: 256 },
  // --- back
  { id: 'back-makimono', file: 'scroll_low_poly.glb', yaw: 90, name: 'Makimono', texture: 256 },
  // --- footwear, both modelled as pairs
  { id: 'feet-boots', file: 'boots_low-poly_shoes.glb', yaw: 0, half: true, name: 'Trail boots' },
  { id: 'feet-sneakers', file: 'low_poly_sneakers.glb', yaw: -90, half: true, name: 'Sneakers' },
];

/** Bakes every node transform into vertex data, in the given root frame. */
function bakeWorld(doc, root) {
  const scene = doc.getRoot().listScenes()[0];
  const done = new Set();
  const visit = (node, parent) => {
    const world = new Matrix4().multiplyMatrices(parent, new Matrix4().fromArray(node.getMatrix()));
    for (const child of node.listChildren()) visit(child, world);
    const mesh = node.getMesh();
    if (mesh) {
      if (done.has(mesh)) {
        throw new Error(`mesh "${mesh.getName()}" is instanced under two nodes; baking would double it`);
      }
      done.add(mesh);
      transformMesh(mesh, world.toArray());
    }
    node.setMatrix(new Matrix4().toArray());
  };
  for (const node of scene.listChildren()) visit(node, root);
}

/** Applies a matrix to every mesh already baked into scene space. */
function transformAll(doc, matrix) {
  const array = matrix.toArray();
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, array);
}

/**
 * Cuts a modelled pair down to the character's right-hand half.
 *
 * That half is the one at NEGATIVE X. A character facing +Z has their right
 * hand on a viewer's left, so every "Right" bone on these rigs sits at -X, and
 * exporting the +X piece would ship a left boot for the right foot and a
 * pauldron that hangs into the ribs.
 *
 * Triangles are kept by the sign of their centroid rather than by vertex, so a
 * triangle that straddles the centre line goes wholly to one side instead of
 * leaving a hole. Anything that ends up with no triangles at all is dropped.
 */
function keepRightHalf(doc) {
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const kept = [];
      const e = [0, 0, 0];
      for (let t = 0; t < count; t += 3) {
        let x = 0;
        const tri = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getScalar(t + k) : t + k;
          tri[k] = v;
          pos.getElement(v, e);
          x += e[0];
        }
        if (x / 3 < 0) kept.push(tri[0], tri[1], tri[2]);
      }
      if (kept.length === 0) {
        mesh.removePrimitive(prim);
        prim.dispose();
        dropped++;
        continue;
      }
      const accessor = idx ?? doc.createAccessor();
      accessor.setArray(new Uint32Array(kept));
      if (!idx) prim.setIndices(accessor.setBuffer(doc.getRoot().listBuffers()[0]));
      compactPrimitive(prim);
    }
  }
  return dropped;
}

/**
 * Drops every map but base colour.
 *
 * These props are a few dozen pixels tall in play and never larger than a
 * thumbnail on the character screen, so a normal map is pure download for a
 * detail the screen cannot resolve.
 */
function baseColourOnly(doc) {
  for (const material of doc.getRoot().listMaterials()) {
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
    if (!material.getMetallicRoughnessTexture()) continue;
    material.setMetallicRoughnessTexture(null);
    // These sources ship metallic=1 in the factor and rely on the map to pull it
    // back down per pixel. Dropping the map without dropping the factor leaves a
    // fully metallic surface with nothing to reflect, which renders as near
    // black — the fox mask came out grey the first time this ran. None of these
    // props are metal, so the factor goes with the map.
    material.setMetallicFactor(0);
    material.setRoughnessFactor(Math.max(0.5, material.getRoughnessFactor()));
  }
}

async function build(recipe) {
  const doc = await io.read(path.join(RAW, recipe.file));
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();

  const yaw = new Matrix4().makeRotationY((recipe.yaw * Math.PI) / 180);
  bakeWorld(doc, yaw);
  if (recipe.half && keepRightHalf(doc) > 0) {
    // A pair whose halves live in separate primitives loses whole primitives
    // here, which is expected; a pair that loses all of them is a bad `yaw`.
    if (doc.getRoot().listMeshes().every((m) => m.listPrimitives().length === 0)) {
      throw new Error(`${recipe.id}: nothing survived the half cut — check yaw`);
    }
  }

  const scene = doc.getRoot().listScenes()[0];
  let bounds = getBounds(scene);
  const size = new Vector3(...bounds.max).sub(new Vector3(...bounds.min));
  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 0)) throw new Error(`${recipe.id}: empty after processing`);
  const centre = new Vector3(...bounds.max).add(new Vector3(...bounds.min)).multiplyScalar(0.5);
  const scale = 1 / longest;
  transformAll(
    doc,
    new Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z)),
  );

  baseColourOnly(doc);
  await doc.transform(
    weld(),
    ...(recipe.detail && recipe.detail < 1
      ? [simplify({ simplifier: MeshoptSimplifier, ratio: recipe.detail, error: 0.008 })]
      : []),
    ...(recipe.texture
      ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [recipe.texture, recipe.texture] })]
      : []),
    prune(),
    dedup(),
    quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD)/ }),
  );

  mkdirSync(OUT, { recursive: true });
  const bytes = await io.writeBinary(doc);
  writeFileSync(path.join(OUT, `${recipe.id}.glb`), bytes);

  bounds = getBounds(doc.getRoot().listScenes()[0]);
  const final = new Vector3(...bounds.max).sub(new Vector3(...bounds.min));
  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) verts += prim.getAttribute('POSITION').getCount();
  }
  return {
    id: recipe.id,
    name: recipe.name,
    source: recipe.file,
    bytes: bytes.byteLength,
    verts,
    size: [final.x, final.y, final.z].map((n) => +n.toFixed(3)),
  };
}

const report = [];
for (const recipe of RECIPES) {
  try {
    const r = await build(recipe);
    report.push(r);
    console.log(
      `${r.id.padEnd(16)} ${String(r.verts).padStart(6)} verts  ${(r.bytes / 1024).toFixed(1).padStart(7)} KB  ` +
        `size ${r.size.map((n) => n.toFixed(2)).join(' ')}`,
    );
  } catch (err) {
    console.error(`${recipe.id}: ${err.message}`);
    process.exitCode = 1;
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(report, null, 2));
const total = report.reduce((n, r) => n + r.bytes, 0);
console.log(`\n${report.length} accessories, ${(total / 1024).toFixed(0)} KB total`);
