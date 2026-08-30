import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PlayerController } from '../src/physics/PlayerController';
import { ChunkBuilder } from '../src/levels/procedural/ChunkBuilder';
import { obstacleMaterial } from '../src/levels/procedural/PlaceholderAssets';
import {
  CATNIP_SPEED_MULTIPLIER,
  FISH_MAGNET_SPEED,
} from '../src/levels/procedural/PowerUpConfig';
import { Collectible } from '../src/entities/Collectible';
import { FollowCamera } from '../src/camera/FollowCamera';
import { PHYSICS, resetPhysicsConfig } from '../src/physics/PhysicsConfig';
import { TRACK_Y } from '../src/levels/TrackConfig';

/**
 * Catnip Rush: what the player is supposed to be able to *see*.
 *
 * The effect is two promises - you are faster, and nothing can stop you - and
 * both of them were, at one point or another, true in the code and invisible
 * on screen:
 *
 *  - Invincibility is implemented by dropping `GROUP.OBSTACLE` out of the
 *    player capsule's collision filter, which is correct and looks exactly
 *    like a collider that has come unhooked. A crate slides through the cat
 *    and carries on down the street. So the hazard is demolished at the
 *    moment of contact instead, which is the thing these first tests pin.
 *  - The speed boost multiplies `PHYSICS.runSpeed`, and the camera's own
 *    speed-derived FOV expansion is a *ratio against `PHYSICS.runSpeed`* -
 *    so the two cancelled exactly and the fastest twelve seconds in the game
 *    were framed with the cruising lens. Hence `boostFov`, pinned below.
 *
 * The third promise is the one that is not made here: the player keeps the
 * controls. An earlier pass had the rush drive the cat itself, and there is
 * deliberately nothing left of it - `readDriveInput` latches the player's own
 * input for the whole effect.
 */

const FRAME = 1 / 60;

/** Every crate currently on the deck, found by material identity - the one
 *  stable handle on them from outside `ObstaclePool`. */
function visibleCrates(scene: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material === obstacleMaterial && object.visible) {
      found.push(object);
    }
  });
  return found;
}

