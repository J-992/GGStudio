import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ENEMY_MODEL_IDS } from '../assets/Assets';
import { MODEL_WEAPONS } from '../game/Weapons';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ENEMIES = path.join(process.cwd(), 'public', 'enemies');
const WEAPONS = path.join(process.cwd(), 'public', 'weapons');

const REQUIRED_JOINTS = [
  'Hips', 'Spine01', 'Spine02', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
] as const;

async function readEnemy(id: string) {
  return io.readBinary(new Uint8Array(readFileSync(path.join(ENEMIES, `enemy-${id}.glb`))));
}

describe('original enemy model cast', () => {
  it('ships every authored ronin, oni, and tengu model', () => {
    for (const id of ENEMY_MODEL_IDS) {
      expect(existsSync(path.join(ENEMIES, `enemy-${id}.glb`)), id).toBe(true);
    }
  });

  it('shares the combat skeleton and normalized skin weights', async () => {
    for (const id of ENEMY_MODEL_IDS) {
      const doc = await readEnemy(id);
      const root = doc.getRoot();
      const skin = root.listSkins()[0];
      expect(skin, `${id}:skin`).toBeDefined();
      const names = new Set(skin.listJoints().map((joint) => joint.getName()));
      for (const name of REQUIRED_JOINTS) expect(names, `${id}:${name}`).toContain(name);

      let maxWeightError = 0;
      for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
          if (!weights) continue;
          for (let vertex = 0; vertex < weights.length / 4; vertex++) {
            const sum = weights[vertex * 4] + weights[vertex * 4 + 1]
              + weights[vertex * 4 + 2] + weights[vertex * 4 + 3];
            maxWeightError = Math.max(maxWeightError, Math.abs(1 - sum));
          }
        }
      }
      expect(maxWeightError, id).toBeLessThan(1e-5);
    }
  });

  it('exports primary and secondary sockets directly inside both fists', async () => {
    for (const id of ENEMY_MODEL_IDS) {
      const doc = await readEnemy(id);
      const nodes = new Map(doc.getRoot().listNodes().map((node) => [node.getName(), node]));
      for (const [socketName, handName] of [['WeaponGripR', 'RightHand'], ['WeaponGripL', 'LeftHand']] as const) {
        const socket = nodes.get(socketName)!;
        const hand = nodes.get(handName)!;
        expect(socket, `${id}:${socketName}`).toBeDefined();
        expect(distance(translation(socket.getWorldMatrix()), translation(hand.getWorldMatrix())), `${id}:${socketName}`)
          .toBeLessThan(0.025);
        // The socket owns the neutral grip frame. Its +Y axis must be upright
        // in the bind pose so every grip-at-origin weapon starts inside the
        // fist instead of inheriting the hand bone's diagonal bind rotation.
        const matrix = socket.getWorldMatrix();
        const upLength = Math.hypot(matrix[4], matrix[5], matrix[6]);
        expect(matrix[5] / upLength, `${id}:${socketName}:up`).toBeGreaterThan(0.999);
      }
    }
  });

  it('keeps every weapon at a believable size against the enemy body', async () => {
    const ronin = await readEnemy('ronin');
    const enemyBounds = getBounds(ronin.getRoot().listScenes()[0]);
    const enemyHeight = enemyBounds.max[1] - enemyBounds.min[1];
    const ratios = new Map<string, number>();
    for (const id of MODEL_WEAPONS) {
      const weapon = await io.readBinary(new Uint8Array(readFileSync(path.join(WEAPONS, `${id}.glb`))));
      const bounds = getBounds(weapon.getRoot().listScenes()[0]);
      ratios.set(id, (bounds.max[1] - bounds.min[1]) / enemyHeight);
    }

    expect(ratios.get('tanto')!).toBeGreaterThan(0.2);
    expect(ratios.get('tanto')!).toBeLessThan(0.3);
    expect(ratios.get('wakizashi')!).toBeGreaterThan(0.35);
    expect(ratios.get('wakizashi')!).toBeLessThan(0.48);
    // These are source-asset ratios. Enemy.ts normalizes the cast to its
    // runtime height before unscaled metre-authored weapons are attached.
    expect(ratios.get('katana')!).toBeGreaterThan(0.5);
    expect(ratios.get('katana')!).toBeLessThan(0.68);
    expect(ratios.get('nagamaki')!).toBeGreaterThan(0.82);
    expect(ratios.get('nagamaki')!).toBeLessThan(0.95);
  });

  it('stays within a Poki-friendly geometry and download budget', async () => {
    let totalBytes = 0;
    for (const id of ENEMY_MODEL_IDS) {
      const bytes = readFileSync(path.join(ENEMIES, `enemy-${id}.glb`));
      totalBytes += bytes.byteLength;
      const doc = await io.readBinary(new Uint8Array(bytes));
      let triangles = 0;
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      }
      // Below this the cast collapses back into a head sphere, one mask box,
      // glowing dots and mitten hands instead of readable faces and grips.
      expect(triangles, `${id}:facial detail`).toBeGreaterThan(1_500);
      expect(triangles, id).toBeLessThan(2_000);
      expect(doc.getRoot().listMaterials().length, id).toBeGreaterThanOrEqual(6);
    }
    expect(totalBytes / 1024 / 1024).toBeLessThan(0.75);
  });
});

function translation(matrix: number[]): readonly [number, number, number] {
  return [matrix[12], matrix[13], matrix[14]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
