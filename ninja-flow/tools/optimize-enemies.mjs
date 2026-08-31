/** Web optimization pass for the Blender-authored enemy cast. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup } from '@gltf-transform/functions';
import { writeFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const IDS = ['ronin', 'oni', 'tengu'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const report = [];

for (const id of IDS) {
  const path = `public/enemies/enemy-${id}.glb`;
  const document = await io.read(path);
  ensureGripSockets(document);
  await document.transform(
    // The Blender files are already tiny and texture-free. Keep socket leaves,
    // skin accessors, positions, normals, and weights exact; only merge safely
    // identical resources. Generic prune removes the empty grip sockets, while
    // skinned position quantization changes the measured body/weapon ratio.
    dedup({ keepUniqueNames: true }),
  );
  const bytes = await io.writeBinary(document);
  writeFileSync(path, bytes);

  let vertices = 0;
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
    }
  }
  report.push({
    id,
    file: `enemy-${id}.glb`,
    bytes: bytes.byteLength,
    vertices,
    triangles,
    materials: document.getRoot().listMaterials().length,
    joints: document.getRoot().listSkins()[0]?.listJoints().length ?? 0,
    sockets: ['WeaponGripR', 'WeaponGripL'],
    optimization: 'lossless-dedup',
  });
  console.log(`${id.padEnd(6)} ${(bytes.byteLength / 1024).toFixed(1)} KB, ${triangles} triangles`);
}

writeFileSync('public/enemies/manifest.json', `${JSON.stringify(report, null, 2)}\n`);

/**
 * Blender can omit selected bone-parented empties from a GLB even though the
 * source scene contains them. Repair that export edge here, at the final asset
 * seam: each socket sits at its hand joint but cancels the diagonal bind
 * rotation, giving grip-at-origin weapons one stable, upright local frame.
 */
function ensureGripSockets(document) {
  const nodes = new Map(document.getRoot().listNodes().map((node) => [node.getName(), node]));
  for (const [socketName, handName, role] of [
    ['WeaponGripR', 'RightHand', 'weapon_primary'],
    ['WeaponGripL', 'LeftHand', 'weapon_secondary'],
  ]) {
    if (nodes.has(socketName)) continue;
    const hand = nodes.get(handName);
    if (!hand) throw new Error(`Cannot create ${socketName}: ${handName} is missing`);

    const world = new Matrix4().fromArray(hand.getWorldMatrix());
    const worldRotation = new Quaternion();
    world.decompose(new Vector3(), worldRotation, new Vector3());
    const socket = document
      .createNode(socketName)
      .setRotation(worldRotation.invert().toArray())
      .setExtras({ socket: role });
    hand.addChild(socket);
  }
}
