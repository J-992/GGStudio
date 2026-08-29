import { describe, expect, it } from 'vitest';
import { Group, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { ArenaImpactSystem, type EnvironmentImpactEvent } from '../game/ArenaImpacts';
import type { Enemy } from '../game/Enemy';
import { POND_SURFACE_Y } from '../game/ArenaLayout';

interface SimulatedBody {
  enemy: Enemy;
  position: Vector3;
  velocity: Vector3;
  angular: Vector3;
  floorY: number;
}

function body(): SimulatedBody {
  const position = new Vector3(0.8, 0.2, 0);
  const velocity = new Vector3(7, 5, 0.6);
  const angular = new Vector3(2, 1, 5);
  const simulated = {
    state: 'dying',
    deathPosition: position,
    deathVelocity: velocity,
    deathAngularVelocity: angular,
    get deathSpeed() {
      return velocity.length();
    },
    setDeathFloor(y: number) {
      result.floorY = y;
    },
    settleDeathInWater(surfaceY: number) {
      position.y = surfaceY + 0.16;
      velocity.set(velocity.x * 0.12, 0, velocity.z * 0.12);
    },
  };
  const result: SimulatedBody = {
    enemy: simulated as unknown as Enemy,
    position,
    velocity,
    angular,
    floorY: 0,
  };
  return result;
}

function advance(system: ArenaImpactSystem, simulated: SimulatedBody): EnvironmentImpactEvent {
  const dt = 1 / 120;
  for (let i = 0; i < 240; i++) {
    const event = system.interact(simulated.enemy, dt);
    if (event) return event;
    simulated.velocity.y -= 26 * dt;
    simulated.position.addScaledVector(simulated.velocity, dt);
    if (simulated.position.y < simulated.floorY + 0.22) {
      simulated.position.y = simulated.floorY + 0.22;
    }
    system.update(dt);
  }
  throw new Error('Expected an environment impact within two seconds');
}

describe('launched-body environment impacts', () => {
  it('drives deterministic physical contacts through pond, bridge and tree reactions', () => {
    const root = new Group();
    const garden = new Group();
    const tree = new Object3D();
    tree.name = 'Cylinder001';
    tree.position.set(5.2, 0, -3.8);
    garden.add(tree);
    root.add(garden);

    let leavesShed = 0;
    const system = new ArenaImpactSystem(root, (_origin, count) => {
      leavesShed += count;
    });
    system.registerGarden(garden);

    const pond = advance(system, body());
    expect(pond.kind).toBe('pond');
    expect(pond.y).toBeCloseTo(POND_SURFACE_Y);
    const waterFx = system as unknown as {
      waterMesh: InstancedMesh;
      waterContacts: Array<{ active: boolean }>;
      waterDrops: Array<{ active: boolean; radius: number }>;
    };
    expect(
      root.children.some(
        (child) =>
          (child as { geometry?: { type?: string } }).geometry?.type === 'RingGeometry',
      ),
    ).toBe(false);
    expect(waterFx.waterMesh.geometry.type).toBe('SphereGeometry');
    expect(
      (waterFx.waterMesh.material as MeshStandardMaterial).color.getHexString(),
    ).toBe('79bde7');
    expect(waterFx.waterDrops.some((drop) => drop.active && drop.radius !== 0.04)).toBe(true);
    expect(waterFx.waterContacts.some((contact) => contact.active)).toBe(true);

    const bridge = advance(system, body());
    expect(bridge.kind).toBe('bridge');
    expect(system.debug.brokenBridgeSections).toBe(1);

    const treeHit = advance(system, body());
    expect(treeHit.kind).toBe('tree');
    system.update(1 / 60);
    expect(system.debug.shakingTrees).toBe(1);
    expect(leavesShed).toBeGreaterThan(40);
  });

  it('restores all persistent environmental damage for a new run', () => {
    const root = new Group();
    const system = new ArenaImpactSystem(root, () => {});

    advance(system, body());
    advance(system, body());
    expect(system.debug.brokenBridgeSections).toBe(1);

    system.reset();
    expect(system.debug).toEqual({
      brokenBridgeSections: 0,
      activeSplashes: 0,
      shakingTrees: 0,
    });
  });
});
