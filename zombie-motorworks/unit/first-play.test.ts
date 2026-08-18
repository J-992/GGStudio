/**
 * Guards on the First Play experience: the demo rig a brand-new save's first
 * wave is driven on, the coach's reveal rule, and the authored roster that
 * wave fields.
 *
 * Deliberately structural. Whether the lesson *lands* — whether five cards is
 * four too many, whether the rig reads as fast — is verified by playing it. What
 * is asserted here is the stuff that would break silently: a rig that stops
 * validating, a HUD readout that stops being hidden, a card that promises a
 * reveal no step delivers, and an override that leaks into the wave curve.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BUILD_IDS,
  BUILDS,
  buildFirstPlayBlueprint,
  buildStarterRig,
  firstPlayRig,
} from '../src/core/builds.ts';
import {
  FIRST_PLAY_ABILITY_KEY_TOKEN,
  FIRST_PLAY_HUD_TRIGGERS,
  FIRST_PLAY_STEPS,
  firstPlayHudPiecesFor,
  releasesStep,
} from '../src/core/firstPlay.ts';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';
import { analyzeVehicle } from '../src/core/analysis.ts';
import {
  FIRST_PLAY_WAVE_COMPOSITION,
  WaveManager,
  compositionTotal,
  spawnOrderForComposition,
  zombieCompositionForWave,
} from '../src/survival/WaveManager.ts';
import { SurvivalMode } from '../src/survival/SurvivalMode.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';

describe('first play rig', () => {
  it('is a valid, drivable vehicle', () => {
    const rig = buildFirstPlayBlueprint();
    expect(validateBlueprint(rig, getPartDef).errors).toEqual([]);
  });

  it('could be assembled block by block in the garage', () => {
    // `validateBlueprint` checks overlap and connectivity but not clearance,
    // which is the rule the two 2x2 pads and the turrets are most likely to
    // break. Re-placing each block onto the rest of the rig covers it.
    const rig = buildFirstPlayBlueprint();
    for (const part of rig.parts) {
      const rest = {
        ...rig,
        parts: rig.parts.filter((other) => other.id !== part.id),
      };
      const result = canPlacePart(
        rest,
        getPartDef,
        part.defId,
        part.pos,
        part.orient,
        part.config,
      );
      expect(
        result.ok,
        `${part.defId} at ${JSON.stringify(part.pos)}: ${result.issues
          .map((issue) => issue.code)
          .join()}`,
      ).toBe(true);
    }
  });

  it('carries everything the coach teaches with', () => {
    const counts = new Map<string, number>();
    for (const part of firstPlayRig()) {
      counts.set(part.defId, (counts.get(part.defId) ?? 0) + 1);
    }
    // The click weapon, the ability, and the three guns that work the horde
    // on their own while the player is reading.
    expect(counts.get('pyre-core')).toBe(1);
    expect(counts.get('shield-generator')).toBe(1);
    expect(counts.get('cannon-heavy')).toBe(1);
    expect(counts.get('turret')).toBe(2);
    expect(counts.get('sawblade')).toBe(1);
  });

  it('binds both abilities to boxes the coach can name', () => {
    const bound = firstPlayRig().filter(
      (part) => getPartDef(part.defId).ability !== undefined,
    );
    expect(bound.length).toBe(2);
    // Pinned rather than left to the loadout resolver, because the card quotes
    // a key out loud. Distinct boxes, both inside the bar.
    const slots = bound.map((part) => part.config.abilitySlot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) expect(slot).toBeGreaterThanOrEqual(0);
  });

  it('pulls harder than any rig the player could have picked instead', () => {
    // The whole point of the six engines, and the thing the owner asked for.
    // Power-to-weight rather than top speed: the rig is heavy by construction —
    // a Heavy Cannon and a blade are most of a tonne — so what has to stay true
    // is that it out-pulls every Build, not that it out-runs the lightest one.
    const first = analyzeVehicle(buildFirstPlayBlueprint(), getPartDef);
    for (const buildId of BUILD_IDS) {
      const build = analyzeVehicle(buildStarterRig(buildId), getPartDef);
      expect(
        first.powerToWeightKwPerT,
        `first play vs ${BUILDS[buildId].name}`,
      ).toBeGreaterThan(build.powerToWeightKwPerT);
    }
    // Enough fuel that no first wave can ever end in a dry tank.
    expect(first.fuelCapacityL).toBeGreaterThan(150);
  });

  it('hands back fresh part objects on every call', () => {
    const first = firstPlayRig();
    const second = firstPlayRig();
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).toEqual(second[0]);
  });
});

describe('first play coach steps', () => {
  it('is three input lessons and nothing else', () => {
    // Every step earns its time-stop by teaching a hand something. The two
    // read-only HUD cards this used to end on are event reveals now.
    expect(FIRST_PLAY_STEPS.map((step) => step.release)).toEqual([
      'drive',
      'fire',
      'ability',
    ]);
  });

  it('hangs every readout off an arena event, bar the ones it never shows', () => {
    expect(FIRST_PLAY_HUD_TRIGGERS.health).toBe('damaged');
    expect(FIRST_PLAY_HUD_TRIGGERS.waveTimeline).toBe('kill');
    expect(FIRST_PLAY_HUD_TRIGGERS.cash).toBe('kill');
    // The minimap is a wave-two tool; the first wave never puts it up.
    expect(FIRST_PLAY_HUD_TRIGGERS.minimap).toBeNull();
  });

  it('uncovers the wallet and the wave strip together on the first kill', () => {
    expect(firstPlayHudPiecesFor('kill').sort()).toEqual([
      'cash',
      'waveTimeline',
    ]);
    expect(firstPlayHudPiecesFor('damaged')).toEqual(['health']);
    expect(firstPlayHudPiecesFor('lowFuel')).toEqual(['fuel']);
    expect(firstPlayHudPiecesFor('ramSpeed')).toEqual(['speed']);
  });

  it('only quotes an ability key on the step that teaches one', () => {
    for (const step of FIRST_PLAY_STEPS) {
      const copy = `${step.text}${step.touchText}${step.hint}${step.touchHint}`;
      const quotesKey = copy.includes(FIRST_PLAY_ABILITY_KEY_TOKEN);
      // The token is substituted at paint time; a step that carries it without
      // teaching the ability would print a placeholder at the player.
      expect(quotesKey).toBe(step.release === 'ability');
    }
  });

  it('releases a card only on the input it is teaching', () => {
    for (const step of FIRST_PLAY_STEPS) {
      for (const input of ['drive', 'fire', 'ability', 'other'] as const) {
        expect(releasesStep(step, input)).toBe(step.release === input);
      }
    }
  });
});

/**
 * The one behaviour the owner asked for by name: the tutorial wave has no
 * "keep playing" exit. Driven against a stand-in for the mode rather than a
 * real one, in the style of `pending-rewards.test.ts` — building a live
 * `SurvivalMode` needs Rapier, a renderer and a DOM, and none of the three say
 * anything about this rule.
 */
