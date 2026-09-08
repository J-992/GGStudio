#!/usr/bin/env node
/**
 * Convert art-src/ into the compressed runtime assets under public/assets/.
 *
 * A port of zombie-motorworks/scripts/convert-voxel-assets.mjs to ArenaDefense's
 * asset list: OBJ/FBX geometry loaded with three's loaders under a DOM stub
 * (Node has no <img>/<canvas>), assembled into a glTF-Transform Document,
 * welded/deduped/pruned, meshopt-compressed (which also quantizes — see
 * `meshopt()` in @gltf-transform/functions), with textures re-encoded to
 * WebP by sharp before they ever reach glTF-Transform. Unlike the
 * zombie-motorworks converter (one mesh per output file), several outputs
 * here pack multiple named meshes into one GLB, because the runtime looks
 * them up by name out of a single scene (dressing.glb, rocks.glb, props.glb).
 *
 *   node scripts/build-assets.mjs
 *
 * Idempotent: re-running regenerates every output from the same art-src/
 * inputs and produces byte-identical results (no randomness, no timestamps
 * in the glTF).
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { installDomStub } from './lib/dom-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(GAME_DIR, '..');
const PIPELINE_DIR = path.resolve(REPO_ROOT, 'glb-pipeline');

// glTF-Transform, meshoptimizer and sharp live in the sibling `glb-pipeline`
// package (the repo's home for asset tooling). This script is dev-only, so
// it borrows them rather than duplicating the dependency block into the game.
const pipelineRequire = createRequire(path.join(PIPELINE_DIR, 'package.json'));
function requirePipeline(specifier) {
  try {
    return pipelineRequire(specifier);
  } catch (error) {
    console.error(`Missing "${specifier}". Run \`npm install\` in ${PIPELINE_DIR} first.`);
    throw error;
  }
}

const { Document, NodeIO } = requirePipeline('@gltf-transform/core');
const { ALL_EXTENSIONS } = requirePipeline('@gltf-transform/extensions');
const { dedup, prune, weld, meshopt } = requirePipeline('@gltf-transform/functions');
const { MeshoptEncoder } = requirePipeline('meshoptimizer');
const sharp = requirePipeline('sharp');

// ---------------------------------------------------------------------------
// three.js in Node
// ---------------------------------------------------------------------------

installDomStub();

const THREE = await import('three');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ART_SRC = path.join(GAME_DIR, 'art-src');
const OUT = path.join(GAME_DIR, 'public', 'assets');
const COMBAT_AUDIO_SRC = path.join(REPO_ROOT, 'zombie-motorworks', 'public', 'assets', 'audio');

const ZED_DIR = path.join(ART_SRC, 'Shared/voxel/characters/Package/OBJ');
const GRAVEYARD_DIR = path.join(ART_SRC, 'Shared/voxel/env/Assets');
const ROCK_DIR = path.join(ART_SRC, 'Shared/Ultimate Stylized Nature - May 2022/OBJ');
const BUILDINGS_DIR = path.join(ART_SRC, 'Shared/voxel/env/Buildings');
const SPRITES_SRC_DIR = path.join(ART_SRC, 'Steal-A-Brainrot/assets/sprites');
const FONT_DIR = path.join(ART_SRC, 'Shared/Fonts/Lillita_One');
const UI_SFX_DIR = path.join(ART_SRC, 'Shared/Sound/OGG');

const sizeReport = [];
function record(relOutPath, absPath) {
  const size = fs.statSync(absPath).size;
  sizeReport.push({ path: relOutPath, size });
  return size;
}

// ---------------------------------------------------------------------------
// three loaders -> flat { geometry, materialName, color } per mesh
// ---------------------------------------------------------------------------

/** Parse an OBJ, expecting exactly one mesh with one material. */
function loadObjMesh(filePath) {
  const root = new OBJLoader().parse(fs.readFileSync(filePath, 'utf8'));
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  if (meshes.length !== 1) throw new Error(`${filePath}: expected 1 mesh, found ${meshes.length}`);
  const mesh = meshes[0];
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  return { geometry, materialName: material?.name ?? null, color: material?.color ?? new THREE.Color(0xffffff) };
}

