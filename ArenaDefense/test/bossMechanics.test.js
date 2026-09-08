// Unit tests for the four `mechanic` kinds `core/bossBrain.js` implements on
// top of the original patapim-only cast/attack/walk pattern (already covered
// by `test/bossBrain.test.js`, which this file does not duplicate). Each
// `describe`-less group below targets one boss's mechanic in isolation,
// using that boss's real `config.js` def so the tests exercise the actual
// tuning, not a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { BossBrain } from '../src/core/bossBrain.js';

const SELF = { x: 0, z: 0 };

// ---------------------------------------------------------------------------
// dash (tralalero)
// ---------------------------------------------------------------------------

const TRALALERO = CONFIG.bosses.tralalero;
const DASH = TRALALERO.mechanic;

test('dash: never initiates within minRange, however long the cooldown runs', () => {
  const brain = new BossBrain(TRALALERO, CONFIG);
  const closeTarget = { x: DASH.minRange - 1, z: 0, dist: DASH.minRange - 1 };
  for (let i = 0; i < 20; i++) {
    const r = brain.update(DASH.everyS, { self: SELF, target: closeTarget, addsAlive: 0, time: 0 });
    assert.notEqual(r.action, 'dash');
  }
});

test('dash: fires the instant range opens up past minRange once off cooldown, even mid-tick', () => {
  const brain = new BossBrain(TRALALERO, CONFIG);
  const closeTarget = { x: DASH.minRange - 1, z: 0, dist: DASH.minRange - 1 };
  // Burn the cooldown down to 0 while still too close — no dash yet.
  let r = brain.update(DASH.everyS, { self: SELF, target: closeTarget, addsAlive: 0, time: 0 });
  assert.notEqual(r.action, 'dash');
  assert.equal(brain.dashCooldown, 0, 'cooldown should sit at 0, not have been reset, while range is denied');

  // Range opens up: the very next tick starts the windup, not a further wait.
  const farTarget = { x: DASH.minRange + 1, z: 0, dist: DASH.minRange + 1 };
  r = brain.update(0.01, { self: SELF, target: farTarget, addsAlive: 0, time: 0 });
  assert.equal(r.action, 'dash');
  assert.equal(r.dash.phase, 'windup');
  assert.equal(r.dash.progress, 0);
});

test('dash: windup holds position (moveDir null), locks its direction at windup start, and does not re-aim if the target moves', () => {
  const brain = new BossBrain(TRALALERO, CONFIG);
  // Cooldown starts at a full `everyS` (same "walk in for a beat before the
  // first cast" convention as the cast cadence) — burn it down to exactly 0
  // first via a too-close target (so it can't accidentally start the dash
  // early), then switch to the real target for the tick that starts it.
  const tooClose = { x: DASH.minRange - 1, z: 0, dist: DASH.minRange - 1 };
  brain.update(DASH.everyS, { self: SELF, target: tooClose, addsAlive: 0, time: 0 });
  const startTarget = { x: DASH.minRange + 1, z: 0, dist: DASH.minRange + 1 };
  let r = brain.update(0.01, { self: SELF, target: startTarget, addsAlive: 0, time: 0 });
  assert.equal(r.dash.phase, 'windup');
  assert.ok(Math.abs(r.dash.dir.x - 1) < 1e-9 && Math.abs(r.dash.dir.z) < 1e-9, 'locked direction should point at the target as of windup start');

  // Target jumps sideways mid-windup — the boss must not move (moveDir null)
  // and the locked direction must not follow it.
  const movedTarget = { x: 0, z: DASH.minRange + 1, dist: DASH.minRange + 1 };
  const STEP = DASH.windupS / 4;
  for (let i = 0; i < 3; i++) {
    r = brain.update(STEP, { self: SELF, target: movedTarget, addsAlive: 0, time: 0 });
    assert.equal(r.action, 'dash');
    assert.equal(r.moveDir, null, 'boss must not move during windup');
    assert.ok(Math.abs(r.dash.dir.x - 1) < 1e-9 && Math.abs(r.dash.dir.z) < 1e-9, 'direction must stay locked through the whole windup');
  }
});