describe('first play wave exit', () => {
  // `window` is the browser handle the celebration schedules its fireworks on,
  // and there is no DOM here. Timers are dropped rather than run: what they do
  // is decoration, and what this suite is measuring is the exit.
  const previousWindow = (globalThis as { window?: unknown }).window;
  beforeAll(() => {
    (globalThis as { window?: unknown }).window = { setTimeout: () => 0 };
  });
  afterAll(() => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  });

  interface ClearHarness {
    phase: string;
    pendingTransition: null;
    firstPlay: { finish(): void };
    firstPlayVictory: {
      visible: boolean;
      shown: number;
      hidden: number;
      show(): void;
      hide(): void;
    };
    vehicle: {
      isDestroyed(): boolean;
      survivingPartIds(): string[];
      partHpSnapshot(): Record<string, number>;
    };
    callbacks: { onBuildPhase(...args: unknown[]): void };
    kills: number;
    waveStartKills: number;
    waveMoneyEarned: number;
    waveElapsedSeconds: number;
    runScore: number;
    runElapsedSeconds: number;
    currentWave: number;
    disposed: boolean;
    queueCompletedStepTransition(): void;
    leaveFirstPlayWave(): void;
  }

  function createHarness(): {
    mode: ClearHarness;
    buildPhaseCalls: unknown[][];
  } {
    const buildPhaseCalls: unknown[][] = [];
    const victory = {
      visible: false,
      shown: 0,
      hidden: 0,
      show(): void {
        victory.shown += 1;
        victory.visible = true;
      },
      hide(): void {
        victory.hidden += 1;
        victory.visible = false;
      },
    };
    const mode = Object.create(SurvivalMode.prototype) as ClearHarness;
    Object.assign(mode, {
      phase: 'cleared',
      pendingTransition: null,
      firstPlay: { finish: () => undefined },
      firstPlayVictory: victory,
      vehicle: {
        isDestroyed: () => false,
        survivingPartIds: () => ['p1'],
        partHpSnapshot: () => ({ p1: 100 }),
        body: { translation: () => ({ x: 0, y: 1, z: 0 }) },
      },
      callbacks: {
        onBuildPhase: (...args: unknown[]) => buildPhaseCalls.push(args),
      },
      kills: 12,
      waveStartKills: 0,
      waveMoneyEarned: 240,
      waveElapsedSeconds: 63,
      runScore: 0,
      runElapsedSeconds: 63,
      currentWave: 1,
      // The celebration's fireworks are queued and then dropped on the way out
      // by this flag, so the harness needs no VFX pool behind them.
      disposed: true,
      // Everything `queueCompletedStepTransition` touches ahead of the branch
      // under test.
      bankPendingWaveRewards: () => undefined,
      stopVehicleMotion: () => undefined,
      showVictory: () => {
        throw new Error('the tutorial wave must not show the payout card');
      },
      queueGameOver: () => undefined,
      mobileHud: { setCompact: () => undefined },
      vfx: { shellBurst: () => undefined },
    });
    return { mode, buildPhaseCalls };
  }

  it('celebrates instead of showing the payout card', () => {
    const { mode, buildPhaseCalls } = createHarness();
    mode.queueCompletedStepTransition();
    expect(mode.firstPlayVictory.shown).toBe(1);
    // The garage is not opened yet: the player is looking at the card, and the
    // only way on is its button.
    expect(buildPhaseCalls).toEqual([]);
  });

  it('opens the garage only when the button is pressed', () => {
    const { mode, buildPhaseCalls } = createHarness();
    mode.queueCompletedStepTransition();
    mode.leaveFirstPlayWave();
    expect(mode.firstPlayVictory.hidden).toBe(1);
    expect(buildPhaseCalls.length).toBe(1);
  });

  it('does not restart the celebration if the clear resolves twice', () => {
    const { mode } = createHarness();
    mode.queueCompletedStepTransition();
    mode.queueCompletedStepTransition();
    expect(mode.firstPlayVictory.shown).toBe(1);
  });
});

