import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { PhysicsWorld, initRapier, GROUP, collisionGroups } from '../src/physics/PhysicsWorld';
import {
  PlayerController,
  PlayerState,
  consumeEdges,
  type PlayerEvents,
  type RunInput,
} from '../src/physics/PlayerController';
import { PHYSICS, resetPhysicsConfig, capsuleFeetOffset } from '../src/physics/PhysicsConfig';
import { RunPath } from '../src/levels/RunPath';
import { TRACK_Y } from '../src/levels/TrackConfig';

/**
 * Real physics tests.
 *
 * Rapier's WASM runs fine in Node, so the actual movement model can be
 * exercised headlessly - no WebGL involved.
 *
 * The runner prescribes its own velocity and rotation every step rather than
 * being pushed around by forces, and most of what can go wrong with that is
 * invisible until it is measured: a capsule that quietly pitches over, a lip
 * that silently becomes an unclimbable wall, a jump that no longer reaches the
 * gaps the levels were compressed to fit. Those are what these cover.
 */

const NO_INPUT: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };

function input(partial: Partial<RunInput> = {}): RunInput {
  return { ...NO_INPUT, ...partial };
}

/**
 * Drives the controller for a number of fixed steps.
 * Every field of RunInput is edge-triggered, so all of them are consumed after
 * the first step - exactly as InputManager delivers them.
 */
function simulate(
  world: PhysicsWorld,
  player: PlayerController,
  steps: number,
  first: Partial<RunInput> = {},
): void {
  const drive = input(first);

  for (let i = 0; i < steps; i++) {
    player.step(PHYSICS.fixedTimeStep, drive);
    world.world.step();
    consumeEdges(drive);
  }
}

/** A large static floor. */
function addFloor(world: PhysicsWorld, y = 0, angleDeg = 0, friction = 0.9): void {
  const quat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    THREE.MathUtils.degToRad(angleDeg),
  );

  const body = world.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, y, 0)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
  );

  world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
      .setFriction(friction)
      .setCollisionGroups(collisionGroups(GROUP.GROUND, GROUP.PLAYER | GROUP.OBSTACLE)),
    body,
  );
}

/** A static box, for lips, walls and landing pads. */
function addBox(
  world: PhysicsWorld,
  centre: [number, number, number],
  half: [number, number, number],
  group: number = GROUP.GROUND,
): void {
  const body = world.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(...centre),
  );
  world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(...half)
      .setFriction(0.9)
      .setCollisionGroups(collisionGroups(group, GROUP.PLAYER | GROUP.OBSTACLE)),
    body,
  );
}

/** A crate on GROUP.OBSTACLE, straddling the track centreline. */
function addObstacle(world: PhysicsWorld, z: number, halfH: number): void {
  const body = world.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.5 + halfH, z),
  );
  world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(1.2, halfH, 0.5)
      .setFriction(0.9)
      .setCollisionGroups(collisionGroups(GROUP.OBSTACLE, GROUP.PLAYER)),
    body,
  );
}

/** Straight track up +Z. */
function straightPath(): RunPath {
  return new RunPath([
    [0, 0, -50],
    [0, 0, 400],
  ]);
}

/**
 * Track that runs up +Z to z = 100 then turns LEFT onto +X.
 *
 * Left, not right: the camera trails the runner and three.js cameras look down
 * their local -Z, so screen-right when heading +Z is world -X. Swinging onto +X
 * sweeps left across the screen. See the handedness note in RunPath.
 */
function cornerPath(): RunPath {
  return new RunPath([
    [0, 0, -50],
    [0, 0, 100],
    [150, 0, 100],
  ]);
}

const SPAWN = new THREE.Vector3(0, 2, 0);

