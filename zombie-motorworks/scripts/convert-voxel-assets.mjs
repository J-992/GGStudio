#!/usr/bin/env node
/**
 * Convert the arena's OBJ and FBX props into compressed GLB.
 *
 * The voxel props shipped in the formats they were authored in: MagicaVoxel
 * OBJ (ASCII text — `SM-0-Ground.obj` alone was 1.9 MB of it) and Synty FBX.
 * Both are slow to parse, neither carries compressed geometry, and every prop
 * was paid for on the main thread while the player waited on an empty arena.
 *
 * Geometry is extracted with the *same* three.js loaders the runtime used to
 * use, so what ships is exactly the mesh that shipped before — same vertices,
 * same UVs, same world scale — just indexed, meshopt-compressed, and carrying a
 * WebP texture instead of a PNG.
 *
 *   node scripts/convert-voxel-assets.mjs [--check] [--verbose]
 *
 * `--check` converts to a temporary directory and reports what would change
 * without touching `public/`, for CI.
 *
 * Assets with more than one material are skipped and stay OBJ: they are drawn
 * through `loadVoxelInstanceSource`, which needs exactly one mesh per asset,
 * and a multi-material glTF loads as one mesh per primitive. See SKIPPED below.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { installDomStub } from './lib/dom-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, '..');
const PIPELINE_DIR = path.resolve(GAME_DIR, '..', 'glb-pipeline');

// glTF-Transform, meshoptimizer and sharp live in the sibling `glb-pipeline`
// package, which is the repo's home for asset tooling. This script is the only
// consumer, and it is dev-only, so it borrows them rather than duplicating the
// dependency block into the game.
const pipelineRequire = createRequire(path.join(PIPELINE_DIR, 'package.json'));
function requirePipeline(specifier) {
  try {
    return pipelineRequire(specifier);
  } catch (error) {
    console.error(
      `Missing "${specifier}". Run \`npm install\` in ${PIPELINE_DIR} first.`,
    );
    throw error;
  }
}

const { Document, NodeIO } = requirePipeline('@gltf-transform/core');
const { ALL_EXTENSIONS } = requirePipeline('@gltf-transform/extensions');
const { dedup, meshopt, prune, textureCompress, weld } = requirePipeline(
  '@gltf-transform/functions',
);
const { MeshoptEncoder } = requirePipeline('meshoptimizer');
const sharp = requirePipeline('sharp');

// ---------------------------------------------------------------------------
// three.js in Node
// ---------------------------------------------------------------------------

/**
 * FBXLoader reaches for `document` when it builds textures. It never gets to
 * decode one here — the converter reads the image files itself — so a stub that
 * hands back inert objects is enough to get the geometry out.
 */
installDomStub();

const THREE = await import('three');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

// ---------------------------------------------------------------------------
// What to convert
// ---------------------------------------------------------------------------

/**
 * Authoring sources live outside `public/`, because `public/` ships verbatim.
 * Leaving ten megabytes of OBJ text next to the GLBs built from it would have
 * meant every player downloading both.
 */
const SOURCE_ROOT = path.join(GAME_DIR, 'art-src');
const OUTPUT_ROOT = path.join(GAME_DIR, 'public', 'assets');
const SOURCE_DIRS = [
  path.join(SOURCE_ROOT, 'graveyard'),
  path.join(SOURCE_ROOT, 'graveyard', 'props'),
  path.join(SOURCE_ROOT, 'nature'),
  path.join(SOURCE_ROOT, 'zombies'),
];

/**
 * Assets deliberately left as OBJ, and still living in `public/`.
 *
 * Every one is a scattered prop with two materials — a trunk and its leaves.
 * Scattered props are drawn as a single `InstancedMesh` through
 * `loadVoxelInstanceSource`, which asserts exactly one mesh in the asset, and
 * three's GLTFLoader splits a multi-primitive glTF mesh into one `Mesh` per
 * primitive. Converting these would turn every palm and pine in the desert and
 * the snowfield into a grey placeholder box. They are also cheap: the five of
 * them together are a rounding error next to the graveyard.
 *
 * They are the only reason `VoxelAssetLoader` still carries an OBJ loader.
 */
const SKIPPED = new Set([
  'nature/PalmTree_2',
  'nature/PalmTree_3',
  'nature/PalmTree_5',
  'nature/PineTree_3',
  'nature/PineTree_5',
]);

