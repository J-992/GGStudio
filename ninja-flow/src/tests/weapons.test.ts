import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Box3, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ENEMY_ATTACKS } from '../game/EnemyMoves';
import { MODEL_WEAPONS, WEAPONS, buildWeapon, weaponById } from '../game/Weapons';

/**
 * The armoury's contract.
 *
 * "Held convincingly" is not a matter of taste that only a screenshot can
 * settle — it is a geometric promise the weapon pipeline makes to the game:
 *
 *   the grip sits at the origin, so a hand holds it where a hand would;
 *   the blade points along +Y, so one hold transform works for every weapon;
 *   the finished length is in metres, so a tanto is short and a nagamaki long.
 *
 * These tests read the SHIPPED files and check that promise, which catches a
 * weapon held by its blade at build time rather than in a playtest.
 */

const OUT = path.join(process.cwd(), 'public', 'weapons');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

interface Measured {
  length: number;
  gripOffset: number;
  bounds: Box3;
}

async function measure(id: string): Promise<Measured> {
  const doc = await io.readBinary(new Uint8Array(readFileSync(path.join(OUT, `${id}.glb`))));
  const scene = doc.getRoot().listScenes()[0];
  const box = new Box3().makeEmpty();
  const point = new Vector3();

  const walk = (node: ReturnType<typeof scene.listChildren>[number], parent: number[]): void => {
    const local = node.getMatrix();
    const world = multiply(parent, local);
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!;
        const step = Math.max(1, Math.floor(pos.getCount() / 300));
        for (let i = 0; i < pos.getCount(); i += step) {
          const e = [0, 0, 0];
          pos.getElement(i, e);
          box.expandByPoint(apply(point, e, world));
        }
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const child of scene.listChildren()) walk(child, identity);

  return { length: box.max.y - box.min.y, gripOffset: box.min.y, bounds: box };
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function apply(out: Vector3, v: number[], m: number[]): Vector3 {
  return out.set(
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  );
}

const built = MODEL_WEAPONS.filter((id) => existsSync(path.join(OUT, `${id}.glb`)));

describe('weapon models', () => {
  it('ships every weapon the armoury declares', () => {
    expect(built).toEqual([...MODEL_WEAPONS]);
  });

  it('puts the grip at the origin so a hand holds it by the handle', async () => {
    for (const id of built) {
      const m = await measure(id);
      // The pommel sits at or just below the origin — never a blade's length
      // away from it, which is what a weapon held by the wrong end looks like.
      expect(Math.abs(m.gripOffset), id).toBeLessThan(0.16);
    }
  });

  it('points every blade along +Y so one hold transform serves them all', async () => {
    for (const id of built) {
      const m = await measure(id);
      // Almost all of the weapon is above the grip.
      expect(m.bounds.max.y, id).toBeGreaterThan(m.length * 0.8);
    }
  });

  it('sizes weapons against each other, not against their source files', async () => {
    const lengths = new Map<string, number>();
    for (const id of built) lengths.set(id, (await measure(id)).length);
    for (const [id, len] of lengths) {
      expect(len, id).toBeGreaterThan(0.3);
      expect(len, id).toBeLessThan(1.7);
    }
    // A tanto is a knife and a nagamaki is a polearm; the set must preserve that.
    expect(lengths.get('tanto')!).toBeLessThan(lengths.get('katana')!);
    expect(lengths.get('katana')!).toBeLessThan(lengths.get('nagamaki')!);
    expect(lengths.get('wakizashi')!).toBeLessThan(lengths.get('katana')!);
  });

  it('stays inside a download budget worth spending on props', async () => {
    let total = 0;
    for (const id of built) total += readFileSync(path.join(OUT, `${id}.glb`)).byteLength;
    // Deferred content, streamed after the first frame — but still weapons, not
    // characters, so they get a modest share.
    expect(total / 1024 / 1024).toBeLessThan(2);
  });
});

describe('armoury definitions', () => {
  it('gives every weapon an attack its owner can actually perform', () => {
    const known = new Set(ENEMY_ATTACKS.map((a) => a.id));
    for (const w of WEAPONS) {
      expect(w.attacks.length, w.id).toBeGreaterThan(0);
      for (const a of w.attacks) expect(known, `${w.id}:${a}`).toContain(a);
    }
  });

  it('scales reach and weight with the weapon, not at random', () => {
    const katana = weaponById('katana');
    const tanto = weaponById('tanto');
    const nagamaki = weaponById('nagamaki');
    expect(tanto.reach).toBeLessThan(katana.reach);
    expect(katana.reach).toBeLessThan(nagamaki.reach);
    expect(tanto.heft).toBeLessThan(nagamaki.heft);
  });

  it('keeps a procedural fallback for every weapon, model-backed or not', () => {
    // An enemy must never be empty-handed while the armoury is still streaming.
    for (const w of WEAPONS) {
      const group = buildWeapon(w.id, { metal: 0x9fb0c8, wrap: 0x1e1a2a, accent: 0xe8b64c });
      expect(group.children.length, w.id).toBeGreaterThan(0);
    }
  });

  it('covers shapes the downloaded packs do not include', () => {
    const procedural = WEAPONS.filter((w) => !w.model).map((w) => w.id);
    expect(procedural).toContain('kusarigama');
    expect(procedural).toContain('bo');
    expect(procedural.length).toBeGreaterThanOrEqual(5);
  });
});
