import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4 } from 'three';
import { CHARACTER_IDS, DEFORMATION_HELPERS } from './rig-spec.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let referenceOriginals = null;

for (const id of CHARACTER_IDS) {
  const doc = await io.read(`public/models/${id}.glb`);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) fail(id, 'missing skin');
  const joints = skin.listJoints();
  const names = joints.map((joint) => joint.getName());
  const byName = new Map(names.map((name, index) => [name, index]));
  const helperNames = new Set(DEFORMATION_HELPERS.map(([name]) => name));
  const originals = names.filter((name) => !helperNames.has(name));
  if (!referenceOriginals) referenceOriginals = originals;
  else if (originals.join('|') !== referenceOriginals.join('|')) fail(id, 'original skeleton differs');

  if (joints.length !== 34) fail(id, `expected 34 joints, found ${joints.length}`);
  const inverseBindAccessor = skin.getInverseBindMatrices();
  const inverseBinds = inverseBindAccessor?.getArray();
  if (!inverseBindAccessor || !inverseBinds || inverseBindAccessor.getCount() !== joints.length) {
    fail(id, 'inverse-bind count does not match joint count');
  }

  const influences = new Map(DEFORMATION_HELPERS.map(([name]) => [name, 0]));
  let maxWeightError = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const jointArray = primitive.getAttribute('JOINTS_0')?.getArray();
      const weightArray = primitive.getAttribute('WEIGHTS_0')?.getArray();
      if (!jointArray || !weightArray) continue;
      for (let vertex = 0; vertex < weightArray.length / 4; vertex++) {
        let sum = 0;
        for (let slot = 0; slot < 4; slot++) {
          const weight = weightArray[vertex * 4 + slot];
          sum += weight;
          const name = names[jointArray[vertex * 4 + slot]];
          if (influences.has(name) && weight > 1e-3) influences.set(name, influences.get(name) + 1);
        }
        maxWeightError = Math.max(maxWeightError, Math.abs(1 - sum));
      }
    }
  }
  if (maxWeightError > 1e-5) fail(id, `weights are not normalized (${maxWeightError})`);

  let maxBindDelta = 0;
  for (const [helperName, sourceName] of DEFORMATION_HELPERS) {
    const helperIndex = byName.get(helperName);
    const sourceIndex = byName.get(sourceName);
    if (helperIndex === undefined || sourceIndex === undefined) fail(id, `missing ${helperName}`);
    if ((influences.get(helperName) ?? 0) === 0) fail(id, `${helperName} has no weighted vertices`);
    const helperDeform = new Matrix4()
      .fromArray(joints[helperIndex].getWorldMatrix())
      .multiply(new Matrix4().fromArray(inverseBinds, helperIndex * 16));
    const sourceDeform = new Matrix4()
      .fromArray(joints[sourceIndex].getWorldMatrix())
      .multiply(new Matrix4().fromArray(inverseBinds, sourceIndex * 16));
    for (let component = 0; component < 16; component++) {
      maxBindDelta = Math.max(
        maxBindDelta,
        Math.abs(helperDeform.elements[component] - sourceDeform.elements[component]),
      );
    }
  }
  if (maxBindDelta > 1e-5) fail(id, `helper bind pose changed the mesh (${maxBindDelta})`);
  console.log(
    `${id.padEnd(7)} ${joints.length} joints, weights ±${maxWeightError.toExponential(2)}, bind ±${maxBindDelta.toExponential(2)}`,
  );
}

function fail(id, message) {
  throw new Error(`${id}: ${message}`);
}