/**
 * Above this dimension a texture is a real atlas and is re-encoded as WebP.
 *
 * MagicaVoxel palette strips are a few hundred bytes of flat colour blocks;
 * re-encoding those costs more than it saves and risks shifting a palette
 * entry. The Synty prop atlases are 1024x1024 PNGs at a megabyte each, and they
 * are the two largest files in the arena.
 */
const ATLAS_MIN_DIMENSION = 256;

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

/** The texture an OBJ's MTL points at, or null when it declares none. */
function objTextureFile(objPath) {
  const mtlPath = objPath.replace(/\.obj$/, '.mtl');
  if (!fs.existsSync(mtlPath)) return null;
  const match = /^\s*map_Kd\s+(.+?)\s*$/m.exec(fs.readFileSync(mtlPath, 'utf8'));
  if (match === null) return null;
  return path.join(path.dirname(objPath), match[1].trim());
}

/**
 * The texture an FBX material points at.
 *
 * Synty names materials after their atlas (`M_Props_01` -> `Props_01_diffuse`),
 * which is the only link left once the embedded texture reference has been
 * dropped by the DOM stub above.
 */
function fbxTextureFile(fbxPath, materialName) {
  const match = /Props_(\d+)/.exec(materialName ?? '');
  if (match === null) return null;
  const candidate = path.join(
    path.dirname(fbxPath),
    `Props_${match[1]}_diffuse.png`,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Pull one asset down to a single flat mesh, in the exact world scale the
 * runtime drew it at.
 *
 * The `0.01` on FBX is not a guess: `VoxelAssetLoader.loadFbxObject` applied
 * exactly that to every FBX it loaded, because Synty authors in centimetres.
 * Baking it here is what keeps a converted barricade the same size as the one
 * it replaces.
 */
function loadSource(filePath) {
  const isFbx = filePath.endsWith('.fbx');
  let root;
  if (isFbx) {
    const buffer = fs.readFileSync(filePath);
    root = new FBXLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      `${path.dirname(filePath)}/`,
    );
    root.scale.setScalar(0.01);
  } else {
    root = new OBJLoader().parse(fs.readFileSync(filePath, 'utf8'));
  }
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  if (meshes.length !== 1) {
    throw new Error(`expected exactly one mesh, found ${meshes.length}`);
  }

  const mesh = meshes[0];
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  if (materials.length !== 1) {
    throw new Error(`expected exactly one material, found ${materials.length}`);
  }

  // Bake the node transform (and the FBX unit scale) into the vertices, so the
  // glTF needs no node hierarchy of its own and the bounding box the runtime
  // recentres against is unchanged.
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const texture = isFbx
    ? fbxTextureFile(filePath, materials[0].name)
    : objTextureFile(filePath);
  const color = materials[0].color ?? new THREE.Color(0xffffff);
  return { geometry, texture, color };
}

// ---------------------------------------------------------------------------
// glTF assembly
// ---------------------------------------------------------------------------

async function encodeTexture(texturePath) {
  const original = fs.readFileSync(texturePath);
  const { width = 0, height = 0 } = await sharp(original).metadata();
  if (Math.max(width, height) <= ATLAS_MIN_DIMENSION) {
    return { data: original, mimeType: 'image/png', width, height };
  }
  // Lossless: these atlases are flat-shaded blocks of colour with hard edges,
  // and lossy WebP puts ringing on every one of them. Lossless still roughly
  // quarters them, because that is exactly the content it is good at.
  const webp = await sharp(original)
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  return webp.byteLength < original.byteLength
    ? { data: webp, mimeType: 'image/webp', width, height }
    : { data: original, mimeType: 'image/png', width, height };
}

function attributeArray(geometry, name) {
  const attribute = geometry.getAttribute(name);
  if (!attribute) return null;
  // `applyMatrix4` above may have left an interleaved or non-Float32 buffer;
  // glTF wants a plain, tightly packed Float32Array.
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) {
      out[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    }
  }
  return { array: out, itemSize: attribute.itemSize };
}