/**
 * Parse an FBX, expecting exactly one mesh with one material. Synty authors
 * in centimetres — `scaleFactor` bakes the cm->m conversion (0.01) into the
 * vertices, same as zombie-motorworks's VoxelAssetLoader.loadFbxObject.
 */
function loadFbxMesh(filePath, scaleFactor) {
  const buffer = fs.readFileSync(filePath);
  const root = new FBXLoader().parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    `${path.dirname(filePath)}/`,
  );
  root.scale.setScalar(scaleFactor);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  if (meshes.length !== 1) throw new Error(`${filePath}: expected 1 mesh, found ${meshes.length}`);
  const mesh = meshes[0];
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  return { geometry, materialName: material?.name ?? null, color: material?.color ?? new THREE.Color(0xffffff) };
}

/** Translate so the geometry's own minimum Y lands on 0 ("feet at y=0"). */
function groundAtOrigin(geometry) {
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox.min.y;
  geometry.translate(0, -minY, 0);
  return geometry;
}

/** Bounding box height (Y extent) of a geometry, without mutating it. */
function heightOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.max.y - geometry.boundingBox.min.y;
}

/** Uniform scale about the origin (use after grounding, or before — commutes). */
function uniformScale(geometry, s) {
  geometry.scale(s, s, s);
  return geometry;
}

/** Remap a UV attribute in place: u' = u*su + ou, v' = v*sv + ov. */
function remapUV(geometry, su, ou, sv, ov) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  }
  uv.needsUpdate = true;
  return geometry;
}

function attributeArray(geometry, name) {
  const attribute = geometry.getAttribute(name);
  if (!attribute) return null;
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
  }
  return { array: out, itemSize: attribute.itemSize };
}

// ---------------------------------------------------------------------------
// glTF-Transform assembly helpers
// ---------------------------------------------------------------------------

const { MagFilter, MinFilter } = requirePipeline('@gltf-transform/core').TextureInfo;

/** Add one named mesh (geometry + material + optional shared texture) as a scene node. */
function addPart(document, scene, { name, geometry, color, texture, nearest }) {
  const position = attributeArray(geometry, 'position');
  if (!position) throw new Error(`${name}: geometry has no positions`);
  const normal = attributeArray(geometry, 'normal');
  const uv = attributeArray(geometry, 'uv');

  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(position.array));
  if (normal) {
    primitive.setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(normal.array));
  }
  if (uv) {
    primitive.setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(uv.array));
  }
  if (geometry.index) {
    primitive.setIndices(
      document.createAccessor().setType('SCALAR').setArray(new Uint32Array(geometry.index.array)),
    );
  }

  const material = document
    .createMaterial(name)
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setBaseColorFactor([color.r, color.g, color.b, 1]);

  if (texture) {
    material.setBaseColorTexture(texture);
    const info = material.getBaseColorTextureInfo();
    if (nearest) info.setMagFilter(MagFilter.NEAREST).setMinFilter(MinFilter.NEAREST);
  }

  primitive.setMaterial(material);
  const mesh = document.createMesh(name).addPrimitive(primitive);
  scene.addChild(document.createNode(name).setMesh(mesh));
}

/** Read a PNG/etc and re-encode as WebP with sharp; returns {data, mimeType}. */
async function encodeWebp(buffer, { resize, lossless = false, quality = 90 } = {}) {
  let image = sharp(buffer);
  if (resize) image = image.resize(resize.width, resize.height);
  const data = await image.webp({ lossless, quality }).toBuffer();
  return { data, mimeType: 'image/webp' };
}

async function optimizeAndWrite(document, outPath) {
  await MeshoptEncoder.ready;
  await document.transform(
    // Exact weld only: these are voxel/low-poly meshes with hard palette-UV
    // seams, and merging across a seam would smear one flat colour into its
    // neighbour.
    weld({ tolerance: 0 }),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const glb = await io.writeBinary(document);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, glb);
  return glb.byteLength;
}

