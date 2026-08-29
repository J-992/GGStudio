import { describe, expect, it } from 'vitest';
import {
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
      expect(itemsForSlot(slot).length).toBeGreaterThanOrEqual(5);
      expect(itemById(DEFAULT_ITEM[slot])?.slot).toBe(slot);
    }
  });

  it('builds every item into real geometry with no shared materials', () => {
    const palette = paletteFor(defaultLoadout());
    const seen = new Set<unknown>();
    for (const item of COSMETICS) {
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
