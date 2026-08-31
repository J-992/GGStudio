import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Bone,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
  MeshStandardMaterial,
} from 'three';
import {
  COSMETICS,
  COSMETIC_SLOTS,
  DEFAULT_ITEM,
  defaultLoadout,
  itemById,
  itemsForSlot,
  paletteFor,
  sanitizeLoadout,
} from '../game/Cosmetics';
import { clearCosmeticModels, registerCosmeticModel } from '../game/CosmeticModels';
import { Wardrobe } from '../game/Wardrobe';
import { RigAdapter } from '../game/Rig';

/**
 * Cosmetics sit on the one path every player takes — the character they load
 * with — so the failure modes that matter are not "the hat looks wrong". They
 * are: a saved id that no longer exists blocks a load, an equip leaks meshes
 * into the scene every time it is tapped, or an item mounts in a rig's bone
 * axes and ends up growing sideways out of a head. These pin all three.
 */

function makeBone(name: string, parent: Object3D, y: number, rotX = 0): Bone {
  const bone = new Bone();
  bone.name = name;
  bone.position.set(0, y, 0);
  bone.rotation.x = rotX;
  parent.add(bone);
  return bone;
}

/** A minimal skinned stand-in with the same joint names the ninjas use. */
function makeCharacter(): { model: Object3D; rig: RigAdapter; head: Bone } {
  const model = new Group();
  const hips = makeBone('Hips', model, 0.9);
  const spine = makeBone('Spine', hips, 0.12);
  const chest = makeBone('Spine01', spine, 0.14);
  const upperChest = makeBone('Spine02', chest, 0.14);
  // Deliberately not upright: a rig whose head bone points down its own +Z is
  // exactly the case a naive `bone.add(hat)` gets wrong.
  const head = makeBone('Head', upperChest, 0.18, Math.PI * 0.5);
  const shoulderL = makeBone('LeftShoulder', upperChest, 0.1);
  const shoulderR = makeBone('RightShoulder', upperChest, 0.1);
  const upLegL = makeBone('LeftUpLeg', hips, -0.05);
  const legL = makeBone('LeftLeg', upLegL, -0.4);
  const footL = makeBone('LeftFoot', legL, -0.4);
  const upLegR = makeBone('RightUpLeg', hips, -0.05);
  const legR = makeBone('RightLeg', upLegR, -0.4);
  const footR = makeBone('RightFoot', legR, -0.4);

  const bones = [
    hips, spine, chest, upperChest, head, shoulderL, shoulderR,
    upLegL, legL, footL, upLegR, legR, footR,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const skinned = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: 0x808080 }));
  model.add(skinned);
  model.updateMatrixWorld(true);
  skinned.bind(new Skeleton(bones));

  return { model, rig: new RigAdapter(model, 1.72), head };
}

const worn = (model: Object3D): Object3D[] => {
  const out: Object3D[] = [];
  model.traverse((o) => {
    if (o instanceof Group && o.parent instanceof Bone) out.push(o);
  });
  return out;
};

/**
 * A skinned stand-in whose two shoulders are deliberately DIFFERENT sizes, the
 * way real skin weights are: the right shoulder gets a vertex further out than
 * the left. A pair of pauldrons measured off this rig came out a third bigger
 * on one side before the wardrobe reconciled the two.
 */
function makeLopsidedCharacter(): { model: Object3D; rig: RigAdapter } {
  const model = new Group();
  const hips = makeBone('Hips', model, 0.9);
  const spine = makeBone('Spine', hips, 0.12);
  const chest = makeBone('Spine01', spine, 0.14);
  const upperChest = makeBone('Spine02', chest, 0.14);
  const head = makeBone('Head', upperChest, 0.18);
  const shoulderL = makeBone('LeftShoulder', upperChest, 0.1);
  const shoulderR = makeBone('RightShoulder', upperChest, 0.1);
  const bones = [hips, spine, chest, upperChest, head, shoulderL, shoulderR];

  // Two vertices per shoulder, the right one reaching 0.3 out and the left only
  // 0.2, plus one on the head so it measures as a limb too.
  const positions = new Float32Array([
    -0.3, 1.5, 0, -0.05, 1.5, 0,
    0.2, 1.5, 0, 0.05, 1.5, 0,
    0, 1.75, 0,
  ]);
  const index = new Uint16Array(5 * 4);
  const weight = new Float32Array(5 * 4);
  const owners = [6, 6, 5, 5, 4];
  for (let v = 0; v < 5; v++) {
    index[v * 4] = owners[v];
    weight[v * 4] = 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(weight, 4));
  const skinned = new SkinnedMesh(geometry, new MeshStandardMaterial());
  model.add(skinned);
  model.updateMatrixWorld(true);
  skinned.bind(new Skeleton(bones));
  return { model, rig: new RigAdapter(model, 1.72) };
}