test('dash: windup lasts windupS, then charges for durationS along the locked direction, then returns to idle/walk', () => {
  const brain = new BossBrain(TRALALERO, CONFIG);
  const target = { x: DASH.minRange + 1, z: 0, dist: DASH.minRange + 1 };
  const STEP = 0.02;

  // Burn the cooldown to exactly 0 (see the windup test above for why), then
  // actually start the windup.
  const tooClose = { x: DASH.minRange - 1, z: 0, dist: DASH.minRange - 1 };
  brain.update(DASH.everyS, { self: SELF, target: tooClose, addsAlive: 0, time: 0 });
  let started = brain.update(0, { self: SELF, target, addsAlive: 0, time: 0 });
  assert.equal(started.dash.phase, 'windup');
  assert.equal(started.dash.progress, 0);

  let elapsed = 0;
  let sawCharging = false;
  let chargeTicks = 0;
  // Windup: advance in small steps up to just past windupS, asserting the
  // phase never flips to 'charging' before the full windup has elapsed.
  while (elapsed < DASH.windupS - STEP) {
    const r = brain.update(STEP, { self: SELF, target, addsAlive: 0, time: 0 });
    assert.equal(r.dash.phase, 'windup');
    elapsed += STEP;
  }
  // Cross the threshold.
  let r = brain.update(STEP * 2, { self: SELF, target, addsAlive: 0, time: 0 });
  elapsed += STEP * 2;

  // From here on, drive until the charge completes (durationS worth of
  // 'charging' ticks), then confirm it hands back to the normal state
  // machine (walk, since the target is still farther than melee range).
  let chargeElapsed = 0;
  while (chargeElapsed < DASH.durationS + STEP) {
    r = brain.update(STEP, { self: SELF, target, addsAlive: 0, time: 0 });
    if (r.action === 'dash' && r.dash.phase === 'charging') {
      sawCharging = true;
      chargeTicks++;
      assert.ok(Math.abs(r.moveDir.x - 1) < 1e-9 && Math.abs(r.moveDir.z) < 1e-9, 'charge direction must match the locked windup direction');
    }
    chargeElapsed += STEP;
  }
  assert.ok(sawCharging, 'expected the dash to reach the charging phase');
  assert.ok(chargeTicks >= 1);
  assert.notEqual(r.action, 'dash', 'the dash must end and hand back to the normal state machine');
});

test('dash: cooldown resets to a full everyS the instant a dash starts (start-to-start, not end-to-start)', () => {
  const brain = new BossBrain(TRALALERO, CONFIG);
  const tooClose = { x: DASH.minRange - 1, z: 0, dist: DASH.minRange - 1 };
  brain.update(DASH.everyS, { self: SELF, target: tooClose, addsAlive: 0, time: 0 });

  const target = { x: DASH.minRange + 1, z: 0, dist: DASH.minRange + 1 };
  const r = brain.update(0.01, { self: SELF, target, addsAlive: 0, time: 0 });
  assert.equal(r.action, 'dash');
  // Reset to the full interval right when the windup starts, not
  // `everyS` minus whatever fraction of this tick's `dt` the start consumed
  // — the next eligible attempt is `everyS` after this one *started*,
  // independent of how long the windup + charge that follows takes.
  assert.equal(brain.dashCooldown, DASH.everyS);
});

// ---------------------------------------------------------------------------
// phases (assassino)
// ---------------------------------------------------------------------------

const ASSASSINO = CONFIG.bosses.assassino;
const PHASES = ASSASSINO.mechanic.phases;
const FAR_TARGET = { x: 1000, z: 0, dist: 1000 };

test('phases: reports the base phase (index 0) at full HP', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  const r = brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: 1 });
  assert.equal(brain.phaseIndex, 0);
  assert.equal(r.speedMul, PHASES[0].speedMul);
  assert.equal(r.enraged, false);
});