function newDocument(sceneName) {
  const document = new Document();
  document.createBuffer();
  // Suffixed so the scene can never collide with a node inside it. three.js's
  // GLTFLoader passes every name through `createUniqueName`, so a node sharing
  // the scene's name loads as `<name>_1` and a lookup by the authored name
  // misses — which is exactly how `zed_1.glb` (one node `zed_1` in a scene
  // `zed_1`) shipped a mesh three.js called `zed_1_1`.
  const scene = document.createScene(`${sceneName}_scene`);
  return { document, scene };
}

// ---------------------------------------------------------------------------
// 1) models/zed_1.glb, models/zed_3.glb — voxel smalls
// ---------------------------------------------------------------------------

/**
 * Target world height for a Zed walker, feet at y=0. The plan called for
 * "the node scale zombie-motorworks uses (3.2)" — that 3.2 turns out to be an
 * artifact of gltf-transform's KHR_mesh_quantization node-scale correction in
 * zombie-motorworks's shipped Zed_1.glb (it exactly reproduces the *raw* OBJ's
 * own bounding-box half-height, 3.2 units out of a 6.4-unit-tall raw model),
 * not a deliberately chosen design multiplier — zombie-motorworks's own
 * ZED_MODEL_SCALE (0.23) on top of that yields ~1.47 m in play, not 1.8 m. So
 * rather than reproduce a coincidence, this computes the scale directly from
 * each raw OBJ's bounding box to hit the ~1.8 m the brief actually asks for.
 */
const ZED_TARGET_HEIGHT_M = 1.8;

async function buildZed(key, srcBase) {
  const objPath = path.join(ZED_DIR, `${srcBase}.obj`);
  const pngPath = path.join(ZED_DIR, `${srcBase}.png`);

  const { geometry, color } = loadObjMesh(objPath);
  const rawHeight = heightOf(geometry);
  const scale = ZED_TARGET_HEIGHT_M / rawHeight;
  groundAtOrigin(geometry);
  uniformScale(geometry, scale);

  const { document, scene } = newDocument(key);
  const encoded = await encodeWebp(fs.readFileSync(pngPath), { lossless: true });
  const texture = document.createTexture(`${srcBase}_palette`).setImage(encoded.data).setMimeType(encoded.mimeType);
  addPart(document, scene, { name: key, geometry, color, texture, nearest: true });

  const outPath = path.join(OUT, 'models', `${key}.glb`);
  const bytes = await optimizeAndWrite(document, outPath);
  record(`models/${key}.glb`, outPath);
  return { key, heightM: ZED_TARGET_HEIGHT_M, rawHeight, scale, facing: '+Z', meshes: [key], bytes };
}

// ---------------------------------------------------------------------------
// 2) models/dressing.glb — graveyard fence/pillar/tomb
// ---------------------------------------------------------------------------

async function buildDressing() {
  const parts = [
    { name: 'SM-7-Fence', base: 'SM-7-Fence' },
    { name: 'SM-8-Pillar', base: 'SM-8-Pillar' },
    { name: 'SM-3-Tomb1', base: 'SM-3-Tomb1' },
  ];

  const { document, scene } = newDocument('dressing');

  // All three graveyard palette PNGs are byte-identical (verified via md5)
  // -> one shared texture for the whole file.
  const paletteBuf = fs.readFileSync(path.join(GRAVEYARD_DIR, `${parts[0].base}.png`));
  const encoded = await encodeWebp(paletteBuf, { lossless: true });
  const sharedTexture = document.createTexture('graveyard_palette').setImage(encoded.data).setMimeType(encoded.mimeType);

  for (const part of parts) {
    const { geometry, color } = loadObjMesh(path.join(GRAVEYARD_DIR, `${part.base}.obj`));
    groundAtOrigin(geometry);
    addPart(document, scene, { name: part.name, geometry, color, texture: sharedTexture, nearest: true });
  }

  const outPath = path.join(OUT, 'models', 'dressing.glb');
  const bytes = await optimizeAndWrite(document, outPath);
  record('models/dressing.glb', outPath);
  return { meshes: parts.map((p) => p.name), bytes, sharedTexture: true };
}