describe('PlayerController', () => {
  let world: PhysicsWorld;
  let player: PlayerController;

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    addFloor(world);
    player = new PlayerController(world);
    player.setPath(straightPath());
    player.spawn(SPAWN, 0);
  });

  afterEach(() => {
    world.dispose();
  });

  it('answers every accessor safely before spawn and after dispose', () => {
    // Regression: the render loop runs continuously - it draws the main menu
    // long before any level exists, and can have a frame in flight while a
    // level is being torn down. getYaw() dereferenced the rigid body
    // unconditionally, so it threw on every single menu frame, and because that
    // throw happened before renderer.render() the menu drew nothing at all.
    const fresh = new PlayerController(world);
    expect(fresh.hasBody).toBe(false);
    expect(() => fresh.getYaw()).not.toThrow();
    expect(Number.isFinite(fresh.getYaw())).toBe(true);
    expect(() => fresh.getPosition(new THREE.Vector3())).not.toThrow();
    expect(() => fresh.getRotation(new THREE.Quaternion())).not.toThrow();
    expect(fresh.getVelocity(new THREE.Vector3()).length()).toBe(0);
    expect(() => fresh.step(PHYSICS.fixedTimeStep, input({ jump: true }))).not.toThrow();
    expect(() => fresh.setPath(straightPath())).not.toThrow();

    player.dispose();
    expect(player.hasBody).toBe(false);
    expect(() => player.getYaw()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  it('runs forward at a constant speed with no input at all', () => {
    simulate(world, player, 120);

    const position = player.getPosition(new THREE.Vector3());
    // Read back post-solver, so it always shows one step of linearDamping and a
    // little floor friction - constant, not exactly runSpeed.
    expect(player.horizontalSpeed).toBeGreaterThan(PHYSICS.runSpeed * 0.97);
    expect(player.horizontalSpeed).toBeLessThan(PHYSICS.runSpeed * 1.03);
    // Two seconds of running, minus the settling frames before it touches down.
    expect(position.z).toBeGreaterThan(PHYSICS.runSpeed * 1.8);
    expect(position.x).toBeCloseTo(0, 1);
  });

  it('holds its lane instead of drifting', () => {
    simulate(world, player, 240);
    expect(Math.abs(player.lateral)).toBeLessThan(0.1);
  });

  it('changes lane on a single step and settles there', () => {
    simulate(world, player, 30);
    simulate(world, player, 60, { laneStep: 1 });

    expect(player.lane).toBe(1);
    expect(player.lateral).toBeCloseTo(PHYSICS.laneSpacing, 0);

    simulate(world, player, 60, { laneStep: -2 });
    expect(player.lane).toBe(-1);
    expect(player.lateral).toBeCloseTo(-PHYSICS.laneSpacing, 0);
  });

  it('moves one lane per tap even when a frame runs several sub-steps', () => {
    // The regression this exists for: readDriveInput() fills the RunInput once
    // per RENDERED frame, but PhysicsWorld.update() drains its accumulator with
    // a while-loop, so a slow frame calls the step callback several times off
    // that single read. laneStep is additive, so one tap became two or three
    // lane changes below 60 fps - and the clamp to [-1,1] hid it whenever the
    // runner happened to start in the centre.
    simulate(world, player, 30, { laneStep: 1 });
    expect(player.lane).toBe(1);

    // A 50 ms frame: three fixed steps off one tap.
    const drive = input({ laneStep: -1 });
    world.update(3 * PHYSICS.fixedTimeStep, (dt) => {
      player.step(dt, drive);
      consumeEdges(drive);
    });

    expect(world.stepsLastFrame).toBeGreaterThan(1);
    // One tap, one lane. Without consumeEdges this lands on -1.
    expect(player.lane).toBe(0);
  });

  it('clamps to the outer lanes', () => {
    simulate(world, player, 30);
    simulate(world, player, 30, { laneStep: 2 });
    simulate(world, player, 30, { laneStep: 2 });

    expect(player.lane).toBe(1);
    expect(player.lateral).toBeLessThan(PHYSICS.laneSpacing * 1.2);
  });

  it('crosses a lane quickly enough to dodge', () => {
    simulate(world, player, 30);

    let steps = 0;
    const drive = input({ laneStep: 1 });
    while (steps < 120 && Math.abs(player.lateral - PHYSICS.laneSpacing) > 0.25) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      drive.laneStep = 0;
      steps++;
    }

    // A dodge the player cannot complete inside a third of a second is a dodge
    // they cannot react with.
    expect(steps).toBeLessThan(20);
  });

  it('completes a lane change inside the authored window', () => {
    // The point of replacing the proportional seek with a timed tween: a seek
    // has a time constant and an exponential tail, so it has no arrival time at
    // all. This measures a real one.
    simulate(world, player, 30);

    const drive = input({ laneStep: 1 });
    let elapsed = 0;
    for (let i = 0; i < 60; i++) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      consumeEdges(drive);
      elapsed += PHYSICS.fixedTimeStep;
      if (!player.isChangingLane) break;
    }

    expect(elapsed).toBeGreaterThanOrEqual(0.15);
    expect(elapsed).toBeLessThanOrEqual(0.29 + PHYSICS.fixedTimeStep);
    expect(player.lateral).toBeCloseTo(PHYSICS.laneSpacing, 1);
  });

  it('arrives in the new lane without overshooting it', () => {
    // Smoothstep eases out, so the runner settles rather than swinging past and
    // being dragged back - an overshoot is what would make a fast lane change
    // read as a skid instead of a step.
    simulate(world, player, 30);

    const drive = input({ laneStep: 1 });
    let furthest = 0;
    for (let i = 0; i < 90; i++) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      consumeEdges(drive);
      furthest = Math.max(furthest, player.lateral);
    }

    expect(furthest - PHYSICS.laneSpacing).toBeLessThan(0.05);
  });

  it('takes two lanes in one sweep without doubling the time', () => {
    simulate(world, player, 30, { laneStep: 1 });
    simulate(world, player, 40);

    const drive = input({ laneStep: -2 });
    let elapsed = 0;
    for (let i = 0; i < 60; i++) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      consumeEdges(drive);
      elapsed += PHYSICS.fixedTimeStep;
      if (!player.isChangingLane) break;
    }

    expect(player.lane).toBe(-1);
    expect(elapsed).toBeLessThanOrEqual(0.29 + PHYSICS.fixedTimeStep);
  });

  it('reports a lane change once per press, with its direction and duration', () => {
    const changes: Array<{ direction: number; duration: number }> = [];
    const listener = new PlayerController(world, {
      onLaneChange: (direction, duration) => changes.push({ direction, duration }),
    });
    listener.setPath(straightPath());
    listener.spawn(SPAWN, 0);

    simulate(world, listener, 20, { laneStep: 1 });
    expect(changes).toHaveLength(1);
    expect(changes[0].direction).toBe(1);
    expect(changes[0].duration).toBeCloseTo(PHYSICS.laneChangeTime, 6);

    // Already in the outer lane, so a further push is not a lane change and
    // must not fire the hop again.
    simulate(world, listener, 20, { laneStep: 1 });
    expect(changes).toHaveLength(1);

    listener.dispose();
  });

  // -------------------------------------------------------------------------
  // Orientation
  // -------------------------------------------------------------------------

  it('stays level instead of accumulating pitch', () => {
    // Regression, and the reason applyHeading zeroes angular velocity. Writing
    // rotation alone is not enough: prescribing 11 u/s of tangential slip
    // against the floor torques the capsule below its centre of mass, and
    // angularDamping settles that at a permanent ten-degree nose-down. That in
    // turn drops the capsule's lowest point below what capsuleFeetOffset
    // assumes, so the rendered cat sinks into the roof.
    simulate(world, player, 400);

    const euler = new THREE.Euler().setFromQuaternion(
      player.getRotation(new THREE.Quaternion()),
    );
    expect(Math.abs(THREE.MathUtils.radToDeg(euler.x))).toBeLessThan(1);
    expect(Math.abs(THREE.MathUtils.radToDeg(euler.z))).toBeLessThan(1);

    const angvel = player.body.angvel();
    expect(Math.abs(angvel.x)).toBeLessThan(1);
    expect(Math.abs(angvel.z)).toBeLessThan(1);
  });

  it('rests at the height capsuleFeetOffset assumes', () => {
    simulate(world, player, 180);
    // Floor top is 0.5; the capsule centre should sit a half-extent above it.
    const expected = 0.5 + PHYSICS.colliderHalfHeight + PHYSICS.colliderRadius;
    expect(player.getPosition(new THREE.Vector3()).y).toBeCloseTo(expected, 1);
  });

  // -------------------------------------------------------------------------
  // Jumping
  // -------------------------------------------------------------------------

  it('jumps, and only once per airborne period', () => {
    simulate(world, player, 60);
    const resting = player.getPosition(new THREE.Vector3()).y;

    let peak = resting;
    const drive = input({ jump: true });
    for (let i = 0; i < 60; i++) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      // Hold the button down: a second jump must not fire mid-air.
      drive.jump = true;
      peak = Math.max(peak, player.getPosition(new THREE.Vector3()).y);
    }

    expect(peak - resting).toBeGreaterThan(1.2);
    expect(peak - resting).toBeLessThan(2.2);
  });

  // -------------------------------------------------------------------------
  // Trampoline (rooftop-tier launch)
  // -------------------------------------------------------------------------

  it('launchUpward reaches roughly the apex its own velocity implies', () => {
    // v = sqrt(2 * |gravity| * apex), so apex = v^2 / (2 * |gravity|). Not an
    // exact match: air drag/prescribed-horizontal coupling isn't modelled in
    // this formula, just close enough to catch a wrong sign or a dropped
    // factor of two.
    simulate(world, player, 60);
    const resting = player.getPosition(new THREE.Vector3()).y;
    const velocity = 7.6;
    const expectedApex = (velocity * velocity) / (2 * Math.abs(PHYSICS.gravity));

    player.launchUpward(velocity);
    let peak = resting;
    for (let i = 0; i < 90; i++) {
      player.step(PHYSICS.fixedTimeStep, input());
      world.world.step();
      peak = Math.max(peak, player.getPosition(new THREE.Vector3()).y);
    }

    expect(peak - resting).toBeGreaterThan(expectedApex * 0.7);
    expect(peak - resting).toBeLessThan(expectedApex * 1.3);
  });

  it('launchUpward immediately leaves the runner airborne, like a jump', () => {
    simulate(world, player, 60);
    expect(player.grounded).toBe(true);

    player.launchUpward(7.6);
    expect(player.grounded).toBe(false);
  });

  it('launchUpward replaces downward velocity rather than adding to it - height is consistent whether rising or falling', () => {
    // Same reasoning tryJump() itself documents: without this, triggering the
    // pad while already falling would launch lower than triggering it while
    // still rising or standing. Reaching into the private `body` field to
    // fake a fall in flight - same technique this suite's obstacle-alignment
    // test already uses, for the same reason (no input path reaches this
    // state directly).
    simulate(world, player, 60);
    const body = (player as unknown as { body: RAPIER.RigidBody }).body;
    body.setLinvel({ x: 0, y: -20, z: body.linvel().z }, true);

    player.launchUpward(7.6);
    expect(body.linvel().y).toBeCloseTo(7.6, 5);
  });

  it('clears the widest gap the compressed levels contain', () => {
    // This is the number the whole level transform is sized against: at
    // PHYSICS.runSpeed a flat-to-flat jump carries about 9.5 units, and
    // GAP_COMPRESSION exists to bring every authored gap inside it. If this
    // regresses, levels become uncompletable rather than merely harder.
    simulate(world, player, 60);

    const start = player.getPosition(new THREE.Vector3());
    const startY = start.y;

    const drive = input({ jump: true });
    let airborne = false;
    let landed = start.z;

    for (let i = 0; i < 200; i++) {
      player.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      drive.jump = false;

      const position = player.getPosition(new THREE.Vector3());
      if (position.y > startY + 0.3) airborne = true;
      if (airborne && position.y <= startY + 0.05) {
        landed = position.z;
        break;
      }
    }

    const reach = landed - start.z;
    expect(reach).toBeGreaterThan(9);
  });

  // -------------------------------------------------------------------------
  // Geometry the runner has to survive
  // -------------------------------------------------------------------------

  it('is lifted over a lip that would otherwise stop it dead', () => {
    // Measured: with velocity prescribed every step, contact resolution wins at
    // a vertical face and nothing ever supplies the vertical speed to climb it,
    // so a 0.4-unit step is a permanent stop rather than a bump. Two of these
    // existed in the authored levels.
    addBox(world, [0, 0.5, 40], [20, 0.5, 20]);

    simulate(world, player, 60);
    const before = player.getPosition(new THREE.Vector3());
    simulate(world, player, 200);
    const after = player.getPosition(new THREE.Vector3());

    expect(after.z).toBeGreaterThan(before.z + 30);
    expect(after.y).toBeGreaterThan(before.y + 0.45);
    expect(player.horizontalSpeed).toBeGreaterThan(PHYSICS.runSpeed * 0.8);
  });

  it('reports being blocked by something it cannot climb', () => {
    let blocked = 0;
    let collisions = 0;
    const events: PlayerEvents = {
      onBlocked: () => blocked++,
      onCollision: () => collisions++,
    };

    const walled = new PlayerController(world, events);
    walled.setPath(straightPath());
    walled.spawn(SPAWN, 0);

    // A wall well past maxStepUp: the runner would otherwise sit against it
    // until the pursuers arrived, with nothing in the game ever noticing.
    addBox(world, [0, 3, 30], [20, 3, 1]);

    simulate(world, walled, 400);

    expect(blocked).toBeGreaterThan(0);
    // ...but it is GROUND, so it does not bill for the touch. Being wedged
    // still ends the run - through the grace period above, which is the only
    // mechanism that can tell "wedged" from "brushed past".
    expect(collisions).toBe(0);

    walled.dispose();
  });

  // -------------------------------------------------------------------------
  // Collisions
  // -------------------------------------------------------------------------

  it('fires onCollision exactly once when it runs head-on into a crate', () => {
    // Regression: probeWall stops the runner ~0.3 units short of whatever face
    // it finds, and that gap is what stops the solver extruding the capsule up
    // the wall. But it also means the solver contact handleContact relies on
    // never happens for a square hit - so the crash now has to come from the
    // probe's own wallAhead rising edge, and it must fire once, not once per
    // step for as long as the runner sits jammed against the crate.
    let collisions = 0;
    let blocked = 0;
    const crashed = new PlayerController(world, {
      onCollision: () => collisions++,
      onBlocked: () => blocked++,
    });
    crashed.setPath(straightPath());
    crashed.spawn(SPAWN, 0);

    addObstacle(world, 30, 0.75);

    simulate(world, crashed, 400);

    expect(collisions).toBe(1);
    // Cannot get past it, so the separate blocked-timeout escalation also
    // fires - that is a rewind to safe ground, on top of the instant crash.
    expect(blocked).toBeGreaterThan(0);

    crashed.dispose();
  });

  /**
   * Runs the cat down the outer lane past a board standing beside it, and
   * counts the crashes charged for brushing it.
   *
   * This is the reported plank bug, reduced. The board occupies x 2.5..4.5; the
   * outer lane centre is at x 2.4 and the capsule reaches 2.74, so running that
   * lane clips the board's flank while the *floor* is what the ground ray
   * reports underfoot. `handleContact` only ever excused the one collider the
   * ray happened to be reporting, so the brush read as a head-on crash and cost
   * a life - which is what happened to every plank narrower than the lane span.
   *
   * NOTE this drives the simulation through `PhysicsWorld.update()` rather than
   * through `simulate()`. Contact events only exist if the event queue is handed
   * to `world.step()` and then drained, which only `update()` does; `simulate()`
   * calls `world.world.step()` directly. That is why no test in this file had
   * ever exercised `handleContact`, and why this bug survived to be reported
   * from play.
   */
  function brushBoardInOuterLane(group: number): number {
    let collisions = 0;
    const runner = new PlayerController(world, { onCollision: () => collisions++ });
    runner.setPath(straightPath());
    runner.spawn(SPAWN, 0);

    // Stands on the floor beside the outer lane, tall enough that the capsule
    // meets its side rather than its top. The forward wall probe runs along
    // x = 2.4 and so passes clear of it - this is a brush, not a wall.
    addBox(world, [3.5, 1.25, 40], [1, 0.75, 25], group);

    const drive = input({ laneStep: -1 });
    for (let i = 0; i < 320; i++) {
      world.update(PHYSICS.fixedTimeStep, (dt) => {
        runner.step(dt, drive);
        consumeEdges(drive);
      });
    }

    // The scenario has to actually happen, or a green result means nothing.
    expect(runner.lane).toBe(-1);
    expect(runner.getPosition(new THREE.Vector3()).z).toBeGreaterThan(50);

    runner.dispose();
    return collisions;
  }

  it('does not charge a life for clipping walkable geometry', () => {
    expect(brushBoardInOuterLane(GROUP.GROUND)).toBe(0);
  });

  it('still charges a life for the same board on GROUP.OBSTACLE', () => {
    // The other half of the rule. Identical geometry, identical run - only the
    // collision group differs - so the test above cannot be passing merely
    // because nothing was ever touched.
    expect(brushBoardInOuterLane(GROUP.OBSTACLE)).toBeGreaterThan(0);
  });

  it('never cries wolf on a clean run, including over a climbable lip', () => {
    // A wall that stays unclimbable would be an obvious false-negative to
    // catch; the nastier failure mode is a false-positive on a lip the runner
    // is meant to just step up over. Floor top is 0.5, lip top is 0.9 - a
    // 0.4-unit rise, comfortably inside maxStepUp (0.5).
    let collisions = 0;
    const clean = new PlayerController(world, { onCollision: () => collisions++ });
    clean.setPath(straightPath());
    clean.spawn(SPAWN, 0);

    addBox(world, [0, 0.7, 40], [20, 0.2, 20]);

    simulate(world, clean, 400);

    expect(collisions).toBe(0);
    clean.dispose();
  });

  // -------------------------------------------------------------------------
  // reportObstacleHit (collider-less hazards, e.g. the endless track's
  // duck-under beam)
  // -------------------------------------------------------------------------

  it('reportObstacleHit stumbles on a straight-on hit', () => {
    let collisions = 0;
    const runner = new PlayerController(world, { onCollision: () => collisions++ });
    runner.setPath(straightPath());
    runner.spawn(SPAWN, 0);

    // Cruise straight for a while so velocity is aligned with yaw, same as
    // any ordinary run into a hazard with no lane change in progress.
    simulate(world, runner, 60);
    runner.reportObstacleHit();

    expect(runner.state).toBe(PlayerState.Stumbling);
    expect(collisions).toBe(1);

    runner.dispose();
  });

  it('reportObstacleHit does not stumble on a shallow-angle graze', () => {
    // Regression: reportObstacleHit() used to have no alignment gate at all,
    // unlike handleContact()/detectBlocked() which both already excuse a hit
    // this shallow (alignment < 0.35) as a graze rather than a crash.
    //
    // Ordinary lane-change tweens turn out not to be reachable this way in
    // the current tuning - forward speed stays pinned at PHYSICS.runSpeed
    // (11) while lateral speed is clamped to maxLaneSpeed (24), and even at
    // that clamp the combined-velocity alignment only drops to ~0.42, still
    // above the 0.35 gate. So this drives the body's velocity directly
    // (reaching into the private `body` field, same technique the rest of
    // this suite avoids needing only because it stays within tunings that
    // are reachable through ordinary input) to exercise the alignment gate
    // itself in isolation, independent of whether any specific move
    // (lane-change, turn, a future faster power-up) can reach it today.
    let collisions = 0;
    const runner = new PlayerController(world, { onCollision: () => collisions++ });
    runner.setPath(straightPath());
    runner.spawn(SPAWN, 0);

    simulate(world, runner, 60); // establishes yaw = 0 (facing +Z)
    const body = (runner as unknown as { body: RAPIER.RigidBody }).body;
    const velocity = { x: 20, y: 0, z: 2 }; // mostly sideways, barely forward
    body.setLinvel(velocity, true);
    runner.horizontalSpeed = Math.hypot(velocity.x, velocity.z);

    runner.reportObstacleHit();

    expect(runner.state).not.toBe(PlayerState.Stumbling);
    expect(collisions).toBe(0);

    runner.dispose();
  });

  // -------------------------------------------------------------------------
  // Corners
  // -------------------------------------------------------------------------

  it('carries straight on through a corner that is never taken', () => {
    const cornered = new PlayerController(world);
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    simulate(world, cornered, 400);

    // Still on the first run, still heading up +Z, well past the corner. On a
    // real level that is a roof edge and a fall - which is the point.
    expect(cornered.segment).toBe(0);
    expect(cornered.getPosition(new THREE.Vector3()).z).toBeGreaterThan(120);
    expect(Math.abs(cornered.getYaw())).toBeLessThan(0.1);

    cornered.dispose();
  });

  it('takes the corner on a turn input, and only inside the zone', () => {
    let turns = 0;
    const cornered = new PlayerController(world, { onTurn: () => turns++ });
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    // Far too early: the corner is 30 units away, the zone opens at 18.
    simulate(world, cornered, 10, { turn: -1 });
    expect(cornered.segment).toBe(0);
    expect(turns).toBe(0);
    expect(cornered.turnBuffered).toBe(0);

    // Run up to the zone, then turn.
    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }
    expect(cornered.pendingTurn).toBe(-1);

    // The press books the turn straight away, but the heading does not swing
    // until the corner - see turnCommitDistance. Pivoting the moment the input
    // arrives would leave the runner most of the input window away from the new
    // run's centreline, and the lane seek would then drag it off the roof.
    simulate(world, cornered, 4, { turn: -1 });
    expect(cornered.turnBuffered).toBe(-1);
    expect(cornered.segment).toBe(0);
    expect(turns).toBe(0);

    // 18 units of window less 2.5 of commit distance is 1.4s at runSpeed.
    simulate(world, cornered, 120);

    expect(turns).toBe(1);
    expect(cornered.turnBuffered).toBe(0);
    expect(cornered.segment).toBe(1);
    // Now running along +X instead.
    expect(cornered.getYaw()).toBeCloseTo(Math.PI / 2, 1);
    expect(cornered.lane).toBe(0);

    const before = cornered.getPosition(new THREE.Vector3());
    simulate(world, cornered, 60);
    const after = cornered.getPosition(new THREE.Vector3());
    expect(after.x - before.x).toBeGreaterThan(8);

    cornered.dispose();
  });

  it('puts the runner back in the middle lane after clearing a corner', () => {
    const cornered = new PlayerController(world);
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    // Enter the corner committed to an outer lane, with the lane tween still
    // running - which is the case that needs the explicit cancel. The tween's
    // endpoints are lateral offsets against the OLD segment, and the new
    // segment's `right` is perpendicular to it, so a tween left running would
    // spend its remaining time dragging the runner ALONG the new track instead
    // of across it.
    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }
    simulate(world, cornered, 2, { laneStep: 1 });
    expect(cornered.lane).toBe(1);
    expect(cornered.isChangingLane).toBe(true);

    // Step until the turn is actually taken, then look at that exact instant.
    // Sampling a second later would prove nothing: the hold term cleans up
    // after a stale tween eventually, so a late assertion passes either way.
    const drive = input({ turn: -1 });
    for (let i = 0; i < 150 && cornered.segment === 0; i++) {
      cornered.step(PHYSICS.fixedTimeStep, drive);
      world.world.step();
      consumeEdges(drive);
    }

    expect(cornered.segment).toBe(1);
    expect(cornered.lane).toBe(0);
    // The tween's endpoints were lateral offsets against the OLD segment, and
    // the new segment's `right` is perpendicular to it. Leaving it running
    // sends the runner along the new track rather than across it.
    expect(cornered.isChangingLane).toBe(false);

    // And it settles onto the new run's centre line rather than carrying the
    // old lane through.
    simulate(world, cornered, 40);
    expect(Math.abs(cornered.lateral)).toBeLessThan(0.3);

    cornered.dispose();
  });

  it('stops warning about a corner once it has been taken', () => {
    const cornered = new PlayerController(world);
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }
    // Inside the zone the HUD needs a finite distance to ramp the flash with.
    expect(cornered.turnDistance).toBeLessThanOrEqual(PHYSICS.turnZoneBefore);
    expect(cornered.turnDistance).toBeGreaterThan(0);

    simulate(world, cornered, 150, { turn: -1 });

    // Past the corner there is no junction left on this path, so the warning
    // has to fall silent rather than hold its last value.
    expect(cornered.inTurnZone).toBe(false);
    expect(cornered.pendingTurn).toBe(0);
    expect(cornered.turnBuffered).toBe(0);
    expect(cornered.turnDistance).toBe(Infinity);

    cornered.dispose();
  });

  it('takes the corner on a single sideways press, not just a double-tap', () => {
    // The reported bug: pressing left at a left corner did nothing but change
    // lane, and the runner carried straight off the roof. A turn request was
    // only raised by a double-tap inside 280ms, so the obvious input was the
    // one input that did not work.
    let turns = 0;
    const cornered = new PlayerController(world, { onTurn: () => turns++ });
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    // One press, on the corner's side, with `turn` left at 0 - exactly what a
    // single tap delivers.
    simulate(world, cornered, 150, { laneStep: -1 });

    expect(turns).toBe(1);
    expect(cornered.segment).toBe(1);
    expect(cornered.getYaw()).toBeCloseTo(Math.PI / 2, 1);
    // ...and the press was spent on the turn, so it did not also change lane.
    expect(cornered.lane).toBe(0);

    cornered.dispose();
  });

  it('does not let a single press turn the wrong way at a corner', () => {
    let turns = 0;
    const cornered = new PlayerController(world, { onTurn: () => turns++ });
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    // The corner goes left; a right press is an ordinary lane change.
    simulate(world, cornered, 60, { laneStep: 1 });

    expect(turns).toBe(0);
    expect(cornered.segment).toBe(0);
    expect(cornered.lane).toBe(1);

    cornered.dispose();
  });

  it('holds a booked turn until the corner rather than pivoting early', () => {
    // Accepting the press early is forgiving; acting on it early is not. The
    // new run's centreline is `turnZoneBefore` units sideways from a runner
    // that pivots at the top of the window, and the lane seek would then drag
    // it that far across the roof at 24 u/s - straight off the edge.
    const cornered = new PlayerController(world);
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    simulate(world, cornered, 2, { laneStep: -1 });
    expect(cornered.turnBuffered).toBe(-1);

    // Step to the instant the turn commits and check where it happened.
    for (let i = 0; i < 200 && cornered.segment === 0; i++) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    expect(cornered.segment).toBe(1);
    // Lateral is measured against the NEW run, so this is how far short of the
    // corner the pivot happened. Pivoting at the top of the window would put it
    // near turnZoneBefore.
    expect(Math.abs(cornered.lateral)).toBeLessThan(PHYSICS.turnCommitDistance + 1);

    cornered.dispose();
  });

  it('drops a booked turn if the corner is missed', () => {
    // Otherwise it fires at whatever junction comes next, turning the runner
    // off a roof it was running down perfectly happily.
    const cornered = new PlayerController(world);
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    // Book it, then take the zone away before it can commit.
    simulate(world, cornered, 2, { laneStep: -1 });
    expect(cornered.turnBuffered).toBe(-1);

    cornered.setPath(straightPath());
    simulate(world, cornered, 30);

    expect(cornered.turnBuffered).toBe(0);
    cornered.dispose();
  });

  it('ignores a turn into the wrong side of a corner', () => {
    let turns = 0;
    const cornered = new PlayerController(world, { onTurn: () => turns++ });
    cornered.setPath(cornerPath());
    cornered.spawn(new THREE.Vector3(0, 2, 70), 0);

    while (!cornered.inTurnZone) {
      cornered.step(PHYSICS.fixedTimeStep, NO_INPUT);
      world.world.step();
    }

    // The corner goes left; turning right must do nothing but shift a lane.
    simulate(world, cornered, 30, { turn: 1 });
    expect(turns).toBe(0);
    expect(cornered.segment).toBe(0);

    cornered.dispose();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('stays dead once killed, with no recovery', () => {
    simulate(world, player, 30);
    player.kill();
    simulate(world, player, 180, { laneStep: 1, jump: true });

    expect(player.state).toBe(PlayerState.Dead);
  });

  it('resets cleanly to spawn', () => {
    simulate(world, player, 120, { laneStep: 1, jump: true });
    player.reset();

    const position = player.getPosition(new THREE.Vector3());
    expect(position.distanceTo(SPAWN)).toBeLessThan(1e-6);
    expect(player.state).toBe(PlayerState.Running);
    expect(player.lane).toBe(0);
    expect(player.getVelocity(new THREE.Vector3()).length()).toBe(0);
  });

  it('spawns with the capsule feet exactly on TRACK_Y, not embedded in the deck', () => {
    // Regression test: Game.ts used to pass TRACK_Y itself (the deck's top
    // surface) as the capsule's *centre* Y, embedding it capsuleFeetOffset()
    // (~0.5 units) into the deck at every spawn and every fall recovery.
    const spawnY = TRACK_Y + capsuleFeetOffset();
    player.spawn(new THREE.Vector3(0, spawnY, 0), 0);

    const feetY = player.getPosition(new THREE.Vector3()).y - capsuleFeetOffset();
    expect(feetY).toBeCloseTo(TRACK_Y, 5);
  });

  it('recovers onto the track after a fall', () => {
    simulate(world, player, 60, { laneStep: 1 });

    const target = new THREE.Vector3(0, 2, 25);
    player.recoverTo(target);

    expect(player.getPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6);
    expect(player.getVelocity(new THREE.Vector3()).length()).toBe(0);
    expect(player.lane).toBe(0);
    expect(player.state).toBe(PlayerState.Running);

    // And it is running again immediately, not stuck.
    simulate(world, player, 60);
    expect(player.horizontalSpeed).toBeCloseTo(PHYSICS.runSpeed, 0);
  });

  it('tracks how far it has fallen below its last footing', () => {
    simulate(world, player, 60);
    expect(player.fallDepth).toBeLessThan(1);

    // Drop it into space; the floor only reaches so far.
    player.body.setTranslation({ x: 0, y: -20, z: 0 }, true);
    simulate(world, player, 10);

    expect(player.fallDepth).toBeGreaterThan(PHYSICS.fallThreshold);
  });
});