describe('Catnip Rush smashes what it phases through', () => {
  let world: PhysicsWorld;
  let player: PlayerController;
  let scene: THREE.Scene;
  let builder: ChunkBuilder;
  let smashed: THREE.Vector3[];

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
    world = new PhysicsWorld();
    scene = new THREE.Scene();
    player = new PlayerController(world);
    smashed = [];
    builder = new ChunkBuilder(scene, world, player, {
      seed: 4242,
      onHazardSmashed: (position) => smashed.push(position.clone()),
    });
    builder.start();
    player.spawn(new THREE.Vector3(0, TRACK_Y, 0), 0);
    player.setPath(builder.path);
  });

  afterEach(() => {
    builder.dispose();
    player.dispose();
    world.dispose();
  });

  /** Streams track until at least one crate is on the deck, then returns it. */
  function firstCrate(): THREE.Mesh {
    const walk = new THREE.Vector3(0, TRACK_Y, 0);
    const heading = new THREE.Vector3(0, 0, 1);

    for (let i = 0; i < 2000; i++) {
      builder.update(walk);
      const crates = visibleCrates(scene);
      if (crates.length > 0) return crates[0] as THREE.Mesh;

      const path = builder.path;
      if (!path) break;
      path.getDirectionAt(path.projectDistance(walk) + 1, heading);
      walk.addScaledVector(heading, 1);
    }
    throw new Error('no crate was ever dealt - the generator changed shape');
  }

  /** Stands the player inside `crate` and runs one fixed step. */
  function runThrough(crate: THREE.Mesh): void {
    player.recoverTo(crate.position.clone());
    builder.step(FRAME);
  }

  it('leaves the crate standing when the power-up is not up', () => {
    const crate = firstCrate();
    runThrough(crate);

    expect(crate.visible).toBe(true);
    expect(smashed).toHaveLength(0);
  });

  it('demolishes the crate the phased runner goes through', () => {
    const crate = firstCrate();
    player.setPhasing(true);
    runThrough(crate);

    expect(crate.visible).toBe(false);
    expect(smashed).toHaveLength(1);
    // Reported where the player can see the wreckage, not at the runner.
    expect(smashed[0]!.distanceTo(crate.position)).toBeLessThan(0.001);
  });

  it('takes the collider with it, so nothing is left to wedge against', () => {
    // Hiding the mesh alone would be worse than doing nothing: the crate
    // would vanish in a shower of sparks and then stop the runner dead the
    // moment the effect ended and `GROUP.OBSTACLE` came back into the filter.
    // `ObstaclePool.park` moves the body a couple of thousand units below the
    // track, which is what this counts.
    const crate = firstCrate();

    const bodiesNearTheDeck = () => {
      let n = 0;
      world.world.forEachRigidBody((body) => {
        if (body.translation().y > TRACK_Y - 50) n++;
      });
      return n;
    };

    const before = bodiesNearTheDeck();
    expect(before).toBeGreaterThan(0); // the decks themselves, at minimum

    player.setPhasing(true);
    runThrough(crate);

    expect(crate.visible).toBe(false);
    // Exactly one body left the neighbourhood: the crate's.
    expect(bodiesNearTheDeck()).toBe(before - 1);
  });

  it('does not re-erect the crate when the effect ends', () => {
    // The crate is gone because the cat went through it, not because the cat
    // is currently immune. A hazard that popped back the instant the rainbow
    // faded would be the same invisible-collider problem in a new hat.
    const crate = firstCrate();
    player.setPhasing(true);
    runThrough(crate);
    expect(crate.visible).toBe(false);

    player.setPhasing(false);
    for (let i = 0; i < 60; i++) builder.step(FRAME);
    expect(crate.visible).toBe(false);
  });

  it('smashes each hazard exactly once, however long it stands in it', () => {
    const crate = firstCrate();
    player.setPhasing(true);
    player.recoverTo(crate.position.clone());
    for (let i = 0; i < 30; i++) builder.step(FRAME);

    expect(smashed).toHaveLength(1);
  });

  it('leaves crates the runner passes beside alone', () => {
    const crate = firstCrate();
    player.setPhasing(true);

    // Two lanes over - `PHYSICS.laneSpacing` is 2.4, and a smash radius wide
    // enough to reach that would be clearing the whole deck at once.
    const beside = crate.position.clone();
    beside.x += PHYSICS.laneSpacing * 2;
    beside.z += PHYSICS.laneSpacing * 2;
    player.recoverTo(beside);
    builder.step(FRAME);

    expect(crate.visible).toBe(true);
    expect(smashed).toHaveLength(0);
  });
});

describe('Catnip Rush is visibly faster', () => {
  beforeEach(() => {
    resetPhysicsConfig();
  });

  it('is a boost big enough to notice', () => {
    // Not a magic number so much as a floor: at 1.35 the rush was inside the
    // range the difficulty ramp covers over an ordinary run anyway.
    expect(CATNIP_SPEED_MULTIPLIER).toBeGreaterThanOrEqual(1.45);
  });

  /**
   * The bug behind the boost being unreadable. `FollowCamera`'s speed FOV is
   * `(speed - fovExpansionSpeed) / (PHYSICS.runSpeed - fovExpansionSpeed)`,
   * and Catnip Rush's effect is a multiplier on `PHYSICS.runSpeed` - so a
   * runner at full boosted speed lands on exactly the same ratio, and the
   * same FOV, as one cruising at base speed.
   */
  it('cannot get its widening from the speed term, which cancels out', () => {
    const fovAt = (speed: number, runSpeed: number) => {
      PHYSICS.runSpeed = runSpeed;
      const camera = new FollowCamera(16 / 9);
      camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
      const velocity = new THREE.Vector3(0, 0, speed);
      // Long enough for `currentFov` to settle on its target.
      for (let i = 0; i < 600; i++) {
        camera.update(new THREE.Vector3(0, 0, 0), 0, velocity, FRAME);
      }
      return camera.camera.fov;
    };

    const base = PHYSICS.baseRunSpeed;
    const cruising = fovAt(base, base);
    const rushing = fovAt(base * CATNIP_SPEED_MULTIPLIER, base * CATNIP_SPEED_MULTIPLIER);
    expect(rushing).toBeCloseTo(cruising, 3);
  });

  it('widens the lens when the caller asks it to', () => {
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed;
    const velocity = new THREE.Vector3(0, 0, PHYSICS.baseRunSpeed);

    const camera = new FollowCamera(16 / 9);
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 600; i++) camera.update(new THREE.Vector3(0, 0, 0), 0, velocity, FRAME);
    const before = camera.camera.fov;

    camera.boostFov = 11;
    for (let i = 0; i < 600; i++) camera.update(new THREE.Vector3(0, 0, 0), 0, velocity, FRAME);
    // One decimal: `update()` skips the projection rebuild for a change under
    // 0.01 degrees, so the applied FOV settles within a hair of its target
    // rather than exactly on it.
    expect(camera.camera.fov).toBeCloseTo(before + 11, 1);

    // And gives it back, so an effect that ends mid-pause cannot leave the
    // lens stuck open.
    camera.boostFov = 0;
    for (let i = 0; i < 600; i++) camera.update(new THREE.Vector3(0, 0, 0), 0, velocity, FRAME);
    expect(camera.camera.fov).toBeCloseTo(before, 1);
  });

  it('holds still for a player who asked for reduced motion', () => {
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed;
    const velocity = new THREE.Vector3(0, 0, PHYSICS.baseRunSpeed);

    const camera = new FollowCamera(16 / 9);
    camera.reducedMotion = true;
    camera.boostFov = 11;
    camera.snapTo(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 600; i++) camera.update(new THREE.Vector3(0, 0, 0), 0, velocity, FRAME);

    expect(camera.camera.fov).toBeCloseTo(camera.config.baseFov, 3);
  });
});

