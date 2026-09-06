// Wires `Turrets` + `BuildOverlay` into a live `Game` instance: registers the
// turret system, opens/closes the overlay on the `build` state's
// enter/exit, keeps its countdown/energy readouts current, and routes its
// callbacks into `Turrets` + the run's `Economy`. Self-contained by design —
// see the P4 work-package brief: the orchestrator adds a single
// `installBuildPhase(game, { turrets, overlay, audio, hud, cfg })` call once
// this file, `Turrets.js` and `BuildOverlay.js` are all wired together
// (`Game.js` itself is P2/P3-owned and never imports this module).
import { Economy } from '../core/economy.js';
import { upgradeCost, repairCost } from '../core/turretLogic.js';

const REFRESH_INTERVAL_MS = 250;

/**
 * @param {import('./Game.js').Game} game
 * @param {object} deps
 * @param {import('./Turrets.js').Turrets} deps.turrets
 * @param {import('../ui/BuildOverlay.js').BuildOverlay} deps.overlay
 * @param {import('../platform/audio.js').Audio} deps.audio
 * @param {import('../ui/Hud.js').Hud} deps.hud
 * @param {import('../core/types.js').GameConfig} deps.cfg
 */
export function installBuildPhase(game, { turrets, overlay, audio, hud, cfg }) {
  // Makes the turret system visible to `Game#getSnapshot()` (-> the overlay)
  // and to `Enemies` (targeting/damage), and puts it on the fixed-step loop.
  game.world.turrets = turrets;
  game.registerSystem('turrets', turrets);

  // `Game` exposes a live `economy` getter onto its own internal `Economy`
  // instance (the same one HUD sync and the keyboard-Ready path already use)
  // — this file must read `game.economy` fresh every time rather than
  // caching the object, since `Game#_startRun()` replaces the instance on
  // every new run. The `??=` is only a fallback for standalone use before
  // that getter exists (or during isolated testing of this module) — it
  // never overwrites a real instance, since `??=`'s assignment side only
  // runs when the left-hand read is nullish.
  game.economy ??= new Economy(cfg);

  let latestSecondsLeft = cfg.build.durationS;
  /** @type {ReturnType<typeof setInterval>|null} */
  let refreshTimer = null;

  const economy = () => game.economy;

  function refresh() {
    overlay.refresh(game.getSnapshot());
  }

  function startRefreshLoop() {
    stopRefreshLoop();
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  }

  function stopRefreshLoop() {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function openOverlay() {
    latestSecondsLeft = cfg.build.durationS;
    hud.show(false);
    overlay.open(game.getSnapshot());
    overlay.setCountdown(latestSecondsLeft);
    overlay.setEnergy(economy().energy);
    startRefreshLoop();
  }

  function closeOverlay() {
    stopRefreshLoop();
    overlay.close();
    hud.show(true);
    // Wrecks are shown (as a destroyed "X") for the whole build phase that
    // follows their destruction, then cleared here on the way out so the
    // slot is free again starting the *next* build phase — see the
    // `TurretRecord.alive` doc comment in `core/types.js`.
    for (const rec of turrets.list()) {
      if (!rec.alive) turrets.clearWreck(rec.slotId);
    }
  }

  /** Ends the build phase through the exact transition `Game`'s own
   * countdown-expiry path uses, so the overlay's Ready button (which touch
   * players must use — `InputFrame.ready` is keyboard-only in P2/P3) and a
   * keyboard player's own Space/Enter both land in the same place. */
  function endBuildPhase() {
    if (game.state.state !== 'build') return;
    hud.setBuildCountdown(null);
    game.state.go('wave');
    game.bus.emit('state:changed', { state: 'wave' });
  }

  function deny() {
    audio.play('ui-deny');
  }

  game.state.onEnter('build', openOverlay);
  game.state.onExit('build', closeOverlay);

  game.bus.on('build:tick', ({ secondsLeft }) => {
    latestSecondsLeft = secondsLeft;
    overlay.setCountdown(secondsLeft);
  });

  overlay.onPlace = (slotId, type) => {
    if (game.state.state !== 'build') return;
    const typeDef = cfg.turrets.types[type];
    if (!typeDef) return;
    if (!economy().canAfford(typeDef.cost)) {
      deny();
      return;
    }
    try {
      turrets.place(slotId, type);
    } catch {
      deny();
      return;
    }
    economy().spend(typeDef.cost);
    hud.setEnergy(economy().energy);
    audio.play('ui-place');
    refresh();
  };

  overlay.onUpgrade = (slotId) => {
    if (game.state.state !== 'build') return;
    const rec = turrets.get(slotId);
    if (!rec || !rec.alive) return;
    const cost = upgradeCost(rec.type, rec.level, cfg);
    if (cost === undefined || !economy().canAfford(cost)) {
      deny();
      return;
    }
    turrets.upgrade(slotId);
    economy().spend(cost);
    hud.setEnergy(economy().energy);
    audio.play('upgrade-confirm');
    refresh();
  };

  overlay.onRepair = (slotId) => {
    if (game.state.state !== 'build') return;
    const rec = turrets.get(slotId);
    if (!rec || !rec.alive) return;
    const cost = repairCost(rec, cfg);
    if (cost === 0) return; // already full — overlay shows "OK", nothing to spend.
    if (!economy().canAfford(cost)) {
      deny();
      return;
    }
    turrets.repair(slotId);
    economy().spend(cost);
    hud.setEnergy(economy().energy);
    audio.play('upgrade-confirm');
    refresh();
  };

  overlay.onReady = () => {
    if (game.state.state !== 'build') return;
    const refund = economy().readyRefund(latestSecondsLeft, cfg);
    economy().addEnergy(refund);
    hud.setEnergy(economy().energy);
    if (refund > 0) hud.toast(`+${refund} energy`);
    endBuildPhase();
  };

  // Covers `installBuildPhase` running after the game has already entered
  // `build` synchronously inside `Game`'s constructor (the `?wave=N` dev
  // param starts a run immediately) — the state machine's own `onEnter`
  // fired before this file had a chance to subscribe to it.
  if (game.state.state === 'build') openOverlay();
}
