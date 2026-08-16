#!/usr/bin/env node
/**
 * Prove a converted GLB draws the same prop its OBJ or FBX source did.
 *
 * `convert-voxel-assets.mjs` indexes, quantizes and meshopt-compresses every
 * arena prop. All three are lossy in principle, and one of them is lossy in a
 * way that matters here: these meshes look up their colour through a UV into a
 * palette strip, where neighbouring texels are unrelated colours rather than a
 * gradient. A UV nudged by one quantization step is not a rounding error, it is
 * the wrong paint on the model.
 *
 * So this reloads both sides through the same three.js loaders the game uses
 * and compares what the runtime actually depends on:
 *
 *   - the bounding box, because `loadTemplate` recentres against it and every
 *     placement scale in the recipes is expressed relative to it;
 *   - the triangle count, because a dropped or duplicated face is a hole;
 *   - the sampled palette texel for every vertex, because that is the colour.
 *
 *   node scripts/verify-voxel-assets.mjs [--verbose]
 *
 * Exits non-zero on any mismatch outside tolerance.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { installDomStub } from './lib/dom-stub.mjs';

installDomStub();

const THREE = await import('three');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import(
  'three/examples/jsm/libs/meshopt_decoder.module.js'
);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, '..');
/** Built GLBs live here; their OBJ/FBX sources live in `art-src/`. */
const OUTPUT_ROOT = path.join(GAME_DIR, 'public', 'assets');
const SOURCE_ROOT = path.join(GAME_DIR, 'art-src');

/**
 * Tolerances.
 *
 * Positions are compared in metres and UVs in palette texels, because a texel
 * is the unit that actually matters: these meshes look up a flat colour block,
 * and the narrowest palette in the set is 256 wide. Quantization is expected to
 * move things a little; it is not expected to move a vertex onto the next
 * colour.
 */
const POSITION_TOLERANCE = 2e-3;
const UV_TEXEL_TOLERANCE = 0.5;
const PALETTE_WIDTH = 256;
/** Surface area may drift by quantization, but not by a dropped face. */
const AREA_TOLERANCE_FRACTION = 0.005;

function meshesOf(root) {
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

/**
 * Every triangle the object draws, in world space, reduced to what the runtime
 * can actually tell apart: where it sits and which palette texel it samples.
 *
 * Reduced to centroids on purpose. Welding and reordering both renumber and
 * reorder vertices, so there is no vertex-to-vertex correspondence left to
 * compare against — but a triangle's centroid survives both.
 */
function triangles(root) {
  const out = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const mesh of meshesOf(root)) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    // Read through `fromBufferAttribute` and transform a scratch vector, never
    // `geometry.applyMatrix4`. A quantized glTF arrives as a *normalized
    // Int16Array*, and `applyMatrix4` writes its results straight back into
    // that buffer — truncating every coordinate to a whole integer and
    // destroying the mesh it was supposed to be measuring. Getting this wrong
    // is what made a perfectly good conversion look like it had doubled the
    // model's surface area.
    for (let i = 0; i < count; i += 3) {
      const [i0, i1, i2] = index
        ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
        : [i, i + 1, i + 2];
      a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld);
      const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
      out.push({
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
        u: uv ? (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3 : null,
        v: uv ? (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3 : null,
        area,
      });
    }
  }
  return out;
}

/**
 * Compare two equal-length value lists as multisets: sort both, then pair them
 * off, and report the largest gap.
 *
 * Sorting per channel rather than trying to match triangle to triangle is
 * deliberate. A voxel mesh has thousands of near-identical coordinates, so any
 * spatial pairing is ambiguous the moment quantization nudges one past another
 * — and a pairing that silently mismatches reports enormous drift for a mesh
 * that is actually fine. What is actually being asked is whether the *set* of
 * coordinates changed, and that question has an unambiguous answer.
 */
function worstMultisetGap(from, to) {
  const left = [...from].sort((a, b) => a - b);
  const right = [...to].sort((a, b) => a - b);
  let worst = 0;
  for (let i = 0; i < left.length; i++) {
    worst = Math.max(worst, Math.abs(left[i] - right[i]));
  }
  return worst;
}

function loadSourceObject(filePath) {
  if (filePath.endsWith('.fbx')) {
    const buffer = fs.readFileSync(filePath);
    const root = new FBXLoader().parse(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      `${path.dirname(filePath)}/`,
    );
    root.scale.setScalar(0.01);
    root.updateMatrixWorld(true);
    return root;
  }
  const root = new OBJLoader().parse(fs.readFileSync(filePath, 'utf8'));
  root.updateMatrixWorld(true);
  return root;
}

function loadGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      `${path.dirname(filePath)}/`,
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        resolve(gltf.scene);
      },
      reject,
    );
  });
}

function boxOf(root) {
  return new THREE.Box3().setFromObject(root);
}

/**
 * Scattered and repeated props are drawn as one `InstancedMesh`, built from the
 * asset's raw geometry plus the mesh's local matrix (`loadVoxelInstanceSource`).
 * A compressed GLB keeps its positions as normalized integers and puts the
 * scale that decodes them on the node — so if that matrix were ever dropped,
 * every fence, road tile and rock would draw at raw quantization units. This
 * checks that geometry-plus-matrix reproduces the scene the loader would draw.
 */
