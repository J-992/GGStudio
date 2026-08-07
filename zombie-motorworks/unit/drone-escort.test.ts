import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DroneEscort } from '../src/survival/DroneEscort.ts';

/**
 * The escort is pure transform maths on a group of meshes, so all of it can be
 * checked without a GL context — and it needs to be, because the whole point of
 * the flight is that the upgrade ladder is visible, and "one drone short" is
 * exactly the kind of regression a screenshot never catches.
 */
const CHASSIS_RADIUS_M = 2;

function escort(): DroneEscort {
  return new DroneEscort(CHASSIS_RADIUS_M);
}

/** Every drone group in the flight, hidden ones included. */
function droneGroups(unit: DroneEscort): THREE.Group[] {
  return unit.root.children.filter(
    (child): child is THREE.Group => child instanceof THREE.Group,
  );
}

function visibleDrones(unit: DroneEscort): THREE.Group[] {
  return droneGroups(unit).filter((group) => group.visible);
}

/** Run the flight for a while so fades finish and the ring is at speed. */
function settle(unit: DroneEscort, seconds = 1): void {
  for (let i = 0; i < seconds * 60; i++) {
    unit.update(1 / 60, { x: 0, y: 0, z: 0 });
  }
}

describe('DroneEscort.droneCount', () => {
  it('puts one more drone up for every level on a bay', () => {
    expect(DroneEscort.droneCount([1])).toBe(2);
    expect(DroneEscort.droneCount([2])).toBe(3);
    expect(DroneEscort.droneCount([6])).toBe(7);
  });

  it('sums bays but caps the flight so the rig stays visible', () => {
    expect(DroneEscort.droneCount([1, 1])).toBe(4);
    expect(DroneEscort.droneCount([6, 6])).toBe(8);
  });

  it('treats an out-of-range level as the nearest one on the ladder', () => {
    expect(DroneEscort.droneCount([0])).toBe(2);
    expect(DroneEscort.droneCount([99])).toBe(7);
  });

  it('is nothing at all with no bay on the rig', () => {
    expect(DroneEscort.droneCount([])).toBe(0);
  });
});

