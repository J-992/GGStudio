import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY, Inertia, RigidBody, Spring } from '../fx/Physics';

/**
 * The physics kernel is cosmetic, which makes it exactly the kind of code that
 * can quietly break a run: a body that never sleeps burns frame time forever, a
 * spring that rings adds jitter to every character on screen, and an integrator
 * that gains energy throws debris through the arena. These tests pin the
 * properties the fight scenes depend on.
 */

const step = (body: RigidBody, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) body.step(dt);
};

describe('RigidBody', () => {
  it('arcs, lands and comes to rest instead of falling forever', () => {
    const body = new RigidBody();
    body.reset();
    body.launch({ x: 0, y: 1, z: 0 }, { x: 6, y: 7, z: 0 }, { x: 0, y: 0, z: 12 });
    step(body, 6);
    expect(body.asleep).toBe(true);
    expect(body.position.y).toBeCloseTo(DEFAULT_BODY.radius, 5);
    expect(body.velocity.length()).toBe(0);
  });

  it('never gains energy from a bounce', () => {
    const body = new RigidBody();
    body.reset();
    body.launch({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    let peak = 3;
    let previousPeak = Infinity;
    let rising = false;
    for (let i = 0; i < 900; i++) {
      const before = body.position.y;
      body.step(1 / 60);
      if (body.position.y > before) {
        rising = true;
        peak = Math.max(peak, body.position.y);
      } else if (rising) {
        // Apex reached: each one must be lower than the last.
        expect(peak).toBeLessThan(previousPeak);
        previousPeak = peak;
        peak = 0;
        rising = false;
      }
    }
  });

  it('travels further along the ground the harder it was hit', () => {
    const distances = [4, 9, 15].map((speed) => {
      const body = new RigidBody();
      body.reset();
      body.launch({ x: 0, y: 1, z: 0 }, { x: speed, y: 4, z: 0 }, { x: 0, y: 0, z: 8 });
      step(body, 6);
      return body.position.x;
    });
    expect(distances[1]).toBeGreaterThan(distances[0]);
    expect(distances[2]).toBeGreaterThan(distances[1]);
  });

  it('drives a slammed body down harder than it was thrown up', () => {
    const slow = new RigidBody();
    slow.reset({ gravity: 26 });
    slow.launch({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const fast = new RigidBody();
    fast.reset({ gravity: 26 * 2.4 });
    fast.launch({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    step(slow, 0.3);
    step(fast, 0.3);
    expect(fast.position.y).toBeLessThan(slow.position.y);
  });

  it('never sinks through the floor, however large the timestep', () => {
    // A backgrounded tab hands back enormous deltas; the floor must still hold.
    for (const dt of [1 / 60, 1 / 15, 0.25, 0.5]) {
      const body = new RigidBody();
      body.reset();
      body.launch({ x: 0, y: 4, z: 0 }, { x: 3, y: 2, z: 1 }, { x: 4, y: 1, z: 9 });
      for (let i = 0; i < 200; i++) {
        body.step(dt);
        expect(body.position.y, `dt ${dt}`).toBeGreaterThanOrEqual(DEFAULT_BODY.radius - 1e-9);
        expect(Number.isFinite(body.position.x), `dt ${dt}`).toBe(true);
      }
    }
  });

  it('supports a lowered environment floor for water and terrain below the arena', () => {
    const body = new RigidBody();
    body.reset({ floorY: -1.2 });
    body.launch({ x: 0, y: 0, z: 0 }, { x: 0, y: -3, z: 0 }, { x: 0, y: 0, z: 0 });
    step(body, 2);
    expect(body.position.y).toBeCloseTo(-1.2 + DEFAULT_BODY.radius, 5);
  });

  it('bleeds off spin rather than tumbling forever', () => {
    const body = new RigidBody();
    body.reset();
    body.launch({ x: 0, y: 2, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 30 });
    const early = Math.abs(body.angular.z);
    step(body, 2);
    expect(Math.abs(body.angular.z)).toBeLessThan(early * 0.2);
  });

  it('is fully deterministic, so a replay of a hit looks the same twice', () => {
    const run = () => {
      const body = new RigidBody();
      body.reset();
      body.launch({ x: 0, y: 1.2, z: 0 }, { x: 5, y: 6, z: -1 }, { x: 3, y: 1, z: 14 });
      step(body, 3);
      return [body.position.x, body.position.y, body.position.z, body.rotation.z];
    };
    expect(run()).toEqual(run());
  });
});

describe('Spring', () => {
  it('reaches its target without ringing past it', () => {
    const spring = new Spring(120, 22);
    spring.reset(0);
    let overshoot = 0;
    for (let i = 0; i < 240; i++) overshoot = Math.max(overshoot, spring.step(1, 1 / 60) - 1);
    expect(spring.value).toBeCloseTo(1, 2);
    expect(overshoot).toBeLessThan(0.02);
  });

  it('stays stable when the frame rate collapses', () => {
    const spring = new Spring(120, 22);
    spring.reset(0);
    for (let i = 0; i < 60; i++) spring.step(1, 1 / 6);
    expect(Number.isFinite(spring.value)).toBe(true);
    expect(Math.abs(spring.value)).toBeLessThan(4);
  });

  it('carries an impulse through and settles back', () => {
    const spring = new Spring(90, 16);
    spring.reset(0);
    spring.impulse(8);
    let peak = 0;
    for (let i = 0; i < 300; i++) peak = Math.max(peak, Math.abs(spring.step(0, 1 / 60)));
    expect(peak).toBeGreaterThan(0.1);
    expect(spring.value).toBeCloseTo(0, 2);
  });
});

describe('Inertia', () => {
  it('reports no acceleration for something moving at a constant speed', () => {
    const inertia = new Inertia();
    inertia.reset(0, 0);
    let x = 0;
    for (let i = 0; i < 120; i++) {
      x += 3 * (1 / 60);
      inertia.step(x, 0, 1 / 60);
    }
    expect(Math.abs(inertia.accelX)).toBeLessThan(0.5);
  });

  it('reports acceleration in the direction of a change in speed', () => {
    // The signal is the transition itself: a body that starts moving spikes,
    // then settles back to zero once it is travelling at a steady speed. The
    // spikes are what secondary motion reacts to.
    const inertia = new Inertia();
    inertia.reset(0, 0);
    let x = 0;
    for (let i = 0; i < 40; i++) inertia.step(x, 0, 1 / 60);
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      x += 6 * (1 / 60);
      inertia.step(x, 0, 1 / 60);
      peak = Math.max(peak, inertia.accelX);
    }
    expect(peak).toBeGreaterThan(10);
    // And a decel spikes the other way.
    let trough = 0;
    for (let i = 0; i < 20; i++) {
      inertia.step(x, 0, 1 / 60);
      trough = Math.min(trough, inertia.accelX);
    }
    expect(trough).toBeLessThan(0);
  });

  it('shrugs off a zero-length frame', () => {
    const inertia = new Inertia();
    inertia.reset(0, 0);
    inertia.step(1, 1, 0);
    expect(Number.isFinite(inertia.accelX)).toBe(true);
  });
});