function instancingProblems(converted) {
  const meshes = meshesOf(converted);
  if (meshes.length !== 1) return [];
  const mesh = meshes[0];
  const attribute = mesh.geometry.getAttribute('position');

  const viaMatrix = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i++) {
    viaMatrix.expandByPoint(
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld),
    );
  }

  const direct = new THREE.Box3().setFromObject(converted);
  const problems = [];
  for (const corner of ['min', 'max']) {
    for (const axis of ['x', 'y', 'z']) {
      const delta = Math.abs(viaMatrix[corner][axis] - direct[corner][axis]);
      if (delta > POSITION_TOLERANCE) {
        problems.push(
          `instanced ${corner}.${axis} would draw at ` +
            `${viaMatrix[corner][axis].toFixed(4)} instead of ${direct[corner][axis].toFixed(4)}`,
        );
      }
    }
  }
  return problems;
}

async function compare(sourcePath, glbPath) {
  const problems = [];
  const source = loadSourceObject(sourcePath);
  const converted = await loadGlb(glbPath);
  problems.push(...instancingProblems(converted));

  if (meshesOf(converted).length !== 1) {
    problems.push(
      `converted asset has ${meshesOf(converted).length} meshes, ` +
        'runtime instancing needs exactly 1',
    );
  }

  const sourceBox = boxOf(source);
  const convertedBox = boxOf(converted);
  for (const corner of ['min', 'max']) {
    for (const axis of ['x', 'y', 'z']) {
      const delta = Math.abs(sourceBox[corner][axis] - convertedBox[corner][axis]);
      if (delta > POSITION_TOLERANCE) {
        problems.push(
          `bounds ${corner}.${axis} moved ${delta.toFixed(5)}m ` +
            `(${sourceBox[corner][axis].toFixed(4)} -> ${convertedBox[corner][axis].toFixed(4)})`,
        );
      }
    }
  }

  const sourceTris = triangles(source);
  const convertedTris = triangles(converted);
  if (sourceTris.length !== convertedTris.length) {
    problems.push(`triangles ${sourceTris.length} -> ${convertedTris.length}`);
    return { problems, sourceTris: sourceTris.length, worstTexels: 0, worstPosition: 0 };
  }

  const sourceArea = sourceTris.reduce((total, tri) => total + tri.area, 0);
  const convertedArea = convertedTris.reduce((total, tri) => total + tri.area, 0);
  if (
    sourceArea > 0 &&
    Math.abs(convertedArea - sourceArea) / sourceArea > AREA_TOLERANCE_FRACTION
  ) {
    problems.push(
      `surface area ${sourceArea.toFixed(3)} -> ${convertedArea.toFixed(3)} m^2`,
    );
  }

  const worstPosition = Math.max(
    ...['x', 'y', 'z'].map((axis) =>
      worstMultisetGap(
        sourceTris.map((tri) => tri[axis]),
        convertedTris.map((tri) => tri[axis]),
      ),
    ),
  );
  // UVs only mean something on a textured asset. Several props (the rocks) are
  // a flat `Kd` colour with no `map_Kd`, so `prune` drops their TEXCOORD_0 as
  // genuinely unused — the runtime never samples it either.
  const textured = convertedTris.some((tri) => tri.u !== null);
  const worstTexels = textured
    ? Math.max(
        ...['u', 'v'].map((channel) =>
          worstMultisetGap(
            sourceTris.map((tri) => tri[channel] ?? 0),
            convertedTris.map((tri) => tri[channel] ?? 0),
          ),
        ),
      ) * PALETTE_WIDTH
    : 0;

  if (worstPosition > POSITION_TOLERANCE) {
    problems.push(
      `a triangle moved ${worstPosition.toFixed(5)}m (limit ${POSITION_TOLERANCE})`,
    );
  }
  if (worstTexels > UV_TEXEL_TOLERANCE) {
    problems.push(
      `UV drift up to ${worstTexels.toFixed(3)} palette texels (limit ${UV_TEXEL_TOLERANCE})`,
    );
  }

  return {
    problems,
    sourceTris: sourceTris.length,
    worstTexels,
    worstPosition,
    textured,
  };
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const pairs = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.glb')) continue;
      const base = path.join(
        SOURCE_ROOT,
        path.relative(OUTPUT_ROOT, full).replace(/\.glb$/, ''),
      );
      const source = fs.existsSync(`${base}.obj`)
        ? `${base}.obj`
        : fs.existsSync(`${base}.fbx`)
          ? `${base}.fbx`
          : null;
      // Rigged characters come straight out of `glb-rigger` and have no
      // OBJ/FBX twin to compare against; they were never converted.
      if (source !== null) pairs.push({ source, glb: full });
    }
  };
  walk(OUTPUT_ROOT);

  if (pairs.length === 0) {
    console.error('No converted assets found. Run convert-voxel-assets.mjs.');
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const { source, glb } of pairs) {
    const name = path.relative(OUTPUT_ROOT, glb);
    try {
      const { problems, sourceTris, worstTexels, worstPosition, textured } =
        await compare(source, glb);
      if (problems.length > 0) {
        failed += 1;
        console.error(`FAIL ${name}`);
        for (const problem of problems) console.error(`       ${problem}`);
      } else if (verbose) {
        console.log(
          `  ok ${name.padEnd(34)} ${String(sourceTris).padStart(7)} tris, ` +
            `${(worstPosition * 1000).toFixed(3)}mm, ` +
            `${textured ? `${worstTexels.toFixed(3)} texels` : 'untextured'}`,
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }

  console.log(
    `\n${pairs.length - failed}/${pairs.length} converted assets match their source.`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