describe('DroneEscort', () => {
  it('stays hidden until a bay is on the rig', () => {
    const unit = escort();
    settle(unit);
    expect(unit.root.visible).toBe(false);
    unit.dispose();
  });

  it('flies exactly the drones the bays are worth', () => {
    const unit = escort();
    unit.setDroneCount(3);
    settle(unit);
    expect(unit.root.visible).toBe(true);
    expect(visibleDrones(unit)).toHaveLength(3);
    unit.dispose();
  });

  it('eases a new drone in rather than popping it into the ring', () => {
    const unit = escort();
    unit.setDroneCount(2);
    settle(unit);
    unit.setDroneCount(3);
    unit.update(1 / 60, { x: 0, y: 0, z: 0 });
    const arriving = visibleDrones(unit)[2];
    expect(arriving.scale.x).toBeLessThan(0.6);
    settle(unit);
    expect(arriving.scale.x).toBeCloseTo(1, 2);
    unit.dispose();
  });

  it('takes the flight home when the bay is torn off', () => {
    const unit = escort();
    unit.setDroneCount(4);
    settle(unit);
    unit.setDroneCount(0);
    settle(unit);
    expect(visibleDrones(unit)).toHaveLength(0);
    expect(unit.root.visible).toBe(false);
    unit.dispose();
  });

  it('loiters clear of the chassis and above it', () => {
    const unit = escort();
    unit.setDroneCount(8);
    settle(unit);
    for (const drone of visibleDrones(unit)) {
      const radius = Math.hypot(drone.position.x, drone.position.z);
      expect(radius).toBeGreaterThan(CHASSIS_RADIUS_M);
      expect(drone.position.y).toBeGreaterThan(0.8);
    }
    unit.dispose();
  });

  it('keeps the ring over the rig as it drives', () => {
    const unit = escort();
    unit.setDroneCount(2);
    settle(unit);
    unit.update(1 / 60, { x: 40, y: 1.5, z: -12 });
    expect(unit.root.position.toArray()).toEqual([40, 1.5, -12]);
    unit.dispose();
  });

  it('never has two drones flying the same line', () => {
    const unit = escort();
    unit.setDroneCount(8);
    settle(unit);
    const seats = visibleDrones(unit).map((drone) =>
      [drone.position.x, drone.position.y, drone.position.z].join(),
    );
    expect(new Set(seats).size).toBe(seats.length);
    unit.dispose();
  });

  it('pops a bubble on an intercept and drops it again within a beat', () => {
    const unit = escort();
    unit.setDroneCount(2);
    settle(unit);
    const bubble = unit.root.children.find(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshBasicMaterial &&
        !child.material.wireframe,
    );
    if (bubble === undefined) throw new Error('escort built no bubble');
    expect(bubble.visible).toBe(false);

    unit.flashIntercept();
    unit.update(1 / 60, { x: 0, y: 0, z: 0 });
    const material = bubble.material as THREE.MeshBasicMaterial;
    expect(bubble.visible).toBe(true);
    expect(material.opacity).toBeGreaterThan(0);

    // A quarter of a second later the catch is over: the bubble is a flicker,
    // not a shield the player could mistake for cover.
    settle(unit, 0.25);
    expect(bubble.visible).toBe(false);
    unit.dispose();
  });

  it('flies a drone into the shot it just caught', () => {
    const unit = escort();
    unit.setDroneCount(4);
    settle(unit);
    const catchPoint = new THREE.Vector3(3, 1.2, 3);

    unit.flashIntercept(catchPoint);
    let closest = Infinity;
    for (let i = 0; i < 30; i++) {
      unit.update(1 / 60, { x: 0, y: 0, z: 0 });
      for (const drone of visibleDrones(unit)) {
        closest = Math.min(closest, drone.position.distanceTo(catchPoint));
      }
    }
    // Something has to actually reach the box, not gesture at it: the whole
    // point of the dive is that the player sees what killed the shot.
    expect(closest).toBeLessThan(0.25);
    unit.dispose();
  });

  it('brings the flight back into the ring after the dive', () => {
    const unit = escort();
    unit.setDroneCount(4);
    settle(unit);
    const catchPoint = new THREE.Vector3(3, 1.2, 3);

    unit.flashIntercept(catchPoint);
    settle(unit);
    for (const drone of visibleDrones(unit)) {
      const radius = Math.hypot(drone.position.x, drone.position.z);
      expect(radius).toBeGreaterThan(CHASSIS_RADIUS_M);
      expect(drone.position.distanceTo(catchPoint)).toBeGreaterThan(0.5);
    }
    unit.dispose();
  });

  it('leaves the ring alone for a catch with no position to fly to', () => {
    const dived = escort();
    const loitering = escort();
    for (const unit of [dived, loitering]) {
      unit.setDroneCount(4);
      settle(unit);
    }

    dived.flashIntercept();
    for (let i = 0; i < 20; i++) {
      dived.update(1 / 60, { x: 0, y: 0, z: 0 });
      loitering.update(1 / 60, { x: 0, y: 0, z: 0 });
    }
    expect(visibleDrones(dived).map((drone) => drone.position.toArray())).toEqual(
      visibleDrones(loitering).map((drone) => drone.position.toArray()),
    );
    dived.dispose();
    loitering.dispose();
  });

  it('does nothing once disposed', () => {
    const unit = escort();
    unit.setDroneCount(4);
    settle(unit);
    unit.dispose();
    const before = unit.root.position.clone();
    unit.flashIntercept();
    unit.update(1 / 60, { x: 5, y: 0, z: 5 });
    expect(unit.root.position).toEqual(before);
  });
});
