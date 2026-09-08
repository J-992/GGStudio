// Wires `Boss` into a live `Game` instance: registers the boss system,
// spawns it when a boss wave starts, keeps the HUD boss-hp bar current, and
// resets it on a fresh run. Self-contained by design — see the P5 work-
// package brief: the orchestrator adds a single `installBoss(game, { boss,
// hud, audio, cfg })` call once this file and `Boss.js` exist, mirroring
// `game/buildPhase.js#installBuildPhase`'s pattern for P4.
//
// P5 shipped this file with its own `player:fired` listener that
// independently hit-tested the boss, since `Game.js`'s own hitscan
// (`_handleFiring`) at the time only tested `world.enemies` and P5 wasn't
// allowed to edit `Game.js` (see `docs/INTERFACES.md`'s P5 "Player firing"
// compromise note, kept there for the historical record). P7 implemented
// the better fix that note called for: `_handleFiring` now calls
// `world.boss?.hitTest(...)` itself, alongside `world.enemies.raycast`, and
// damages only the nearer of the two hits — so this file no longer listens
// to `player:fired` at all; a second, independent boss hit-test here would
// double-count a shot that also happened to hit the boss.
export function installBoss(game, { boss, hud, audio, cfg }) {
  // Makes the boss visible to `Game`'s own wave-clear check
  // (`!world.boss?.alive`), to `Game#getSnapshot()`, and puts it on the
  // fixed-step loop. `boss.alive` starts `false` (nothing spawned yet), so
  // every non-boss wave's clear condition is unaffected.
  game.world.boss = boss;
  game.registerSystem('boss', boss);

  // Boss HP bar: a tiny second system (registered right after `boss`, so it
  // always reads this step's freshly updated `hp`) rather than a bus
  // listener — there's no per-step "boss hp changed" event, and this needs
  // to run every fixed step regardless of whether hp changed, including the
  // frame it drops to 0 (which flips `hud.setBossHp` to `null`).
  game.registerSystem('bossHud', {
    update(_dt, world) {
      hud.setBossHp(world.boss?.alive ? world.boss.hp / world.boss.hpMax : null);
    },
  });

  game.bus.on('wave:started', ({ boss: bossName }) => {
    if (!bossName) return;
    // `wave:started`'s payload already carries the wave def's resolved
    // `boss` string (`Game.js`'s `_startWave()`: `def.boss ?? null`) — no
    // need to re-look up `waveDef(cfg, game.wave)` ourselves. Pass it on:
    // `Boss#spawn`'s second argument defaults to `'patapim'`, so dropping it
    // here would put patapim in all five boss waves.
    const gateId = game.activeGates[0] ?? 0;
    boss.spawn(gateId, bossName);
    audio.play('boss-alert');
  });

  // A previous run's boss can still be `alive` when a fresh run begins
  // (e.g. the player died mid-fight without killing it — `Game.js`'s death
  // path only checks the player's hp, not the boss's) — reset it exactly
  // when a genuinely new run starts. `GameStateMachine`'s `go()` fires the
  // outgoing state's exit hook immediately before the incoming state's
  // enter hook, so tracking "did we just exit title/runEnd" and consuming
  // the flag on the very next `build` entry precisely captures the
  // `title -> build` and `runEnd -> build` edges (the state machine's own
  // two "start a fresh run" transitions — see `core/stateMachine.js`)
  // without depending on any bus event payload shape.
  let freshRunPending = false;
  game.state.onExit('title', () => {
    freshRunPending = true;
  });
  game.state.onExit('runEnd', () => {
    freshRunPending = true;
  });
  game.state.onEnter('build', () => {
    if (!freshRunPending) return;
    freshRunPending = false;
    boss.clear();
  });
}
