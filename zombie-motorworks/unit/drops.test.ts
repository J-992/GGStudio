import { describe, expect, it } from 'vitest';
import {
  cashDropAmount,
  partDropBudget,
  partDropPool,
  PICKUP_KINDS,
  rollPartDrop,
  rollPickupKind,
  TOTAL_PICKUP_WEIGHT,
  type PickupKind,
} from '../src/survival/dropTable.ts';
import {
  chooseRepairTarget,
  type RepairCandidate,
} from '../src/core/repairKit.ts';
import { PART_CATALOG } from '../src/core/parts.ts';
import * as THREE from 'three';
import {
  buildPickupModel,
  buildSalvagePartModel,
} from '../src/survival/pickupModels.ts';

/** Rolls the table `samples` times over an even sweep of 0..1. */
function kindShare(kind: PickupKind, samples = 10_000): number {
  let hits = 0;
  for (let i = 0; i < samples; i += 1) {
    if (rollPickupKind(() => i / samples) === kind) hits += 1;
  }
  return hits / samples;
}

describe('pickup drop table', () => {
  it('leaves fuel as one kind among six rather than every crate on the map', () => {
    expect(kindShare('fuel')).toBeCloseTo(
      PICKUP_KINDS.fuel.weight / TOTAL_PICKUP_WEIGHT,
      2,
    );
    // The old system ran three permanent fuel slots; the table has to make
    // fuel a minority of what spawns for the change to mean anything.
    expect(PICKUP_KINDS.fuel.weight / TOTAL_PICKUP_WEIGHT).toBeLessThan(0.35);
  });

  it('can roll every kind and nothing else', () => {
    const seen = new Set<PickupKind>();
    for (let i = 0; i < 1000; i += 1) seen.add(rollPickupKind(() => i / 1000));
    expect([...seen].sort()).toEqual(
      ['cash', 'colossus', 'fuel', 'part', 'repair', 'sentry'].sort(),
    );
  });

  it('clamps rolls outside 0..1 onto the ends of the table', () => {
    expect(rollPickupKind(() => -1)).toBe('fuel');
    expect(rollPickupKind(() => 2)).toBe('part');
  });

  it('gives every kind a distinct beacon and minimap colour', () => {
    const kinds = Object.values(PICKUP_KINDS);
    expect(new Set(kinds.map((spec) => spec.color)).size).toBe(kinds.length);
    expect(new Set(kinds.map((spec) => spec.minimapColor)).size).toBe(
      kinds.length,
    );
  });
});

describe('cash crates', () => {
  it('pays more on later waves and stops climbing at the cap', () => {
    expect(cashDropAmount(1)).toBe(35);
    expect(cashDropAmount(10)).toBe(125);
    expect(cashDropAmount(100)).toBe(250);
  });

  it('treats a nonsense wave as the first one', () => {
    expect(cashDropAmount(0)).toBe(35);
    expect(cashDropAmount(Number.NaN)).toBe(35);
  });
});

describe('salvage crates', () => {
  it('only offers blocks the store would sell a copy of', () => {
    for (const id of partDropPool(99)) {
      const def = PART_CATALOG[id];
      expect(def.cost).toBeGreaterThan(0);
      expect(def.isRoot).not.toBe(true);
      expect(def.unique).not.toBe(true);
      expect(def.buildSignature).not.toBe(true);
    }
  });

  it('widens the pool as the run goes on, never past the budget', () => {
    const early = partDropPool(1);
    const late = partDropPool(20);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(early.length);
    for (const id of early) {
      expect(PART_CATALOG[id].cost).toBeLessThanOrEqual(partDropBudget(1));
    }
  });

  it('picks from the pool by roll, ends included', () => {
    const pool = partDropPool(5);
    expect(rollPartDrop(() => 0, 5)).toBe(pool[0]);
    expect(rollPartDrop(() => 0.999999, 5)).toBe(pool[pool.length - 1]);
  });
});

function candidate(over: Partial<RepairCandidate>): RepairCandidate {
  return {
    id: 'part',
    isWheel: false,
    alive: true,
    detached: false,
    hasLiveNeighbour: true,
    health: 100,
    maxHealth: 100,
    ...over,
  };
}

describe('repair crates', () => {
  it('rebuilds a lost tire before any other lost block', () => {
    expect(
      chooseRepairTarget([
        candidate({ id: 'armour', alive: false }),
        candidate({ id: 'wheel', alive: false, isWheel: true }),
        candidate({ id: 'frame', alive: false }),
      ]),
    ).toEqual({ action: 'rebuild', id: 'wheel' });
  });

  it('will not rebuild a block that was blown clear or has nothing to bolt to', () => {
    expect(
      chooseRepairTarget([
        candidate({ id: 'debris', alive: false, detached: true, isWheel: true }),
        candidate({ id: 'floating', alive: false, hasLiveNeighbour: false }),
        candidate({ id: 'hull', health: 40 }),
      ]),
    ).toEqual({ action: 'heal', id: 'hull' });
  });

  it('patches the worst-hurt surviving block when nothing is missing', () => {
    expect(
      chooseRepairTarget([
        candidate({ id: 'scratched', health: 90 }),
        candidate({ id: 'wrecked', health: 12 }),
        candidate({ id: 'fine' }),
      ]),
    ).toEqual({ action: 'heal', id: 'wrecked' });
  });

  it('does nothing at all for a rig without a scratch on it', () => {
    expect(
      chooseRepairTarget([candidate({ id: 'a' }), candidate({ id: 'b' })]),
    ).toEqual({ action: 'none' });
  });

  it('ignores detached wreckage when picking something to patch', () => {
    expect(
      chooseRepairTarget([
        candidate({ id: 'gone', detached: true, health: 1 }),
        candidate({ id: 'dented', health: 80 }),
      ]),
    ).toEqual({ action: 'heal', id: 'dented' });
  });
});

describe('crate models', () => {
  const kinds = Object.keys(PICKUP_KINDS) as PickupKind[];

  it('gives every kind a block of its own at a readable, consistent size', () => {
    for (const kind of kinds) {
      const model = buildPickupModel(kind, PICKUP_KINDS[kind].color);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(centre);

      // Big enough to read from the road, small enough to hover over its glow.
      expect(size.y).toBeGreaterThan(0.3);
      expect(size.y).toBeLessThan(1.4);
      expect(Math.max(size.x, size.z)).toBeLessThan(1.4);
      // Modelled about the origin, so the slot can bob it without drift.
      expect(Math.abs(centre.x)).toBeLessThan(0.3);
      expect(Math.abs(centre.y)).toBeLessThan(0.3);
      expect(Math.abs(centre.z)).toBeLessThan(0.3);
    }
  });

  it('builds each kind from real geometry rather than an empty group', () => {
    for (const kind of kinds) {
      const model = buildPickupModel(kind, PICKUP_KINDS[kind].color);
      let meshes = 0;
      model.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes += 1;
      });
      expect(meshes).toBeGreaterThan(1);
    }
  });
});

describe('salvage crate models', () => {
  it('shows the block it is carrying, at the same size as every other crate', () => {
    for (const defId of ['spike-ram', 'wheel-standard', 'cannon-heavy']) {
      const model = buildSalvagePartModel(defId);
      expect(model).not.toBeNull();
      const size = new THREE.Box3()
        .setFromObject(model!)
        .getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(0.713, 2);
    }
  });

  it('declines a definition the catalog does not have', () => {
    expect(buildSalvagePartModel('not-a-part')).toBeNull();
  });
});