// ---------------------------------------------------------------------------
// 3) models/rocks.glb — Quaternius rocks, flat colour, no textures
// ---------------------------------------------------------------------------

async function buildRocks() {
  const names = ['Rock_1', 'Rock_2', 'Rock_4'];
  const { document, scene } = newDocument('rocks');
  for (const name of names) {
    const { geometry, color } = loadObjMesh(path.join(ROCK_DIR, `${name}.obj`));
    groundAtOrigin(geometry);
    addPart(document, scene, { name, geometry, color, texture: null });
  }
  const outPath = path.join(OUT, 'models', 'rocks.glb');
  const bytes = await optimizeAndWrite(document, outPath);
  record('models/rocks.glb', outPath);
  return { meshes: names, bytes };
}

// ---------------------------------------------------------------------------
// 4) models/props.glb — six FBX props, one combined 512px atlas + one tiny
//    palette strip (<=2 images total)
// ---------------------------------------------------------------------------

const FBX_SCALE = 0.01; // Synty centimetres -> metres

async function buildProps() {
  const { document, scene } = newDocument('props');

  // Props_01_diffuse.png and Props_02_diffuse.png are the two real 4096x4096
  // Synty atlases (8.6 MB each on disk). Downscaled to 512px each and packed
  // side by side into one 1024x512 image so the whole file carries a single
  // "big" texture; UVs of the meshes that reference each half are remapped
  // into that half accordingly.
  const props01 = await sharp(path.join(BUILDINGS_DIR, 'Props_01_diffuse.png')).resize(512, 512).toBuffer();
  const props02 = await sharp(path.join(BUILDINGS_DIR, 'Props_02_diffuse.png')).resize(512, 512).toBuffer();
  const combinedPng = await sharp({
    create: { width: 1024, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: props01, left: 0, top: 0 },
      { input: props02, left: 512, top: 0 },
    ])
    .png()
    .toBuffer();
  const atlasEncoded = await encodeWebp(combinedPng, { quality: 80 });
  const atlasTexture = document
    .createTexture('props_atlas')
    .setImage(atlasEncoded.data)
    .setMimeType(atlasEncoded.mimeType);

  // Gun_03's own texture turned out to be a 256x1 palette strip (like the
  // voxel characters), not a third real atlas — cheap to keep as its own
  // second image and still land well under the 2-image cap.
  const paletteEncoded = await encodeWebp(
    fs.readFileSync(path.join(BUILDINGS_DIR, 'VoxelApocalypse_Character.png')),
    { lossless: true },
  );
  const paletteTexture = document
    .createTexture('voxel_apocalypse_palette')
    .setImage(paletteEncoded.data)
    .setMimeType(paletteEncoded.mimeType);

  // name -> { atlasHalf: 'left'|'right'|null, ground: bool }
  // Gun_03/Gun_02 are handheld viewmodels: their authored local origin is the
  // grip/mount pivot (already near the model's own y~0), not a floor contact
  // point, so — unlike the four structural props — they are NOT re-grounded;
  // doing so would drag the pivot away from where Player.js wants to hold it.
  const specs = [
    { name: 'Gun_03', atlas: 'palette', ground: false },
    { name: 'Gun_02', atlas: null, ground: false },
    { name: 'AmmoBox_5', atlas: 'left', ground: true },
    { name: 'AttachedBoxes', atlas: 'left', ground: true },
    { name: 'Barricade_03', atlas: 'right', ground: true },
    { name: 'BarbedWires', atlas: 'right', ground: true },
  ];

  const deviations = [];
  for (const spec of specs) {
    const { geometry, color } = loadFbxMesh(path.join(BUILDINGS_DIR, `${spec.name}.fbx`), FBX_SCALE);
    if (spec.ground) groundAtOrigin(geometry);

    let texture = null;
    let nearest = false;
    if (spec.atlas === 'left') {
      remapUV(geometry, 0.5, 0, 1, 0);
      texture = atlasTexture;
    } else if (spec.atlas === 'right') {
      remapUV(geometry, 0.5, 0.5, 1, 0);
      texture = atlasTexture;
    } else if (spec.atlas === 'palette') {
      texture = paletteTexture;
      nearest = true;
    } else {
      deviations.push(`${spec.name}: no source texture found (VoxelApocalypseZombie_Export-78-Weapon_Gun-2.png is not part of the fetched set) — shipped with its flat FBX material colour instead.`);
    }

    addPart(document, scene, { name: spec.name, geometry, color, texture, nearest });
  }

  const outPath = path.join(OUT, 'models', 'props.glb');
  const bytes = await optimizeAndWrite(document, outPath);
  record('models/props.glb', outPath);
  return { meshes: specs.map((s) => s.name), bytes, images: 2, deviations };
}

