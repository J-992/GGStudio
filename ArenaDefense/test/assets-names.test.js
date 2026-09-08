// Guards the name lookup every model in the game goes through.
//
// `Assets#instanceSource(name)` is called with authored mesh names — 'zed_1',
// 'Gun_03', 'SM-7-Fence'. three.js's GLTFLoader renames anything whose name is
// already taken in the same file (`createUniqueName` appends `_1`), so a glTF
// scene sharing a name with a node inside it makes that node unreachable by
// its authored name. That shipped once: `zed_1.glb` held one node `zed_1` in a
// scene also called `zed_1`, the mesh loaded as `zed_1_1`, and the game threw
// at boot before the first frame.
//
// Reads the GLB container directly (no three, no DOM) so it runs in the plain
// `node --test` suite: a GLB is a 12-byte header then a JSON chunk whose
// length is at offset 12.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'models');

/** @returns {{ scenes: string[], nodes: string[], meshes: string[] }} */
function readGltfJson(file) {
  const bytes = fs.readFileSync(path.join(MODELS_DIR, file));
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF', `${file} is not a GLB`);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  return {
    scenes: (json.scenes ?? []).map((s) => s.name).filter(Boolean),
    nodes: (json.nodes ?? []).map((n) => n.name).filter(Boolean),
    meshes: (json.meshes ?? []).map((m) => m.name).filter(Boolean),
  };
}

const FILES = ['zed_1.glb', 'zed_3.glb', 'dressing.glb', 'rocks.glb', 'props.glb'];

test('no glTF scene shares a name with a node in the same file', () => {
  for (const file of FILES) {
    const { scenes, nodes } = readGltfJson(file);
    for (const scene of scenes) {
      assert.ok(
        !nodes.includes(scene),
        `${file}: scene "${scene}" collides with a node of the same name; GLTFLoader would rename that node to "${scene}_1" and instanceSource("${scene}") would miss it`,
      );
    }
  }
});

test('node names match mesh names, so either lookup resolves', () => {
  for (const file of FILES) {
    const { nodes, meshes } = readGltfJson(file);
    assert.deepEqual([...nodes].sort(), [...meshes].sort(), `${file}: node and mesh names diverge`);
  }
});

test('every model the config asks for exists in the shipped GLBs', () => {
  const available = new Set(FILES.flatMap((file) => readGltfJson(file).meshes));

  for (const [name, def] of Object.entries(CONFIG.enemies.types)) {
    if (def.render !== 'voxel') continue;
    assert.ok(available.has(def.model), `enemy "${name}" wants mesh "${def.model}", which no GLB provides`);
  }

  for (const [name, def] of Object.entries(CONFIG.turrets.types)) {
    assert.ok(available.has(def.base), `turret "${name}" wants base mesh "${def.base}", which no GLB provides`);
  }
});