/**
 * Fish Magnet, whose complaint was the opposite shape: not that the effect
 * was invisible, but that its leftovers sat in the middle of the screen.
 *
 * Two bugs, one symptom. The pull moved `root.position`, and `update()`
 * rewrote `root.position.y` from the coin's own anchor on the very next line,
 * so nothing could ever be pulled *down* to the runner - a coin authored
 * above head height closed in horizontally and then hovered there. And the
 * pull was a `lerp` fraction, which is asymptotic: even in the axes it could
 * move, it slowed to a crawl exactly where the coin was most in the way.
 */
describe('Fish Magnet actually swallows what it catches', () => {
  const target = () => new THREE.Vector3(0, 1, 0);

  it('closes the vertical gap, not just the horizontal one', () => {
    const coin = new Collectible(new THREE.Vector3(0, 4.5, 0), 0, true);
    const to = target();

    // A second of pulling. Nothing moves horizontally here at all, so this
    // fails outright under the old behaviour rather than merely being slow.
    for (let i = 0; i < 60; i++) coin.pullToward(to, FRAME);

    expect(coin.update(FRAME, to)).toBe(true);
    coin.dispose();
  });

  it('arrives, rather than approaching forever', () => {
    const coin = new Collectible(new THREE.Vector3(6, 3, 6), 1, true);
    const to = target();

    let framesToCatch = -1;
    for (let i = 0; i < 120 && framesToCatch < 0; i++) {
      coin.pullToward(to, FRAME);
      if (coin.update(FRAME, to)) framesToCatch = i;
    }

    expect(framesToCatch).toBeGreaterThanOrEqual(0);
    // Under half a second from most of the way out to the magnet's reach.
    expect(framesToCatch).toBeLessThan(30);
    coin.dispose();
  });

  it('pulls the same distance however long the frames are', () => {
    // The old lerp was `min(1, rate * dt)`, so a phone at 30 fps got a
    // measurably weaker magnet than a desktop at 120 - on the device with the
    // least screen to spare for a cloud of hovering coins.
    const travelled = (fps: number) => {
      const coin = new Collectible(new THREE.Vector3(0, 1, 12), 2, true);
      const to = target();
      const dt = 1 / fps;
      for (let i = 0; i < fps; i++) coin.pullToward(to, dt);
      const left = coin.root.position.distanceTo(to);
      coin.dispose();
      return left;
    };

    expect(travelled(30)).toBeCloseTo(travelled(120), 4);
  });

  it('is faster than the runner it is attached to', () => {
    // A magnet slower than the cat would trail coins behind it rather than
    // eating them - and Catnip Rush takes the cat half again faster still.
    expect(FISH_MAGNET_SPEED).toBeGreaterThan(PHYSICS.runSpeed * CATNIP_SPEED_MULTIPLIER);
  });
});