test('phases: latches forward exactly at each belowHpFrac threshold', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  // Just above the phase-1 threshold: still phase 0.
  brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: PHASES[1].belowHpFrac + 0.01 });
  assert.equal(brain.phaseIndex, 0);

  // Exactly at (and below) it: phase 1.
  const r = brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: PHASES[1].belowHpFrac });
  assert.equal(brain.phaseIndex, 1);
  assert.equal(r.speedMul, PHASES[1].speedMul);
  assert.equal(r.enraged, false, 'phase 1 does not set enrage');
});

test('phases: never reverts even if hpFrac goes back up (a "heal")', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: PHASES[2].belowHpFrac });
  assert.equal(brain.phaseIndex, 2);

  const r = brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: 1 });
  assert.equal(brain.phaseIndex, 2, 'phase index must not drop back down');
  assert.equal(r.enraged, true, 'phase 2 stays latched (and enraged) even though hpFrac reported back at 1');
});

test('phases: a single big hit crossing two thresholds at once lands on the highest, not the first crossed', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  const r = brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: 0.1 });
  assert.equal(brain.phaseIndex, 2);
  assert.equal(r.enraged, true);
});

test('phases: adds are gated by the current phase — no cast at full HP, casts once phase 1 turns adds on', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  const ctx0 = { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: 1 };
  // Run well past the cast cadence at full HP (phase 0, adds off): never casts.
  for (let i = 0; i < 5; i++) {
    const r = brain.update(ASSASSINO.addEveryS, ctx0);
    assert.notEqual(r.action, 'cast');
  }

  // Drop into phase 1 (adds on): the very next eligible tick casts.
  const ctx1 = { self: SELF, target: FAR_TARGET, addsAlive: 0, time: 0, hpFrac: PHASES[1].belowHpFrac };
  const r = brain.update(0.01, ctx1);
  assert.equal(r.action, 'cast');
});

test('phases: cooldownMul shortens the attack cooldown once latched', () => {
  const brain = new BossBrain(ASSASSINO, CONFIG);
  const inRange = { x: 1, z: 0, dist: 1 };
  // Latch phase 2 (cooldownMul below 1) before attacking.
  brain.update(0.016, { self: SELF, target: FAR_TARGET, addsAlive: ASSASSINO.maxAdds, time: 0, hpFrac: PHASES[2].belowHpFrac });

  const ctx = { self: SELF, target: inRange, addsAlive: ASSASSINO.maxAdds, time: 0, hpFrac: PHASES[2].belowHpFrac };
  const r = brain.update(0.016, ctx);
  assert.equal(r.action, 'attack');
  assert.ok(Math.abs(brain.attackCooldown - ASSASSINO.cooldown * PHASES[2].cooldownMul) < 1e-9);
});

// ---------------------------------------------------------------------------
// groundDenial (bombardiro)
// ---------------------------------------------------------------------------

const BOMBARDIRO = CONFIG.bosses.bombardiro;
const DENIAL = BOMBARDIRO.mechanic;

test('groundDenial: places a zone on cadence, never before it, and never above maxZones', () => {
  const brain = new BossBrain(BOMBARDIRO, CONFIG);
  const target = { x: 30, z: 0, dist: 30 }; // outside range/keepDistance so attack/walk never interfere.
  const STEP = 0.25;
  let elapsed = 0;
  let placements = 0;
  while (elapsed < DENIAL.everyS + STEP) {
    const r = brain.update(STEP, { self: SELF, target, addsAlive: 0, time: elapsed, activeZones: 0 });
    if (r.groundZone) placements++;
    elapsed += STEP;
  }
  assert.equal(placements, 1, 'exactly one placement per everyS window when a slot is always free');

  // At the cap: no further placements however long it runs.
  const brainCapped = new BossBrain(BOMBARDIRO, CONFIG);
  for (let i = 0; i < 10; i++) {
    const r = brainCapped.update(DENIAL.everyS, { self: SELF, target, addsAlive: 0, time: 0, activeZones: DENIAL.maxZones });
    assert.equal(r.groundZone, null);
  }
});