describe('the cosmetics catalogue', () => {
  it('has one unique id per item, filed under the slot it claims', () => {
    const ids = new Set(COSMETICS.map((c) => c.id));
    expect(ids.size).toBe(COSMETICS.length);
    for (const slot of COSMETIC_SLOTS) {
      for (const item of itemsForSlot(slot)) expect(item.slot).toBe(slot);
    }
  });

  it('offers a real choice in every slot, and a way back to nothing', () => {
    for (const slot of COSMETIC_SLOTS) {
      // A tab with one thing in it is not a choice. Four is the floor because
      // the arms slot has four; the rest carry more.
      expect(itemsForSlot(slot).length, `${slot} is too thin`).toBeGreaterThanOrEqual(4);
      expect(itemById(DEFAULT_ITEM[slot])?.slot).toBe(slot);
    }
  });

  it('builds every item into real geometry with no shared materials', () => {
    const palette = paletteFor(defaultLoadout());
    const seen = new Set<unknown>();
    for (const item of COSMETICS) {
      // Model-backed pieces build nothing until their GLB has streamed in, which
      // is the whole point of the empty-group contract; they are covered below.
      if (item.model) continue;
      for (const anchor of item.anchors) {
        const built = item.build?.(palette, anchor);
        expect(built, `${item.id} declares an anchor but builds nothing`).toBeTruthy();
        let meshes = 0;
        const mine = new Set<unknown>();
        built!.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          meshes++;
          // Shapes are shared and never disposed; materials belong to the one
          // build that made them, so a wardrobe can dispose its own without
          // blanking a piece another character is wearing.
          expect(seen.has(o.material), `${item.id} reuses a material`).toBe(false);
          mine.add(o.material);
        });
        for (const m of mine) seen.add(m);
        expect(meshes, `${item.id} built an empty group`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves a model-backed piece empty until its model has landed, then fills it', () => {
    const palette = paletteFor(defaultLoadout());
    const item = COSMETICS.find((c) => c.model && c.anchors.length > 0)!;
    const anchor = item.anchors[0];
    expect(item.build!(palette, anchor).children.length).toBe(0);

    const prototype = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    registerCosmeticModel(item.id, prototype);
    try {
      const built = item.build!(palette, anchor);
      expect(built.children.length).toBe(1);
      let meshes = 0;
      built.traverse((o) => {
        if (o instanceof Mesh) meshes++;
      });
      expect(meshes).toBe(1);
      // Clones share the prototype's material on purpose — the wardrobe knows
      // not to dispose them — so this asserts sharing rather than forbidding it.
      expect((built.children[0] as Mesh).material).toBe(prototype.material);
    } finally {
      clearCosmeticModels();
    }
  });

  it('reflects a paired model onto the left side rather than shipping two files', () => {
    const palette = paletteFor(defaultLoadout());
    const item = COSMETICS.find((c) => c.id === 'feet-boots')!;
    registerCosmeticModel(item.id, new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
    try {
      const right = item.build!(palette, item.anchors.find((a) => a.mirror === 1)!);
      const left = item.build!(palette, item.anchors.find((a) => a.mirror === -1)!);
      expect(right.scale.x).toBe(1);
      expect(left.scale.x).toBe(-1);
    } finally {
      clearCosmeticModels();
    }
  });
});

describe('loadout validation', () => {
  it('turns anything at all into a wearable loadout', () => {
    expect(sanitizeLoadout(null)).toEqual(defaultLoadout());
    expect(sanitizeLoadout('nonsense')).toEqual(defaultLoadout());
    expect(sanitizeLoadout({ head: 42, feet: [] })).toEqual(defaultLoadout());
  });

  it('drops an id that has been retired from the catalogue', () => {
    const kept = sanitizeLoadout({ head: 'head-kasa', back: 'back-from-an-older-build' });
    expect(kept.head).toBe('head-kasa');
    expect(kept.back).toBe(DEFAULT_ITEM.back);
  });

  it('refuses an item worn in the wrong slot', () => {
    expect(sanitizeLoadout({ head: 'feet-geta' }).head).toBe(DEFAULT_ITEM.head);
  });
});

describe('the wardrobe', () => {
  it('cancels the bone axes, so an item stands up in character space', () => {
    const { model, rig, head } = makeCharacter();
    const wardrobe = new Wardrobe(model, rig);
    wardrobe.apply(sanitizeLoadout({ head: 'head-kasa' }));
    model.updateMatrixWorld(true);

    const holder = head.children.find((c) => c instanceof Group);
    expect(holder).toBeTruthy();
    const orientation = holder!.getWorldQuaternion(new Quaternion());
    // The head bone is rotated 90° about X; the hat must not be.
    expect(orientation.angleTo(new Quaternion())).toBeLessThan(1e-6);
  });

  it('puts a hat above the head rather than at the joint', () => {
    const { model, rig, head } = makeCharacter();
    new Wardrobe(model, rig).apply(sanitizeLoadout({ head: 'head-kasa' }));
    model.updateMatrixWorld(true);
    const holder = head.children.find((c) => c instanceof Group)!;
    const above = holder.getWorldPosition(new Vector3());
    const joint = head.getWorldPosition(new Vector3());
    expect(above.y - joint.y).toBeGreaterThan(0.1);
    expect(Math.abs(above.x - joint.x)).toBeLessThan(1e-6);
  });

  it('leaves nothing behind when the loadout changes', () => {
    const { model, rig } = makeCharacter();
    const wardrobe = new Wardrobe(model, rig);
    for (let i = 0; i < 6; i++) {
      wardrobe.apply(sanitizeLoadout({ outfit: 'fit-ember', head: 'head-kabuto', back: 'back-cape', feet: 'feet-geta' }));
    }
    const dressed = wardrobe.mountCount;
    expect(dressed).toBeGreaterThan(4);
    expect(worn(model).length).toBe(dressed);

    wardrobe.apply(defaultLoadout());
    expect(wardrobe.mountCount).toBe(0);
    expect(worn(model).length).toBe(0);
  });


  it('measures a left/right pair to the same size, however the weights fell', () => {
    const { model, rig } = makeLopsidedCharacter();
    const limbs = new Wardrobe(model, rig).debugLimbs;
    const right = limbs.RightShoulder;
    const left = limbs.LeftShoulder;
    expect(right).toBeTruthy();
    expect(left).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(right.size[i] - left.size[i]), `axis ${i}`).toBeLessThan(1e-6);
    }
    // The reconciled width is the average of the two (0.25 and 0.15), not the
    // larger of them: neither side wins, they meet.
    expect(right.size[0]).toBeCloseTo(0.2, 3);
  });

  it('restores the character’s own colours when a tint comes off', () => {
    const { model, rig } = makeCharacter();
    const material = (model.children.find((c) => c instanceof SkinnedMesh) as SkinnedMesh)
      .material as MeshStandardMaterial;
    const before = material.color.getHex();

    const wardrobe = new Wardrobe(model, rig);
    wardrobe.apply(sanitizeLoadout({ outfit: 'fit-void' }));
    expect(material.color.getHex()).not.toBe(before);

    wardrobe.apply(defaultLoadout());
    expect(material.color.getHex()).toBe(before);
  });

  it('sways cloth without letting it spin off its mount', () => {
    const { model, rig } = makeCharacter();
    const wardrobe = new Wardrobe(model, rig);
    wardrobe.apply(sanitizeLoadout({ back: 'back-cape' }));
    for (let i = 0; i < 200; i++) wardrobe.update(1 / 60, 40, 12, 1);
    let checked = 0;
    model.traverse((o) => {
      if (!(o instanceof Group) || !(o.parent instanceof Group)) return;
      checked++;
      expect(Math.abs(o.rotation.z)).toBeLessThan(1.2);
      expect(Math.abs(o.rotation.x)).toBeLessThan(1.2);
    });
    expect(checked).toBeGreaterThan(0);
  });
});