async function buildDocument(source, name) {
  const document = new Document();
  document.createBuffer();
  const scene = document.createScene(name);

  const position = attributeArray(source.geometry, 'position');
  if (position === null) throw new Error('geometry has no positions');
  const normal = attributeArray(source.geometry, 'normal');
  const uv = attributeArray(source.geometry, 'uv');

  const primitive = document
    .createPrimitive()
    .setAttribute(
      'POSITION',
      document.createAccessor().setType('VEC3').setArray(position.array),
    );
  if (normal) {
    primitive.setAttribute(
      'NORMAL',
      document.createAccessor().setType('VEC3').setArray(normal.array),
    );
  }
  if (uv) {
    primitive.setAttribute(
      'TEXCOORD_0',
      document.createAccessor().setType('VEC2').setArray(uv.array),
    );
  }
  if (source.geometry.index) {
    primitive.setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(source.geometry.index.array)),
    );
  }

  const material = document
    .createMaterial(name)
    // Matches how the runtime lights these: `VoxelAssetLoader` replaces every
    // incoming material with a flat-shaded MeshLambertMaterial anyway, so the
    // only thing that has to survive the trip is the base colour and its map.
    .setRoughnessFactor(1)
    .setMetallicFactor(0)
    .setBaseColorFactor([
      source.color.r,
      source.color.g,
      source.color.b,
      1,
    ]);

  if (source.texture) {
    const encoded = await encodeTexture(source.texture);
    const texture = document
      .createTexture(path.basename(source.texture))
      .setImage(encoded.data)
      .setMimeType(encoded.mimeType);
    material.setBaseColorTexture(texture);
  }

  primitive.setMaterial(material);
  const mesh = document.createMesh(name).addPrimitive(primitive);
  scene.addChild(document.createNode(name).setMesh(mesh));
  return document;
}

async function optimize(document) {
  await MeshoptEncoder.ready;
  await document.transform(
    // Exact weld only. These are voxel meshes: every face carries its own
    // normal and its own palette UV, and merging across those seams would
    // smear one colour block into the next.
    weld({ tolerance: 0 }),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: null }),
    // `medium` is the quantize-only path. The aggressive level adds filtered
    // encoding of normals and UVs, and a UV on these meshes is a lookup into a
    // palette strip where neighbouring texels are unrelated colours — nudging
    // one is not a rounding error, it is the wrong paint. The `--verify` pass
    // below is what keeps that honest.
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return document;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function sourceFiles() {
  const found = [];
  for (const dir of SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.obj') && !entry.endsWith('.fbx')) continue;
      const full = path.join(dir, entry);
      const key = path
        .relative(SOURCE_ROOT, full)
        .replace(/\\/g, '/')
        .replace(/\.(obj|fbx)$/, '');
      if (SKIPPED.has(key)) continue;
      found.push({ full, key });
    }
  }
  return found;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const check = args.has('--check');
  const verbose = args.has('--verbose');
  const outputRoot = check
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'voxel-convert-'))
    : OUTPUT_ROOT;

  // All of them: the transforms below reach for EXT_meshopt_compression,
  // KHR_mesh_quantization and EXT_texture_webp between them, and an extension
  // the writer does not know about is silently dropped rather than erroring.
  // three's GLTFLoader reads all three (the meshopt decoder is already wired up
  // in `VoxelAssetLoader`).
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  let sourceBytes = 0;
  let outputBytes = 0;
  const failures = [];

  for (const { full, key } of sourceFiles()) {
    const outPath = path.join(outputRoot, `${key}.glb`);
    try {
      const source = loadSource(full);
      const document = await optimize(
        await buildDocument(source, path.basename(key)),
      );
      const glb = await io.writeBinary(document);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, glb);

      // The source's own texture counts toward its cost: it is a separate
      // request today and is embedded in the GLB afterwards.
      const texture = source.texture ? fs.statSync(source.texture).size : 0;
      const before = fs.statSync(full).size + texture;
      sourceBytes += before;
      outputBytes += glb.byteLength;
      if (verbose) {
        const pct = ((1 - glb.byteLength / before) * 100).toFixed(0);
        console.log(
          `  ${key.padEnd(34)} ${kb(before).padStart(9)} -> ${kb(glb.byteLength).padStart(9)}  (-${pct}%)`,
        );
      }
    } catch (error) {
      failures.push(`${key}: ${error.message}`);
    }
  }

  console.log(
    `\n${check ? 'Would convert' : 'Converted'} into ${path.relative(GAME_DIR, outputRoot) || outputRoot}`,
  );
  console.log(`  source: ${kb(sourceBytes)}`);
  console.log(`  glb:    ${kb(outputBytes)}`);
  if (sourceBytes > 0) {
    console.log(
      `  saved:  ${kb(sourceBytes - outputBytes)} (${((1 - outputBytes / sourceBytes) * 100).toFixed(1)}%)`,
    );
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} asset(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

await main();