// ---------------------------------------------------------------------------

describe('frame-rate independence', () => {
  beforeAll(async () => {
    await initRapier();
  });

  /** Runs two seconds of game time through the accumulator at a given fps. */
  function runAtFps(fps: number): THREE.Vector3 {
    resetPhysicsConfig();
    const world = new PhysicsWorld();
    addFloor(world);

    const player = new PlayerController(world);
    player.setPath(straightPath());
    player.spawn(SPAWN, 0);

    const frameDelta = 1 / fps;
    const drive = input();

    for (let elapsed = 0; elapsed < 2; elapsed += frameDelta) {
      world.update(frameDelta, (dt) => player.step(dt, drive));
    }

    const position = player.getPosition(new THREE.Vector3());
    world.dispose();
    return position;
  }

  it('travels the same distance at 30, 60 and 144 fps', () => {
    const at30 = runAtFps(30);
    const at60 = runAtFps(60);
    const at144 = runAtFps(144);

    // The accumulator only ever runs whole fixed steps, so the residue differs
    // by at most one step's worth of travel.
    const tolerance = PHYSICS.runSpeed * PHYSICS.fixedTimeStep * 2;
    expect(Math.abs(at30.z - at60.z)).toBeLessThan(tolerance);
    expect(Math.abs(at144.z - at60.z)).toBeLessThan(tolerance);
  });

  it('clamps the accumulator after a stall instead of spiralling', () => {
    resetPhysicsConfig();
    const world = new PhysicsWorld();
    addFloor(world);

    let steps = 0;
    world.update(10, () => steps++);

    expect(steps).toBeLessThanOrEqual(PHYSICS.maxSubSteps);
    world.dispose();
  });
});
