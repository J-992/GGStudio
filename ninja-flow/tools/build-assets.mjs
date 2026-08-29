/**
 * NINJA FLOW asset pipeline.
 *
 * Meshy exports arrive as ~15-40 MB GLBs: a tiny skinned mesh plus one 4096px PNG,
 * and the animation export re-embeds that same mesh + texture per clip set.
 * This script splits them into what the game actually needs:
 *
 *   public/models/<id>.glb   skinned mesh + 1024px WebP texture   (~300 KB)
 *   public/anims/<id>.glb    node hierarchy + clips, no geometry  (~40-200 KB)
 *
 * All four rigs retain the identical original 24-joint animation skeleton and
 * receive the same 10 weighted deformation helpers. Clips still target the
 * original names, while runtime twist correction drives the helper joints.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, textureCompress, resample } from '@gltf-transform/functions';
import { Matrix4, Vector3 } from 'three';
import sharp from 'sharp';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DEFORMATION_HELPERS } from './rig-spec.mjs';

const RAW = '.assets_raw';
const TEX_SIZE = 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const SOURCES = [
  { id: 'fox',    dir: 'Meshy_AI_fox_ninja_rig_v2_biped' },
  { id: 'cat',    dir: 'Meshy_AI_cat_ninja_rig_v2_biped' },
  { id: 'bunny',  dir: 'Meshy_AI_bunny_ninja_rig_v2_biped' },
  { id: 'masked', dir: 'Meshy_AI_masked_ninja_rig_v2_biped' },
];

function findGlb(dir, suffix) {
  const base = path.join(RAW, dir, dir);
  const f = readdirSync(base).find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`missing ${suffix} in ${base}`);
  return path.join(base, f);
}

const kb = (p) => (statSync(p).size / 1024).toFixed(0) + ' KB';

async function buildCharacter(src) {
  const doc = await io.read(findGlb(src.dir, '_Character_output.glb'));
  const root = doc.getRoot();

  // The character export ships a single-frame stub clip; the real clips live in
  // the animation export, so drop it rather than shipping dead samplers.
  for (const anim of root.listAnimations()) anim.dispose();

  augmentDeformationRig(doc);

  await doc.transform(
    weld(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [TEX_SIZE, TEX_SIZE],
      quality: 88,
    }),
    prune({ keepAttributes: false, keepLeaves: false }),
    // KHR_mesh_quantization is decoded natively by three.js — no runtime decoder.
    quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD)/ }),
  );

  const out = `public/models/${src.id}.glb`;
  await io.write(out, doc);
  console.log(`model  ${src.id.padEnd(7)} ${kb(out)}`);
}

function augmentDeformationRig(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error('character has no skin');

  const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
  const originalJoints = skin.listJoints();
  const jointIndex = new Map(originalJoints.map((joint, index) => [joint.getName(), index]));
  const inverseBindAccessor = skin.getInverseBindMatrices();
  const inverseBindArray = inverseBindAccessor?.getArray();
  if (!inverseBindAccessor || !inverseBindArray) throw new Error('skin has no inverse-bind matrices');

  const helperData = [];
  for (const [name, sourceName, childName, strength] of DEFORMATION_HELPERS) {
    const source = nodes.get(sourceName);
    const child = nodes.get(childName);
    const sourceIndex = jointIndex.get(sourceName);
    if (!source || !child || sourceIndex === undefined) {
      throw new Error(`cannot build helper ${name}: missing ${sourceName} or ${childName}`);
    }

    const childOffset = new Vector3().fromArray(child.getTranslation());
    const helperOffset = childOffset.clone().multiplyScalar(0.46);
    const helper = doc.createNode(name).setTranslation(helperOffset.toArray());
    source.addChild(helper);
    skin.addJoint(helper);
    const helperIndex = originalJoints.length + helperData.length;

    const sourceInverseBind = new Matrix4().fromArray(inverseBindArray, sourceIndex * 16);
    const helperInverseBind = new Matrix4()
      .makeTranslation(-helperOffset.x, -helperOffset.y, -helperOffset.z)
      .multiply(sourceInverseBind);
    helperData.push({
      helperIndex,
      sourceIndex,
      sourceInverseBind,
      axis: childOffset.clone().normalize(),
      length: Math.max(1e-6, childOffset.length()),
      strength,
      inverseBind: helperInverseBind,
    });
  }

  const expandedInverseBinds = new Float32Array((originalJoints.length + helperData.length) * 16);
  expandedInverseBinds.set(inverseBindArray);
  for (let i = 0; i < helperData.length; i++) {
    helperData[i].inverseBind.toArray(expandedInverseBinds, (originalJoints.length + i) * 16);
  }
  inverseBindAccessor.setArray(expandedInverseBinds);

  const point = new Vector3();
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')?.getArray();
      const jointsAccessor = primitive.getAttribute('JOINTS_0');
      const weightsAccessor = primitive.getAttribute('WEIGHTS_0');
      const joints = jointsAccessor?.getArray();
      const weights = weightsAccessor?.getArray();
      if (!positions || !jointsAccessor || !weightsAccessor || !joints || !weights) continue;

      // The augmented skin has 34 joints, comfortably inside an unsigned byte.
      const nextJoints = new Uint8Array(joints);
      const nextWeights = new Float32Array(weights);
      for (const helper of helperData) {
        for (let vertex = 0; vertex < positions.length / 3; vertex++) {
          const base = vertex * 4;
          let sourceSlot = -1;
          for (let slot = 0; slot < 4; slot++) {
            if (nextJoints[base + slot] === helper.sourceIndex && nextWeights[base + slot] > 1e-6) {
              sourceSlot = slot;
              break;
            }
          }
          if (sourceSlot < 0) continue;

          point.fromArray(positions, vertex * 3).applyMatrix4(helper.sourceInverseBind);
          const along = point.dot(helper.axis) / helper.length;
          const distal = smootherstep((along - 0.18) / 0.76);
          const transfer = nextWeights[base + sourceSlot] * helper.strength * distal;
          if (transfer < 1e-5) continue;
          addHelperInfluence(nextJoints, nextWeights, base, sourceSlot, helper.helperIndex, transfer);
        }
      }

      jointsAccessor.setArray(nextJoints);
      weightsAccessor.setArray(nextWeights);
    }
  }
}

function addHelperInfluence(joints, weights, base, sourceSlot, helperIndex, transfer) {
  let targetSlot = -1;
  let smallestSlot = -1;
  let smallestWeight = Infinity;
  for (let slot = 0; slot < 4; slot++) {
    const weight = weights[base + slot];
    if (joints[base + slot] === helperIndex) {
      targetSlot = slot;
      break;
    }
    if (slot !== sourceSlot && weight < smallestWeight) {
      smallestWeight = weight;
      smallestSlot = slot;
    }
  }

  if (targetSlot < 0) {
    if (smallestSlot < 0 || (smallestWeight > 1e-6 && transfer <= smallestWeight)) return;
    targetSlot = smallestSlot;
    joints[base + targetSlot] = helperIndex;
  }

  const displaced = weights[base + targetSlot];
  weights[base + sourceSlot] = Math.max(0, weights[base + sourceSlot] - transfer);
  weights[base + targetSlot] = transfer + displaced;
  let total = 0;
  for (let slot = 0; slot < 4; slot++) total += weights[base + slot];
  if (total > 1e-6) {
    for (let slot = 0; slot < 4; slot++) weights[base + slot] /= total;
  }
}

function smootherstep(value) {
  const t = value < 0 ? 0 : value > 1 ? 1 : value;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

async function buildAnimations(src) {
  const doc = await io.read(findGlb(src.dir, '_Merged_Animations.glb'));
  const root = doc.getRoot();

  // Strip everything but the skeleton hierarchy + clips. three.js binds clips by
  // node name, so a bone-only document retargets onto any of the four characters.
  for (const node of root.listNodes()) node.setMesh(null);
  for (const skin of root.listSkins()) skin.dispose();
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();

  const clips = root.listAnimations().map((a) => a.getName());

  await doc.transform(
    // Meshy bakes every frame; resampling collapses the constant/linear runs.
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune({ keepLeaves: true }),
  );

  const out = `public/anims/${src.id}.glb`;
  await io.write(out, doc);
  console.log(`anims  ${src.id.padEnd(7)} ${kb(out).padStart(7)}  [${clips.join(', ')}]`);
}

mkdirSync('public/models', { recursive: true });
mkdirSync('public/anims', { recursive: true });

for (const src of SOURCES) {
  await buildCharacter(src);
  await buildAnimations(src);
}
console.log('done');