test('groundDenial: leads a moving target in its direction of travel, not onto its current position', () => {
  const brain = new BossBrain(BOMBARDIRO, CONFIG);
  const STEP = 0.1;
  // Target walking steadily in +x. Feed a few ticks below the cadence so
  // `_prevTargetX/Z` has a real velocity estimate before the placement tick.
  let tx = 0;
  let elapsed = 0;
  let zone = null;
  while (elapsed < DENIAL.everyS + STEP) {
    tx += 5 * STEP; // 5 m/s in +x
    const r = brain.update(STEP, { self: SELF, target: { x: tx, z: 0, dist: tx }, addsAlive: 0, time: elapsed, activeZones: 0 });
    if (r.groundZone) zone = r.groundZone;
    elapsed += STEP;
  }
  assert.ok(zone, 'expected a placement within one cadence window');
  assert.ok(zone.x > tx, 'zone should land ahead of (not on) the moving target, in its direction of travel');
});

test('groundDenial: a stationary target still gets a zone offset away from its exact position', () => {
  const brain = new BossBrain(BOMBARDIRO, CONFIG);
  const target = { x: 10, z: 0, dist: 10 };
  let zone = null;
  const STEP = 0.25;
  let elapsed = 0;
  while (elapsed < DENIAL.everyS + STEP) {
    const r = brain.update(STEP, { self: SELF, target, addsAlive: 0, time: elapsed, activeZones: 0 });
    if (r.groundZone) zone = r.groundZone;
    elapsed += STEP;
  }
  assert.ok(zone);
  const offset = Math.hypot(zone.x - target.x, zone.z - target.z);
  assert.ok(offset > 0.5, `zone must not land exactly on a stationary target's position (offset was ${offset})`);
});

// ---------------------------------------------------------------------------
// ranged standoff steering (bombardiro's `kind: 'ranged'` + `keepDistance`)
// ---------------------------------------------------------------------------

/**
 * Steering only shows up on a 'walk' tick, and attack takes priority
 * whenever the target is in range and off cooldown (every one of these
 * targets is within bombardiro's 20m range) — so each case below fires one
 * attack first to put the attack cooldown in the way, then reads the
 * steering off the very next tick.
 * @param {{x:number,z:number,dist:number}} target
 * @returns {{x:number,z:number}}
 */
function steerAfterOneAttack(target) {
  const brain = new BossBrain(BOMBARDIRO, CONFIG);
  const ctx = { self: SELF, target, addsAlive: 0, time: 0, activeZones: DENIAL.maxZones };
  const attacked = brain.update(0.001, ctx);
  assert.equal(attacked.action, 'attack');
  const r = brain.update(0.001, ctx);
  assert.equal(r.action, 'walk');
  return r.moveDir;
}

test('ranged: approaches at full speed fraction well beyond keepDistance, backs off well within it, and eases near it', () => {
  // Beyond firing range entirely (unlike the other two cases below): attack
  // can never gate this one, so no priming needed — it's a 'walk' tick from
  // the very first update.
  const brain = new BossBrain(BOMBARDIRO, CONFIG);
  const far = { x: BOMBARDIRO.range + 12, z: 0, dist: BOMBARDIRO.range + 12 };
  const farResult = brain.update(0.016, { self: SELF, target: far, addsAlive: 0, time: 0, activeZones: DENIAL.maxZones });
  assert.equal(farResult.action, 'walk');
  assert.ok(farResult.moveDir.x > 0.99, 'far beyond keepDistance should approach at (near) full speed');

  const tooClose = { x: 1, z: 0, dist: 1 };
  assert.ok(steerAfterOneAttack(tooClose).x < -0.99, 'well inside keepDistance should back off at (near) full speed');

  const atIdeal = { x: BOMBARDIRO.keepDistance, z: 0, dist: BOMBARDIRO.keepDistance };
  assert.ok(Math.abs(steerAfterOneAttack(atIdeal).x) < 1e-9, 'exactly at keepDistance should neither approach nor retreat');
});
