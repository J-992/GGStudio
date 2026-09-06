// Wires `Boss` into a live `Game` instance: registers the boss system,
// spawns it when a boss wave starts, keeps the HUD boss-hp bar current,
// resets it on a fresh run, and (since `Game.js`'s own hitscan only tests
// `world.enemies`) independently hit-tests the boss on every shot. Self-
// contained by design — see the P5 work-package brief: the orchestrator
// adds a single `installBoss(game, { boss, hud, audio, cfg })` call once
// this file and `Boss.js` exist (`Game.js` itself is P2/P3-owned and never
// imports this module), mirroring `game/buildPhase.js#installBuildPhase`'s
// pattern for P4.
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
    // need to re-look up `waveDef(cfg, game.wave)` ourselves.
    const gateId = game.activeGates[0] ?? 0;
    boss.spawn(gateId);
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

  // `Game.js`'s own hitscan (`_handleFiring`) only tests `world.enemies` —
  // it has no knowledge of `Boss.js` at all (P5 is not allowed to edit
  // `Game.js`). This independently hit-tests the boss on every shot instead.
  //
  // Known v1 compromise: `player:fired` fires AFTER `Game.js` has already
  // resolved its own enemy raycast and applied `damageAt` (see
  // `Game.js#_handleFiring`), so by the time this handler runs there is no
  // way to learn how far along the same ray an enemy hit already landed (or
  // whether one did at all) — that information was already consumed.
  // Rather than re-running a second, now-stale `world.enemies.raycast` (an
  // enemy killed by that same shot would already be freed, silently letting
  // the ray "see through" it), this does its own independent boss-only
  // cylinder test over the full `gun.range`: if the boss is within range
  // along the ray, it takes damage — even on a shot that also happened to
  // kill an enemy standing in front of it. `docs/INTERFACES.md`'s "P5
  // additions" section documents this and the better alternative for
  // whichever package next touches `Game.js`: have `_handleFiring` call
  // `world.boss?.hitTest(...)` itself and compare distances against its own
  // enemy hit before applying either.
  game.bus.on('player:fired', ({ origin, dir }) => {
    if (!boss.alive) return;
    const gun = cfg.player.gun;
    const hit = boss.hitTest(origin, dir, gun.range);
    if (!hit) return;
    boss.damage(gun.dmg, 'player');
    game.world.effects.burst(hit.point.x, hit.point.y, hit.point.z, 0xffdd88, 6);
  });
}