// ---------------------------------------------------------------------------
// 5) sprites/brainrot.webp + brainrot.json, sprites/portrait-*.webp
// ---------------------------------------------------------------------------

const BRAINROT_NAMES = ['patapim', 'tungtung', 'bombardiro', 'tralalero', 'assassino', 'lirili'];
const PORTRAIT_NAMES = ['patapim', 'lirili', 'bombardiro', 'tralalero', 'assassino'];
const ATLAS_SIZE = 1024;
const CELL = 256;
const PORTRAIT_SIZE = 128;
const ALPHA_CUT = 0.02 * 255;

/** Alpha bounding box of an RGBA image, in pixel coordinates (top-left origin). */
async function alphaBBox(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { width, height } = await image.metadata();
  const raw = await image.raw().toBuffer();
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const a = raw[rowBase + x * 4 + 3];
      if (a > ALPHA_CUT) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('fully transparent sprite');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Alpha-crop, fit inside a `box`x`box` square by the longer side, and
 * composite onto a transparent `box`x`box` canvas. `anchor: 'bottom'` sits
 * the art on the cell's bottom edge (feet-on-ground, for the atlas cells);
 * `anchor: 'center'` centres it both ways (for portraits).
 * Mirrors Steal-A-Brainrot/tools/import-images.py's crop+fit+ground logic.
 */
async function fitSprite(buffer, box, anchor) {
  const bbox = await alphaBBox(buffer);
  const cropped = await sharp(buffer).extract(bbox).toBuffer();
  const k = Math.min(box / bbox.width, box / bbox.height);
  const nw = Math.max(1, Math.round(bbox.width * k));
  const nh = Math.max(1, Math.round(bbox.height * k));
  const resized = await sharp(cropped).resize(nw, nh).toBuffer();
  const left = Math.floor((box - nw) / 2);
  const top = anchor === 'bottom' ? box - nh : Math.floor((box - nh) / 2);
  const canvas = await sharp({ create: { width: box, height: box, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
  return { canvas, cropW: bbox.width, cropH: bbox.height };
}

async function buildSprites() {
  const cells = {};
  const composites = [];
  for (let i = 0; i < BRAINROT_NAMES.length; i++) {
    const name = BRAINROT_NAMES[i];
    const buf = fs.readFileSync(path.join(SPRITES_SRC_DIR, `cr_${name}.png`));
    const { canvas, cropW, cropH } = await fitSprite(buf, CELL, 'bottom');
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = col * CELL;
    const y = row * CELL;
    composites.push({ input: canvas, left: x, top: y });
    cells[name] = {
      x,
      y,
      w: CELL,
      h: CELL,
      u0: x / ATLAS_SIZE,
      v0: y / ATLAS_SIZE,
      u1: (x + CELL) / ATLAS_SIZE,
      v1: (y + CELL) / ATLAS_SIZE,
      aspect: cropW / cropH,
    };
  }

  const atlasPng = await sharp({
    create: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
  // Lossless first (flat cel-shaded art compresses well); fall back to a
  // near-lossless quality if that ever balloons past budget.
  let atlasWebp = await sharp(atlasPng).webp({ lossless: true }).toBuffer();
  if (atlasWebp.byteLength > 200 * 1024) {
    atlasWebp = await sharp(atlasPng).webp({ quality: 95, alphaQuality: 100 }).toBuffer();
  }
  const atlasOut = path.join(OUT, 'sprites', 'brainrot.webp');
  fs.mkdirSync(path.dirname(atlasOut), { recursive: true });
  fs.writeFileSync(atlasOut, atlasWebp);
  record('sprites/brainrot.webp', atlasOut);

  const jsonOut = path.join(OUT, 'sprites', 'brainrot.json');
  const meta = {
    _comment:
      'Pixel coords + normalized UVs into brainrot.webp (1024x1024, 4x4 grid of 256px cells, top-left origin, y-down — u=x/1024, v=y/1024). Each sprite is alpha-cropped, fit to its cell by the longer side, and bottom-aligned (feet on the cell floor). aspect = cropped-art width/height.',
    atlas: 'sprites/brainrot.webp',
    size: ATLAS_SIZE,
    cell: CELL,
    sprites: cells,
  };
  fs.writeFileSync(jsonOut, `${JSON.stringify(meta, null, 2)}\n`);
  record('sprites/brainrot.json', jsonOut);

  for (const name of PORTRAIT_NAMES) {
    const buf = fs.readFileSync(path.join(SPRITES_SRC_DIR, `cr_${name}.png`));
    const { canvas } = await fitSprite(buf, PORTRAIT_SIZE, 'center');
    const webp = await sharp(canvas).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
    const outPath = path.join(OUT, 'sprites', `portrait-${name}.webp`);
    fs.writeFileSync(outPath, webp);
    record(`sprites/portrait-${name}.webp`, outPath);
  }

  return { cells };
}

// ---------------------------------------------------------------------------
// 6) fonts/
// ---------------------------------------------------------------------------

function buildFont() {
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  const ttfOut = path.join(OUT, 'fonts', 'LilitaOne-Regular.ttf');
  fs.copyFileSync(path.join(FONT_DIR, 'LilitaOne-Regular.ttf'), ttfOut);
  record('fonts/LilitaOne-Regular.ttf', ttfOut);
  const oflOut = path.join(OUT, 'fonts', 'OFL.txt');
  fs.copyFileSync(path.join(FONT_DIR, 'OFL.txt'), oflOut);
  record('fonts/OFL.txt', oflOut);
}

// ---------------------------------------------------------------------------
// 7) audio/
// ---------------------------------------------------------------------------

const UI_SFX = [
  { src: 'UI SFX_MENU_Scroll.ogg', dest: 'ui-click.ogg' },
  { src: 'UI SFX_FEEDBACK_Positive.ogg', dest: 'ui-place.ogg' },
  { src: 'UI SFX_FEEDBACK_Negative.ogg', dest: 'ui-deny.ogg' },
  { src: 'UI SFX_EXTRA_Quick Sub Descending.ogg', dest: 'wave-start.ogg' },
  { src: 'UI SFX_FEEDBACK_Alert.ogg', dest: 'boss-alert.ogg' },
  { src: 'UI SFX_FEEDBACK_Woop.ogg', dest: 'coin.ogg' },
];

const COMBAT_SFX = [
  'pistol-shot-1.ogg',
  'turret-shot-1.ogg',
  'impact-heavy.ogg',
  'zombie-death-1.ogg',
  'zombie-attack-1.ogg',
  'explosion-metal.ogg',
  'mechanical-clunk.ogg',
  'upgrade-confirm.ogg',
  // Per-weapon shot sounds (see `config.player.weapons`).
  'pistol-shot-2.ogg',
  'gunfire.ogg',
  'cannon-shot-1.ogg',
  'sniper-shot-1.ogg',
];

function buildAudio() {
  fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });
  for (const { src, dest } of UI_SFX) {
    const outPath = path.join(OUT, 'audio', dest);
    fs.copyFileSync(path.join(UI_SFX_DIR, src), outPath);
    record(`audio/${dest}`, outPath);
  }
  for (const name of COMBAT_SFX) {
    const outPath = path.join(OUT, 'audio', name);
    fs.copyFileSync(path.join(COMBAT_AUDIO_SRC, name), outPath);
    record(`audio/${name}`, outPath);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

async function main() {
  const deviations = [];

  fs.mkdirSync(OUT, { recursive: true });

  const zed1 = await buildZed('zed_1', 'Zed_1');
  const zed3 = await buildZed('zed_3', 'Zed_3');
  const dressing = await buildDressing();
  const rocks = await buildRocks();
  const props = await buildProps();
  deviations.push(...props.deviations);
  const sprites = await buildSprites();
  buildFont();
  buildAudio();

  const manifest = {
    generatedBy: 'scripts/build-assets.mjs',
    models: {
      'models/zed_1.glb': {
        meshes: zed1.meshes,
        heightM: zed1.heightM,
        facingAxis: zed1.facing,
        facingAxisNote: 'Assumed from OBJ proportions (X=width > Z=depth); not visually verified — flip in code if the walk direction looks backwards.',
        feetAtY0: true,
      },
      'models/zed_3.glb': {
        meshes: zed3.meshes,
        heightM: zed3.heightM,
        facingAxis: zed3.facing,
        facingAxisNote: 'Same assumption as zed_1.',
        feetAtY0: true,
      },
      'models/dressing.glb': {
        meshes: dressing.meshes,
        sharedTexture: dressing.sharedTexture,
        feetAtY0: true,
        units: 'metres, as authored (no rescale)',
      },
      'models/rocks.glb': {
        meshes: rocks.meshes,
        feetAtY0: true,
        textures: 0,
        units: 'metres, as authored (no rescale)',
      },
      'models/props.glb': {
        meshes: props.meshes,
        images: props.images,
        fbxScale: FBX_SCALE,
        groundedMeshes: ['AmmoBox_5', 'AttachedBoxes', 'Barricade_03', 'BarbedWires'],
        ungroundedMeshes: ['Gun_03', 'Gun_02'],
        ungroundedNote: 'Gun_03/Gun_02 keep their authored grip/mount pivot instead of being re-grounded to their bbox floor, so Player.js has a sane attach point for a handheld viewmodel.',
      },
    },
    sprites: {
      'sprites/brainrot.webp': { size: ATLAS_SIZE, cell: CELL, names: BRAINROT_NAMES },
      'sprites/brainrot.json': { rects: sprites.cells },
      portraits: PORTRAIT_NAMES.map((n) => `sprites/portrait-${n}.webp`),
    },
    fonts: ['fonts/LilitaOne-Regular.ttf', 'fonts/OFL.txt'],
    audio: {
      ui: UI_SFX.map((s) => `audio/${s.dest}`),
      combat: COMBAT_SFX.map((s) => `audio/${s}`),
    },
    files: {},
  };
  for (const { path: relPath, size } of sizeReport) manifest.files[relPath] = size;

  const manifestOut = path.join(OUT, 'manifest.json');
  fs.writeFileSync(manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSize = record('manifest.json', manifestOut);

  console.log('\nWritten to public/assets/:\n');
  const nameWidth = Math.max(...sizeReport.map((r) => r.path.length));
  let total = 0;
  for (const { path: relPath, size } of sizeReport) {
    total += size;
    console.log(`  ${relPath.padEnd(nameWidth)}  ${fmtBytes(size).padStart(10)}`);
  }
  console.log(`\n  ${'TOTAL'.padEnd(nameWidth)}  ${fmtBytes(total).padStart(10)}  (manifest.json included: ${fmtBytes(manifestSize)})`);

  if (deviations.length > 0) {
    console.log('\nDeviations from the brief:');
    for (const d of deviations) console.log(`  - ${d}`);
    console.log(
      `  - models/zed_1.glb, models/zed_3.glb: scale computed directly from each raw OBJ's bounding box to hit ${ZED_TARGET_HEIGHT_M} m (see manifest.json models entry + comment in build-assets.mjs) rather than reusing zombie-motorworks's node scale, which turned out to be a quantization artifact, not a design constant.`,
    );
    console.log(
      '  - models/props.glb: Gun_03/Gun_02 are not re-grounded to y=0 (kept at their authored grip pivot) — see manifest.json.',
    );
  }
}

await main();