describe('first play wave roster', () => {
  it("fields more bodies than the curve's wave one, throwers included", () => {
    const curve = zombieCompositionForWave(1);
    expect(compositionTotal(FIRST_PLAY_WAVE_COMPOSITION)).toBeGreaterThan(
      compositionTotal(curve),
    );
    expect(curve.thrower).toBe(0);
    expect(FIRST_PLAY_WAVE_COMPOSITION.thrower).toBeGreaterThan(0);
  });

  it('is what the director starts the wave on, and only while it is set', () => {
    const spawned: ZombieKind[] = [];
    const zombies = {
      trySpawnHorde: (kinds: readonly ZombieKind[]) => {
        spawned.push(...kinds);
        return kinds.length;
      },
      getActiveCount: () => 0,
      warmKinds: () => undefined,
      setWaveMultipliers: () => undefined,
      setBossEncounter: () => undefined,
      activeBoss: () => null,
    };
    const waves = new WaveManager(
      zombies as unknown as ConstructorParameters<typeof WaveManager>[0],
      { onRemainingChanged: () => undefined, onWaveComplete: () => undefined },
    );

    waves.setCompositionOverride(FIRST_PLAY_WAVE_COMPOSITION);
    waves.startWave(1);
    expect(waves.totalCount).toBe(
      compositionTotal(FIRST_PLAY_WAVE_COMPOSITION),
    );

    // Cleared, the director goes straight back to the curve — which is also
    // what proves the override never touched `zombieCompositionForWave`, since
    // that is the only thing the second call can be reading.
    waves.setCompositionOverride(null);
    waves.startWave(1);
    expect(waves.totalCount).toBe(
      compositionTotal(zombieCompositionForWave(1)),
    );
  });

  it('queues every body it promises, throwers spread through the walkers', () => {
    const order = spawnOrderForComposition(FIRST_PLAY_WAVE_COMPOSITION, 1);
    expect(order.length).toBe(compositionTotal(FIRST_PLAY_WAVE_COMPOSITION));
    expect(order.filter((kind) => kind === 'thrower').length).toBe(
      FIRST_PLAY_WAVE_COMPOSITION.thrower,
    );
    // Not all at the front and not all at the back: the interleave is what
    // stops the ranged squad arriving as one block.
    const throwerIndices = order.flatMap((kind, index) =>
      kind === 'thrower' ? [index] : [],
    );
    expect(throwerIndices[0]).toBeGreaterThan(0);
    expect(throwerIndices.at(-1)).toBeLessThan(order.length - 1);
  });
});
