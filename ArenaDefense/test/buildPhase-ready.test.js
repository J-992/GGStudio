// Guards the seam between the build phase and the wave that follows it.
//
// `buildPhase.js` used to end the build phase itself — `state.go('wave')` plus
// the energy refund, mirroring what `Game#_advanceStateMachine` does. It looked
// equivalent and was not: it skipped `Game#_startWave()`, the only thing that
// builds the spawn scheduler. So the previous wave's scheduler (already `done`)
// stayed in place, the wave-clear test fired on the first fixed step, and
// **every wave started with READY or Space spawned nothing at all** — wave 5's
// boss included.
//
// 178 tests passed while that shipped. The wave *data* was well covered
// (`waves.test.js`, `spawner.test.js`) and was never wrong; nothing covered the
// hand-off between that data and the code that consumes it. These tests do.
//
// `installBuildPhase` takes a `game`-shaped object rather than a real `Game`,
// which is what makes this testable at all: `Game` itself needs a DOM and a
// WebGL context, but the module under test only ever touches the small surface
// stubbed below.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { GameStateMachine } from '../src/core/stateMachine.js';
import { EventBus } from '../src/core/events.js';
import { Economy } from '../src/core/economy.js';
import { SpawnScheduler } from '../src/core/spawner.js';
import { waveDef, flattenSpawns } from '../src/core/waves.js';
import { installBuildPhase } from '../src/game/buildPhase.js';

/** The slice of `Game` that `installBuildPhase` actually touches. */
function stubGame() {
  const game = {
    state: new GameStateMachine('boot'),
    bus: new EventBus(),
    economy: new Economy(CONFIG),
    world: { turrets: null, player: { weaponId: CONFIG.player.defaultWeapon } },
    readyCalls: 0,
    registerSystem() {},
    getSnapshot: () => ({ energy: 0, turrets: [], slots: [] }),
    equipWeapon() {},
    requestReady() { game.readyCalls++; },
  };
  return game;
}

/** The slice of `BuildOverlay` that `installBuildPhase` assigns to or calls. */
function stubOverlay() {
  return {
    onPlace: null, onUpgrade: null, onRepair: null, onReady: null, onSelectWeapon: null,
    open() {}, close() {}, refresh() {}, setCountdown() {}, setEnergy() {},
    setSelectedType() {}, setSelectedWeapon() {},
  };
}

/**
 * Installs the real module against stubs and enters `build`.
 *
 * Entering `build` starts the overlay's `setInterval` refresh loop, which
 * keeps Node alive forever if it is never stopped — hence the `t.after`
 * teardown, which leaves `build` so the module's own `onExit` clears it.
 *
 * @param {import('node:test').TestContext} t
 */
function install(t) {
  const game = stubGame();
  const overlay = stubOverlay();
  installBuildPhase(game, {
    game,
    turrets: { update() {}, list: () => [] },
    overlay,
    audio: { play() {} },
    hud: { setEnergy() {}, toast() {}, setBuildCountdown() {}, show() {} },
    cfg: CONFIG,
  });
  game.state.go('title');
  game.state.go('build');
  t.after(() => {
    if (game.state.state === 'build') game.state.go('wave');
  });
  return { game, overlay };
}

test('READY asks Game to end the build phase instead of ending it itself', (t) => {
  const { game, overlay } = install(t);

  overlay.onReady();

  // The whole bug in one assertion: this must NOT have moved the state
  // machine. Driving `build -> wave` from here bypasses `Game#_startWave`,
  // and the wave arrives with the previous wave's spent scheduler.
  assert.equal(game.state.state, 'build', 'onReady must not transition the state itself');
  assert.equal(game.readyCalls, 1, 'onReady must delegate to game.requestReady()');
});

test('READY outside the build phase is ignored by the state machine', (t) => {
  const { game, overlay } = install(t);
  game.state.go('wave');

  overlay.onReady();

  assert.equal(game.state.state, 'wave');
});

test('the energy refund is not applied by the build phase', (t) => {
  // `Game` owns the refund now, on the single path out of `build`. If this
  // file paid it too, a READY press would pay twice.
  const { game, overlay } = install(t);
  const before = game.economy.energy;

  overlay.onReady();

  assert.equal(game.economy.energy, before, 'buildPhase must not add refund energy');
});

test('every wave 1-10 queues a scheduler that emits its full complement', () => {
  // The data -> runtime seam, built exactly the way `Game#_startWave` builds
  // it: `flattenSpawns(waveDef(...))` into a `SpawnScheduler` capped by
  // `min(maxAlive, enemies.cap)`. A wave that queues nothing is the symptom
  // the owner actually saw.
  const step = CONFIG.timing.fixedStep;

  for (let n = 1; n <= CONFIG.run.finalWave; n++) {
    const def = waveDef(CONFIG, n);
    const entries = flattenSpawns(def);
    const cap = Math.min(def.maxAlive, CONFIG.enemies.cap);
    const scheduler = new SpawnScheduler(entries, cap);

    let emitted = 0;
    let alive = 0;
    // Enemies die as fast as they arrive, so the concurrency cap never stalls
    // the run; five simulated minutes is far longer than any wave needs.
    for (let i = 0; i < 5 * 60 * 60 && !scheduler.done; i++) {
      const due = scheduler.update(step, alive);
      emitted += due.length;
    }

    assert.ok(scheduler.done, `wave ${n} scheduler never finished`);
    assert.equal(emitted, entries.length, `wave ${n} emitted ${emitted} of ${entries.length}`);

    if (def.boss) {
      assert.equal(entries.length, 0, `boss wave ${n} should queue no ordinary spawns`);
    } else {
      assert.ok(entries.length > 0, `wave ${n} queued no spawns at all`);
    }
  }
});

test('the concurrency cap holds enemies back rather than dropping them', () => {
  // `maxAlive` throttles how many are in play at once; it is not a total. This
  // is what makes "more enemies per wave" a pure data change — raise a wave's
  // counts and the extras trickle in as others die, rather than being lost.
  // Synthetic entries because no shipped wave currently exceeds its own cap.
  const entries = Array.from({ length: 50 }, (_, i) => ({ enemy: 'shambler', t: i * 0.1, gateId: 0 }));
  const cap = 10;
  const scheduler = new SpawnScheduler(entries, cap);

  // Nothing ever dies: emission must stop at the cap and stay there.
  let emitted = 0;
  for (let i = 0; i < 60 * 60; i++) emitted += scheduler.update(CONFIG.timing.fixedStep, emitted).length;
  assert.equal(emitted, cap, `held at ${emitted}, expected the ${cap} cap`);
  assert.equal(scheduler.done, false, 'the rest must stay pending, not be discarded');

  // Now let them die: every one held back must still arrive.
  for (let i = 0; i < 60 * 60 && !scheduler.done; i++) scheduler.update(CONFIG.timing.fixedStep, 0);
  assert.equal(scheduler.done, true, 'the held-back entries were never emitted');
});
