/**
 * Survival runtime: the editor blueprint vehicle, the graveyard world,
 * pooled zombie AI, wave pacing, HUD, and the existing fixed-step damage path.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  abilityMeta,
  ABILITY_KIND_META,
  ABILITY_SLOT_KEYS,
  abilityUnlocked,
  effectiveCharm,
  effectiveDroneSwarm,
  effectiveFlameLance,
  effectiveFreeze,
  effectiveHellfire,
  effectiveOverdrive,
  effectivePhase,
  effectivePulse,
  effectiveReinforce,
  effectiveRocket,
  effectiveShield,
  effectiveThump,
  effectiveZap,
  MAX_ABILITY_SLOTS,
  phaseDestination,
  resolveAbilityLoadout,
  type AbilityCandidate,
  type AbilitySlotAssignment,
} from '../core/abilities.ts';
import { effectiveSignature, type SignatureStats } from '../core/signatures.ts';
import {
  SignatureStrikes,
  clampStrikePoint,
  type StrikeImpact,
} from './SignatureStrikes.ts';
import {
  badgeAwards,
  badgeBonusTotal,
  evaluateWaveBadges,
  type WaveResultStats,
} from '../core/badges.ts';
import {
  combineEnvironments,
  hazardEnvironment,
  hazardIntensity,
  type BiomeHazardSpec,
  type EnvironmentModifiers,
} from '../core/biomes.ts';
import { repairPlan } from '../core/economy.ts';
import type { RunState } from '../core/economy.ts';
import {
  DEFAULT_GAME_MODE_ID,
  getGameMode,
  type GameModeDefinition,
} from '../core/gameModes.ts';
import {
  GAME_OVER_LEADERBOARD_ROWS,
  leaderboardRows,
  type RunOutcome,
} from '../core/leaderboard.ts';
import { getPartDef } from '../core/parts.ts';
import { addScore, killScore, waveClearScore } from '../core/score.ts';
import { deriveConnections } from '../core/structural.ts';
import { droneInterceptChance } from '../core/turretModules.ts';
import type {
  AbilityDefinition,
  PartDefinition,
  Vec3,
  VehicleBlueprint,
} from '../core/types.ts';
import { buildWaveTimeline, type WaveTimeline } from '../core/waveTimeline.ts';
import { randomSeed } from '../core/rng.ts';
import { badgeStore } from '../app/badgeStore.ts';
import {
  getMusicVolume,
  getSfxVolume,
  playDamageNumberSfx,
  playExplosionSfx,
  playImpactSfx,
  playSceneryImpactSfx,
  playSfx,
  playVehicleDamageSfx,
  playWeaponSfx,
  playZombieSfx,
  setMusicVolume,
  setSfxVolume,
  syncDriveSfx,
  stopDriveSfx,
  fadeOutDriveSfx,
  unlockAudio,
} from '../app/sfx.ts';
import type { RuntimePart } from '../runtime/assembler.ts';
import { applyWeaponAim, buildPartMesh } from '../editor/meshes.ts';
import { lowestPointM } from '../runtime/assembler.ts';
import {
  RuntimeVehicle,
  brakeInputWithAutoHold,
  type VehicleControls,
} from '../runtime/vehicle.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { createToggle } from '../ui/system.ts';
import { AbilityBar, type AbilitySlotView } from '../ui/AbilityBar.ts';
import { BuffBar, type BuffView } from '../ui/BuffBar.ts';
import {
  createAudioVolumeControl,
  type AudioVolumeControl,
} from '../ui/audioVolumeControl.ts';
import { ScopeCursor } from '../ui/ScopeCursor.ts';
import { shouldUseTouchControls, onTouchControlsChange } from '../ui/device.ts';
import { TouchControls } from '../ui/touch/TouchControls.ts';
import {
  installSurvivalMobileHud,
  type SurvivalMobileHud,
} from './MobileHud.ts';
import { driveTowardHeading } from '../core/joystick.ts';
import { buildLeaderboardTable } from '../ui/leaderboardTable.ts';
import { applySplashBackground, pickLoadingSplash } from '../ui/splashArt.ts';
import { VfxSystem } from '../vfx/VfxSystem.ts';
import { WarningHud } from './WarningHud.ts';
import { StrikeGauge } from './StrikeGauge.ts';
import { DamageNumbersOverlay } from './DamageNumbers.ts';
import { TracerRenderer, tracerStyleForWeapon } from './Tracers.ts';
import {
  activeVehicleWarnings,
  HULL_CRITICAL_PCT,
  type VehicleWarning,
} from './vehicleWarnings.ts';
import { impactKindForShot, muzzleStyleForShot } from '../vfx/shotVfx.ts';
import { Pickups, type CollectedPickup } from './Pickups.ts';
import { SentryTurrets, type SentryTarget } from './SentryTurrets.ts';
import {
  cashDropAmount,
  COLOSSUS_DAMAGE_MULTIPLIER,
  COLOSSUS_MOBILITY,
  COLOSSUS_SCALE,
  COLOSSUS_SECONDS,
  COLOSSUS_TOUGHNESS,
  FUEL_REFILL_FRACTION,
  PICKUP_KINDS,
  rollPartDrop,
  SENTRY_SECONDS,
} from './dropTable.ts';
import { AutoAim } from './AutoAim.ts';
import { FollowCamera } from './FollowCamera.ts';
import { PhaseGhosts } from './PhaseGhosts.ts';
import { ReinforceWard } from './ReinforceWard.ts';
import { DroneEscort } from './DroneEscort.ts';
import {
  chassisFootprintRadiusM,
  ORBIT_MARGIN_M,
  ThreatPointer,
  type ThreatTarget,
} from './ThreatPointer.ts';
import type { Arena } from './arena/Arena.ts';
import { ArenaBuilder } from './arena/ArenaBuilder.ts';
import { DEFAULT_BIOME_ID, getBiome } from './arena/recipes/index.ts';
import { Minimap } from './Minimap.ts';
import {
  FIRST_PLAY_WAVE_COMPOSITION,
  WaveManager,
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
  zombieCompositionForWave,
  zombieCountForWave,
} from './WaveManager.ts';
import { formatWaveComposition, newThreatsForWave } from './waveBalance.ts';
import { bossEncounterWarning, bossForWave } from './zombies/bossConfig.ts';
import { threatPreviewForWave } from './threatPreview.ts';
import { ThreatAlert, type ThreatAlertView } from './ThreatAlert.ts';
import {
  partIconUrls,
  renderPartIcons,
} from '../editor/PartIconRenderer.ts';
import { PART_CATALOG } from '../core/parts.ts';
import { SIMPLE_PART_IDS } from '../core/tutorial.ts';
import {
  WaveClearCard,
  type WaveClearCardView,
  type WaveClearRepairOffer,
} from './WaveClearCard.ts';
import { WaveTimelineHud } from './WaveTimelineHud.ts';
import { FirstPlayCoach } from './FirstPlayCoach.ts';
import { FirstPlayVictory } from './FirstPlayVictory.ts';
import type { FirstPlayInput } from '../core/firstPlay.ts';
import { ZombieSystem } from './zombies/ZombieSystem.ts';
import { isDevMode } from './devtuning/devMode.ts';
import { devTuning, subscribeTuning } from './devtuning/DevTuning.ts';
import { DevTunerPanel } from './devtuning/DevTunerPanel.ts';
import {
  BASE_ZOMBIE_STATS,
  LETHAL_IMPACT_SPEED,
  MIN_IMPACT_SPEED,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from './zombies/zombieConfig.ts';
import type { Zombie, ZombieKind } from './zombies/Zombie.ts';

const FIXED_DT = 1 / 60;
const COUNTDOWN_SECONDS = 3;
/**
 * How long the pre-wave gate waits on the arena before starting anyway.
 *
 * The gate exists so nobody fights in an empty box while props stream in, but
 * a dropped fetch must cost a player some scenery rather than the whole run —
 * `VoxelAssetLoader` already falls back to placeholders, so the arena is
 * playable either way.
 */
const ARENA_LOAD_TIMEOUT_SECONDS = 12;
/**
 * Keys `updateControls` reads as driving, for the First Play coach's benefit.
 * Kept here rather than derived from the control block below because the coach
 * only needs to know that the player *tried* to drive, not what it did.
 */
/** Firework shells thrown around the rig behind the first-wave celebration. */
const CELEBRATION_SHELLS = 7;
const DRIVE_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);
// These are shared immutable options, not per-shot literals: the firing loop
// runs at physics rate and the tracer pool must stay allocation-free.
const TRACER_OPTIONS = [
  undefined,
  { faded: true },
  { emp: true },
  { faded: true, emp: true },
  { piercing: true },
  { faded: true, piercing: true },
  { emp: true, piercing: true },
  { faded: true, emp: true, piercing: true },
  { secondary: true },
  { faded: true, secondary: true },
  { emp: true, secondary: true },
  { faded: true, emp: true, secondary: true },
  { piercing: true, secondary: true },
  { faded: true, piercing: true, secondary: true },
  { emp: true, piercing: true, secondary: true },
  { faded: true, emp: true, piercing: true, secondary: true },
] as const;
/** Radius of the Shield Generator bubble, generous enough to enclose most rigs. */
const SHIELD_BUBBLE_RADIUS_M = 3.4;
const STUCK_PROMPT_SECONDS = 1.6;
const RECOVERY_COOLDOWN_SECONDS = 2.25;
const RECOVERY_SETTLE_SECONDS = 0.42;
/**
 * How close to the arena wall a phase blink may land, m. Roughly a long rig's
 * half-length, so a blink aimed at the fence stops with the whole vehicle
 * inside rather than with its nose through the boundary.
 */
const PHASE_WALL_MARGIN_M = 4;
/**
 * Clearance the rig is dropped from at the far end of a blink, m. The trip
 * ignores everything in its way, so the landing spot may well be a boulder or a
 * wreck; arriving just above it lets the suspension settle onto the obstacle
 * instead of starting the next step wedged inside it.
 */
const PHASE_LANDING_LIFT_M = 0.45;
/** A blink shorter than this is not worth a cooldown — the wall ate the trip. */
const PHASE_MIN_TRAVEL_M = 0.75;
/** How often the alert stack is re-derived from vehicle state. */
const WARNING_REFRESH_INTERVAL_SECONDS = 0.25;
/** Distance at which a blast stops shaking the camera at all, m. */
const CAMERA_SHAKE_FALLOFF_M = 26;
/**
 * Camera kick for a melee contact, before the hit's own 0.25..1.5 force scales
 * it. Far smaller than a shell's 0.9: a blade is a tick, not an event, and only
 * the strongest contact of a step is ever spent (see `flushMeleeHit`).
 */
const MELEE_SHAKE_STRENGTH = 0.16;
/** Stand-in for "nothing to point at", so idle frames allocate nothing. */
const EMPTY_TARGETS: readonly ThreatTarget[] = [];
/**
 * Window in which back-to-back kill payouts fold into one floating chit. Kept
 * tight on purpose: a pack of kills should throw a spray of numbers, not one
 * merged total. It only catches payouts landing in the same handful of frames.
 */
const CASH_GAIN_MERGE_MS = 45;
/**
 * Row colours for the effect timers over the ability boxes. Each one is the
 * colour that effect already puts on screen — the shield's bubble, the ward's
 * hex shell, Hellfire's yellow core — so the bar names the thing the player can
 * see rather than introducing a second, unrelated code. The two crate effects
 * take their colours from the crate table for the same reason.
 */
const BUFF_COLORS = {
  overdrive: '#ffb03a',
  reinforce: '#9d8cff',
  shield: '#35d7ff',
  hellfire: '#ffe14a',
  flamelance: '#ff6b2b',
} as const;
/** How fast the drawn rig grows into (and back out of) a Colossus, per second. */
const RIG_SCALE_RATE = 4;
/** Ride height assumed while no wheel is on the ground, m. */
const NOMINAL_RIDE_HEIGHT_M = 1;

/**
 * Scuttle charge ("self-destruct", K).
 *
 * A crippled rig is normally a run that is already over: the wheel is gone, the
 * horde is closing, and there is nothing left to drive away with. The charge
 * turns that into one last decision — blow the vehicle and take the wave with
 * it. It arms the moment a wheel is lost and stays armed, because a lost wheel
 * never comes back mid-wave.
 *
 * The bargain is deliberately all-or-nothing. If the blast leaves the wave
 * empty, the wreck is towed back to the Garage and the run continues from the
 * cleared wave like any other clear. If even one zombie is left standing — or
 * the wave still has zombies queued to spawn — the run ends, exactly as losing
 * the rig to the horde would have.
 */
/**
 * What the charge is actually made of is the fuel still in the tanks, so that
 * is what sizes the blast. Running the tanks dry to reach a refuel crate now
 * costs the player their last resort, and a rig that has been hoarding fuel
 * blows a genuinely wave-clearing hole. The reach is quoted live on the prompt
 * so the trade is legible before it is taken, never discovered afterwards.
 */
const SELF_DESTRUCT_MIN_RADIUS_M = 3;
const SELF_DESTRUCT_MAX_RADIUS_M = 16;
const SELF_DESTRUCT_RADIUS_PER_LITRE_M = 0.11;
/**
 * Damage at the centre, scaled over the same fuel range. Blast damage falls off
 * linearly to nothing at the rim, so these are sized so that anything
 * meaningfully inside the ring dies rather than to be read as literal numbers —
 * a small charge is short, not weak.
 */
const SELF_DESTRUCT_MIN_DAMAGE = 400;
const SELF_DESTRUCT_MAX_DAMAGE = 1_600;
/**
 * How long the frame is held after the charge goes off, before the run resolves
 * into the Garage or the game-over card. The blast is the payoff for a run
 * ending; cutting to a menu on the same frame would throw it away.
 */
const SELF_DESTRUCT_HOLD_SECONDS = 1.6;
/** Gap between the aftershocks that cook off around the wreck during the hold. */
const SELF_DESTRUCT_AFTERSHOCK_SECONDS = 0.34;

export interface SurvivalCallbacks {
  profileMoney(): number;
  runEarnings(): number;
  /**
   * Charge `cost` for a full repair bought from the wave-clear card and
   * re-base the run checkpoint as undamaged. Returns false when the wallet
   * cannot cover it.
   */
  onRepairAll(cost: number): boolean;
  /**
   * Shelf price and count of blocks destroyed in an *earlier* wave that the
   * player has never bought back. They are absent from this mode's blueprint,
   * so only App can price them into the wave-clear card's full repair.
   */
  missingPartsQuote?(): { cost: number; count: number };
  /**
   * The full repair when it has holes to fill as well as dents. Charges
   * `cost`, commits the cleared wave, re-places every part torn off so far at
   * full HP, and redeploys into the next wave on the rebuilt rig — the live
   * vehicle cannot grow its lost blocks back, so it is replaced rather than
   * patched. The mode is disposed by that redeploy.
   */
  onFullRepairRebuild(
    cost: number,
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  onReward(amount: number): number;
  onExit(run: RunState): void;
  onWaveAdvance(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  onBuildPhase(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  /** Commit the next wave's start state as soon as a clear is resolved. */
  onWaveCheckpoint?(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  /**
   * The run is over. App records the score, wipes the garage back to a fresh
   * start, and returns where this run placed so the overlay can show it.
   * The mode stays alive until the player picks one of the two exits below.
   */
  onGameOver(
    run: RunState,
    pendingMoneyDiscarded: number,
    score: number,
    kills: number,
  ): RunOutcome;
  /** Dismiss the game-over overlay and open the freshly reset garage. */
  onGameOverContinue(): void;
  /** Dismiss the game-over overlay and return to the title screen. */
  onGameOverMenu(): void;
  onResetWave(run: RunState): void;
  /**
   * Leave the arena mid-wave and open the Garage at this wave's checkpoint.
   * The abandoned wave restarts from that checkpoint when the player deploys
   * again, so pending rewards are discarded exactly like a wave reset.
   */
  onReturnToGarage(run: RunState): void;
  onCheatInfiniteMoney(): void;
  /** Lifetime progression: a Phone Addict died, which unlocks the EMP module. */
  onPhoneAddictKilled(): void;
  /**
   * A salvage crate handed the player a free block. It goes straight into the
   * Profile's Inventory (unlocking the catalog entry if it was still locked),
   * so it is theirs to bolt on in the next Garage rather than something this
   * wave has to find room for.
   */
  onPartSalvaged?(defId: string): void;
  /** Lifetime progression: `wave` was fully cleared. */
  onWaveCleared(wave: number): void;
  /**
   * Persist the run so the player can close the tab and pick it up later.
   * Mid-wave zombie state is not restorable, so App persists its wave-start
   * checkpoint rather than this live vehicle state.
   */
  onSaveAndQuit(snapshot: { wave: number; kills: number; score: number }): void;
  /** True only while this mode is an unpaused playable encounter. */
  onGameplayActiveChanged?(active: boolean): void;
}

export interface WaveClearPayload {
  clearedRun: RunState;
  nextRun: RunState;
  survivingPartIds: readonly string[];
  partHp: Record<string, number>;
  kills: number;
  score: number;
}

/** Shared payload for both choices offered after a cleared wave. */
export function createWaveClearPayload(
  clearedWave: number,
  survivingPartIds: readonly string[],
  partHp: Readonly<Record<string, number>>,
  kills: number,
  score: number,
  elapsedSeconds = 0,
): WaveClearPayload {
  return {
    clearedRun: { wave: clearedWave, elapsedSeconds },
    nextRun: { wave: clearedWave + 1, elapsedSeconds },
    survivingPartIds: [...survivingPartIds],
    partHp: { ...partHp },
    kills,
    score,
  };
}

export type SurvivalPhase = 'countdown' | 'active' | 'cleared' | 'gameOver';

export interface SurvivalTelemetry {
  mode: 'survival';
  kills: number;
  /** Arcade run score, as shown on the HUD and submitted at game over. */
  score: number;
  phoneAddictKills: number;
  wave: number;
  zombiesAlive: number;
  money: number;
  runMoney: number;
  phase: SurvivalPhase;
  partHp: Record<string, number>;
  integrityPct: number;
  /** The live boss on a boss wave, or null on ordinary waves. */
  boss: {
    id: string;
    name: string;
    health: number;
    maxHealth: number;
  } | null;
  vehiclePos: [number, number, number];
  /** Debug-only: body rotation quaternion (collision/upright diagnostics). */
  rotation: [number, number, number, number];
  /** Debug-only: body angular velocity, rad/s (collision spin diagnostics). */
  angvel: [number, number, number];
  /** Debug-only: follow camera world position (camera bugs/regressions). */
  cameraPos: [number, number, number];
  /** Debug-only: wheels currently loaded on the ground (collision diagnostics). */
  groundedWheels: number;
  /** Whether the scuttle charge (K) has been unlocked by a lost wheel. */
  selfDestructArmed: boolean;
  weapons: {
    partId: string;
    aimMode: 'auto' | 'manual';
    shotsFired: number;
  }[];
  wheels: {
    partId: string;
    worldCentre: [number, number, number];
  }[];
}

type ZombieShotTarget = Pick<
  ZombieSystem,
  'hitZombieHandle' | 'isShieldedTarget' | 'slowZombieHandle'
>;

/** Apply one hit chain and report whether its secondary tracer may continue. */
export function applyZombieShot(
  zombies: ZombieShotTarget,
  shot: TracerShot,
  direction: Vec3,
): boolean {
  if (shot.hitZombieHandle === null) return false;
  const canSlow = shot.slowFactor > 0 && shot.slowDurationSeconds > 0;
  const primaryWasShielded = zombies.isShieldedTarget(shot.hitZombieHandle);
  const primaryResult = zombies.hitZombieHandle(
    shot.hitZombieHandle,
    shot.damage,
    direction,
    shot.damageType,
    shot.empLevel,
  );
  // Ice fire slows the struck zombie whenever the hit lands and is not fully
  // absorbed by a shield (a kill just slows nothing that is left alive).
  if (canSlow && !primaryWasShielded && primaryResult !== 'miss') {
    zombies.slowZombieHandle(
      shot.hitZombieHandle,
      shot.slowFactor,
      shot.slowDurationSeconds,
    );
  }
  if (primaryWasShielded || primaryResult === 'miss') return false;
  if (shot.pierceZombieHandle === null || shot.pierceDamage <= 0) return true;
  zombies.hitZombieHandle(
    shot.pierceZombieHandle,
    shot.pierceDamage,
    direction,
    shot.damageType,
    shot.empLevel,
  );
  if (canSlow) {
    zombies.slowZombieHandle(
      shot.pierceZombieHandle,
      shot.slowFactor,
      shot.slowDurationSeconds,
    );
  }
  return true;
}

function tracerOptionsForShot(
  shot: TracerShot,
  faded: boolean,
  secondary = false,
) {
  return TRACER_OPTIONS[
    (faded ? 1 : 0) |
      (shot.empLevel > 0 ? 2 : 0) |
      (shot.piercingLevel > 0 ? 4 : 0) |
      (secondary ? 8 : 0)
  ];
}

interface SurvivalUi {
  root: HTMLDivElement;
  speedValue: HTMLSpanElement;
  speedTrack: HTMLDivElement;
  speedSafeLabel: HTMLSpanElement;
  speedDamageLabel: HTMLSpanElement;
  speedKillLabel: HTMLSpanElement;
  integrityValue: HTMLSpanElement;
  integrityFill: HTMLSpanElement;
  /** The whole health block, so the First Play coach can keep it covered. */
  healthPanel: HTMLDivElement;
  fuelValue: HTMLSpanElement;
  fuelFill: HTMLSpanElement;
  waveTimeline: WaveTimelineHud;
  bossHud: HTMLElement;
  bossNameValue: HTMLElement;
  bossHealthTrack: HTMLDivElement;
  bossHealthFill: HTMLSpanElement;
  bossHealthValue: HTMLSpanElement;
  cashCounter: HTMLDivElement;
  cashValue: HTMLSpanElement;
  cashGains: HTMLDivElement;
  pickupToasts: HTMLDivElement;
  stuckPrompt: HTMLDivElement;
  selfDestructButton: HTMLButtonElement;
  selfDestructHint: HTMLSpanElement;
  selfDestructBanner: HTMLDivElement;
  endlessWaveBanner: HTMLDivElement;
  countdownOverlay: HTMLDivElement;
  countdownValue: HTMLDivElement;
  arenaLoadingOverlay: HTMLDivElement;
  arenaLoadingFill: HTMLDivElement;
  waveClearCard: WaveClearCard;
  gameOverOverlay: HTMLDivElement;
  gameOverBest: HTMLDivElement;
  gameOverScore: HTMLDivElement;
  gameOverWaveValue: HTMLElement;
  gameOverKillsValue: HTMLElement;
  gameOverBoard: HTMLDivElement;
  settingsOverlay: HTMLDivElement;
  settingsButton: HTMLButtonElement;
  hudGarageButton: HTMLButtonElement;
  settingsEyebrow: HTMLSpanElement;
  settingsSfxVolumeControl: AudioVolumeControl;
  settingsMusicVolumeControl: AudioVolumeControl;
  spawnCheatButton: HTMLButtonElement;
  skipWaveInput: HTMLInputElement;
  settingsStatus: HTMLDivElement;
}

type PendingTransition =
  | {
      kind: 'buildPhase';
      run: RunState;
      survivingPartIds: string[];
      partHp: Record<string, number>;
      kills: number;
      score: number;
    }
  | {
      kind: 'gameOver';
      run: RunState;
      pendingMoneyDiscarded: number;
    };

type SurvivalRunState = RunState & {
  kills?: number;
  score?: number;
  /**
   * This is a brand-new player's very first wave, so run the First Play coach
   * over it and hand them to the Garage the moment it clears. Not part of
   * `RunState` because it is a property of one deployment rather than of the
   * run: it is never persisted, and a resumed save is by definition not a
   * first wave.
   */
  firstPlay?: boolean;
};

export class SurvivalMode {
  /** The rules this run is played under; fixed for the mode's whole life. */
  private readonly mode: GameModeDefinition;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly arena: Arena;
  private readonly biomeDrive: EnvironmentModifiers;
  private readonly biomeHazard: BiomeHazardSpec;
  private biomeEnvironment: EnvironmentModifiers;
  private biomeEnvironmentWave = -1;
  private readonly vehicle: RuntimeVehicle;
  /** Pooled voxel particle layers shared by every effect in this mode. */
  private readonly vfx: VfxSystem;
  private readonly zombies: ZombieSystem;
  private readonly autoAim: AutoAim;
  private readonly pickups: Pickups;
  private readonly sentries: SentryTurrets;
  /** Size the rig is currently drawn at; eased toward the Colossus scale. */
  private rigScale = 1;
  /** Reused answer for the sentries' target query — read before the next ask. */
  private readonly sentryTarget = { x: 0, y: 0, z: 0, colliderHandle: 0 };
  private readonly waves: WaveManager;
  private readonly followCamera: FollowCamera;
  private readonly vehicleGroup = new THREE.Group();
  private readonly zombieVisualRoot = new THREE.Group();
  private readonly wheelMeshes = new Map<string, THREE.Group>();
  private readonly wheelSpin = new Map<string, number>();
  private readonly islandGroups = new Map<number, THREE.Group>();
  private readonly keys = new Set<string>();
  private readonly controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    fire: false,
    aimYawWorld: 0,
  };
  private readonly tracerRenderer: TracerRenderer;
  private readonly wheelSteerQuaternion = new THREE.Quaternion();
  private readonly wheelSteerAxis = new THREE.Vector3(0, 1, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly aimRaycaster = new THREE.Raycaster();
  /**
   * Cursor unprojection plane. Sat at zombie centre height rather than on the
   * ground: an overriding player's guns shoot at this exact point, and the
   * player aims at a zombie's body, not at the dirt behind its feet.
   */
  private readonly aimPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -(ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS),
  );
  private readonly aimPoint = new THREE.Vector3();
  private readonly shotDirection = new THREE.Vector3();
  private readonly stoppedVelocity = { x: 0, y: 0, z: 0 };
  private readonly minimapForward = new THREE.Vector3();
  private readonly audioListenerForward = new THREE.Vector3();
  private readonly terrainSfx: 'gravel' | 'sand' | 'snow';
  /** Scratch heading for ability effects that fire along the rig's forward axis. */
  private readonly abilityForward = new THREE.Vector3();
  private readonly abilityQuaternion = new THREE.Quaternion();
  /** Endpoints of the blink in flight, handed to the after-image trail. */
  private readonly phaseFrom = new THREE.Vector3();
  private readonly phaseTo = new THREE.Vector3();
  /** Live vehicle visuals the after-image trail clones; rebuilt per blink. */
  private readonly phaseSources: THREE.Object3D[] = [];
  private readonly ui: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly scopeCursor: ScopeCursor;
  /** Damage vignette plus the stacked red/amber alert chips. */
  private readonly warningHud: WarningHud;
  /** Pooled, decorative hit totals anchored where zombies were damaged. */
  private readonly damageNumbers: DamageNumbersOverlay;
  /**
   * Sum of live attached part health at the end of the previous fixed step.
   * Diffing it is how the HUD learns the vehicle was hurt, whatever the
   * source — zombie bites, thrown debris, mines, or a bad collision.
   */
  private lastLiveHealth = -1;
  /**
   * Strongest melee contact recorded during the current fixed step, and where
   * it landed. Zero means no weapon touched anything this step.
   */
  private meleeHitForce = 0;
  private meleeHitX = 0;
  private meleeHitZ = 0;
  private warningRefreshSeconds = 0;
  private lastWarnings: VehicleWarning[] = [];
  private readonly speedValue: HTMLSpanElement;
  private readonly speedTrack: HTMLDivElement;
  private readonly speedSafeLabel: HTMLSpanElement;
  private readonly speedDamageLabel: HTMLSpanElement;
  private readonly speedKillLabel: HTMLSpanElement;
  private readonly integrityValue: HTMLSpanElement;
  private readonly integrityFill: HTMLSpanElement;
  private readonly healthPanel: HTMLDivElement;
  /**
   * The first-wave coach, or null for every other deployment. Non-null is the
   * one thing that makes this mode a tutorial: it hides HUD, freezes the step,
   * and sends a clear straight to the Garage instead of the payout card.
   */
  private readonly firstPlay: FirstPlayCoach | null;
  /** The tutorial wave's celebration, built alongside its coach. */
  private readonly firstPlayVictory: FirstPlayVictory | null;
  private readonly fuelValue: HTMLSpanElement;
  private readonly fuelFill: HTMLSpanElement;
  private lastHudFuel = -1;
  /** Centre-screen bar of special abilities, one box per special. */
  private readonly abilityBar: AbilityBar;
  /**
   * The signature strike's recharge, for the touch HUD.
   *
   * Desktop reads it off the reticle, which a phone does not have; the gauge
   * is the same number over the ability row instead. It draws nothing on a
   * pointer-precise session — see `survival-mobile.css`.
   */
  private readonly strikeGauge: StrikeGauge;
  /**
   * On-screen driving controls, built only on a touch device.
   *
   * The stick is polled inside {@link updateControls} rather than pushed from
   * its own event, so a thumb held perfectly still keeps commanding throttle:
   * touch move events stop arriving the moment the finger stops, and an
   * event-driven path would read that as the player letting go.
   */
  private touch: TouchControls | null = null;
  private touchUnsubscribe: (() => void) | null = null;
  /** Held brake button; separate from the stick's brake-while-rolling arc. */
  private touchBraking = false;
  /** Camera-relative basis for the stick, rebuilt each step, allocation-free. */
  private readonly stickForward = new THREE.Vector3();
  private readonly stickRight = new THREE.Vector3();
  private readonly stickHeading = new THREE.Vector3();
  private readonly stickQuaternion = new THREE.Quaternion();
  /** Phone HUD layout: minimizable panels, thumb-clear anchoring. Inert on desktop. */
  private readonly mobileHud: SurvivalMobileHud;
  private readonly buffBar: BuffBar;
  /** Rebuilt in place each frame, so a running buff allocates nothing. */
  private readonly buffViews: BuffView[] = [];
  /** Onion-skin copies of the rig left along a phase blink. */
  private readonly phaseGhosts: PhaseGhosts;
  /** Ground chevron orbiting the rig, aimed at the nearest live zombie. */
  private readonly threatPointer: ThreatPointer;
  /** The Drone Swarm bays' flight, loitering in the air around the rig. */
  private readonly droneEscort: DroneEscort;
  /** Scratch list of live bay levels, refilled on each escort recount. */
  private readonly droneEscortLevels: number[] = [];
  /** Yellow hex shell shown while the Reinforce ward is soaking damage. */
  private reinforceWard: ReinforceWard | null = null;
  /** Translucent blue bubble shown while the shield special is active. */
  private shieldBubble: THREE.Mesh | null = null;
  private shieldBubbleMaterial: THREE.MeshBasicMaterial | null = null;
  private shieldBubblePhase = 0;
  private zapBlast: THREE.Mesh | null = null;
  private zapBlastMaterial: THREE.MeshBasicMaterial | null = null;
  /** Seconds remaining in the Tesla Coil blast flash; 0 when idle. */
  private zapBlastTtl = 0;
  private charmPulse: THREE.Mesh | null = null;
  private charmPulseMaterial: THREE.MeshBasicMaterial | null = null;
  /** Seconds remaining in the Mind Control range pulse; 0 when idle. */
  private charmPulseTtl = 0;
  /** Charm range this pulse expands to, metres. */
  private charmPulseRange = 0;
  /**
   * Pooled world-space explosion flashes for Missile Launcher impacts (rocket
   * splash and the Q big rocket). Each slot is an expanding, fading sphere at a
   * world position; the pool is cycled so overlapping blasts each get a mesh.
   */
  private readonly explosions: {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    ttl: number;
    duration: number;
    radius: number;
  }[] = [];
  private explosionCursor = 0;
  /** The Thumper's two ground rings, outer (fast) first. */
  private thumpRings: THREE.Mesh[] = [];
  private thumpRingMaterials: THREE.MeshBasicMaterial[] = [];
  private thumpRingTtl = 0;
  private thumpRingRange = 0;
  private readonly waveTimelineHud: WaveTimelineHud;
  private waveTimeline: WaveTimeline | null = null;
  private readonly bossHud: HTMLElement;
  private readonly bossNameValue: HTMLElement;
  private readonly bossHealthTrack: HTMLDivElement;
  private readonly bossHealthFill: HTMLSpanElement;
  private readonly bossHealthValue: HTMLSpanElement;
  private readonly cashCounter: HTMLDivElement;
  private readonly cashValue: HTMLSpanElement;
  private readonly cashGains: HTMLDivElement;
  private readonly pickupToasts: HTMLDivElement;
  private readonly stuckPrompt: HTMLDivElement;
  private readonly selfDestructButton: HTMLButtonElement;
  private readonly selfDestructHint: HTMLSpanElement;
  private readonly selfDestructBanner: HTMLDivElement;
  private readonly endlessWaveBanner: HTMLDivElement;
  /** Timer that hides the endless banner again; see `showWaveBanner`. */
  private endlessBannerTimer = 0;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly countdownValue: HTMLDivElement;
  private readonly arenaLoadingOverlay: HTMLDivElement;
  private readonly arenaLoadingFill: HTMLDivElement;
  private readonly waveClearCard: WaveClearCard;
  /**
   * Full-screen warning about the next wave, shown over the arena before the
   * payout card. Mounted directly rather than through `buildUi` because it
   * owns its own DOM and its own GL context and needs nothing back.
   */
  private readonly threatAlert = new ThreatAlert();
  private readonly gameOverOverlay: HTMLDivElement;
  private readonly gameOverBest: HTMLDivElement;
  private readonly gameOverScore: HTMLDivElement;
  private readonly gameOverWaveValue: HTMLElement;
  private readonly gameOverKillsValue: HTMLElement;
  private readonly gameOverBoard: HTMLDivElement;
  private readonly settingsOverlay: HTMLDivElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly hudGarageButton: HTMLButtonElement;
  private readonly settingsEyebrow: HTMLSpanElement;
  private readonly settingsSfxVolumeControl: AudioVolumeControl;
  private readonly settingsMusicVolumeControl: AudioVolumeControl;
  private readonly spawnCheatButton: HTMLButtonElement;
  private readonly skipWaveInput: HTMLInputElement;
  private readonly settingsStatus: HTMLDivElement;

  private accumulator = 0;
  private lastTime = performance.now();
  private debugPaused = false;
  private settingsOpen = false;
  private speedScaleMaxKmh = 120;
  private ramDamageThresholdKmh = MIN_IMPACT_SPEED * 3.6;
  private ramKillThresholdKmh = LETHAL_IMPACT_SPEED * 3.6;
  private kills = 0;
  /** Arcade score for the whole run. Never spent, never rolled back. */
  private runScore = 0;
  private phoneAddictKills = 0;
  private currentWave = 1;
  private countdownRemaining = COUNTDOWN_SECONDS;
  /**
   * False until every prop, road and ground tile has settled. The countdown is
   * held here rather than run over a half-built arena — `whenReady` used to be
   * consumed only by the minimap, so the first thing a player saw of a level
   * was bare ground with tombstones appearing around them mid-fight.
   */
  private arenaReady = false;
  private arenaLoadSeconds = 0;
  /** Stops the background part-icon render when this mode goes away. */
  private stopIconRender: () => void = () => undefined;
  private phase: SurvivalPhase = 'countdown';
  private pointerFiring = false;
  private disposed = false;
  private lastHudIntegrity = -1;
  private lastHudSpeed = -1;
  private lastHudWave = -1;
  private lastHudScore = -1;
  private lastHudCash = -1;
  /** Merges rapid kill payouts into one rising "+$" chit instead of a pile. */
  private lastCashGain: { element: HTMLSpanElement; amount: number } | null =
    null;
  private lastCashGainAt = 0;
  private lastCountdownSecond = -1;
  private pendingWaveKillReward = 0;
  private pendingWaveReward = 0;
  private waveStartKills = 0;
  private waveMoneyEarned = 0;
  private waveBadgeBonusEarned = 0;
  private waveElapsedSeconds = 0;
  /** Arena seconds for the whole run, carried across waves and garage trips. */
  private runElapsedSeconds = 0;
  private waveStartIntegrityPct = 100;
  private cleanWaveStreak = 0;
  private pendingTransition: PendingTransition | null = null;
  private stuckSeconds = 0;
  /**
   * Counts down to the next point-defence pass. One timer for the whole rig,
   * but every live bay rolls its own chance on each pass — two bays are two
   * rolls, which is what makes a second one worth bolting on.
   */
  private droneInterceptTimer = 0;
  private recoveryCooldown = 0;
  private recoverySettleSeconds = 0;
  private recoveryRequested = false;
  private lastHudBossName = '';
  private lastHudBossPct = -1;
  /** Ability slots pressed since the last fixed step, drained by updateAbility. */
  private readonly abilityRequests = new Set<number>();
  /**
   * Seconds left on a stun — today only from a behemoth's boulder blast. While
   * it runs the rig takes no driving input at all and every ability and the
   * signature are locked out; the momentum itself was killed at the moment of
   * impact (see `applyStun`). Guns keep firing: a stun is meant to strand the
   * player, not disarm them.
   */
  private stunTimer = 0;
  /**
   * Seconds left on each ability's cooldown, keyed by the placed part backing
   * it. Keyed by part rather than by slot so a cooldown follows its emitter:
   * losing one ability part mid-wave must not hand another a free recharge.
   */
  private readonly abilityCooldowns = new Map<string, number>();
  /** Ability parts filling the bar right now, rebuilt from the live rig. */
  private abilityLoadout: AbilitySlotAssignment[] = [];
  /** Scratch buffers refilled in place each frame, so the HUD never allocates. */
  private readonly abilityCandidates: AbilityCandidate[] = [];
  private readonly abilitySlotViews: (AbilitySlotView | undefined)[] =
    ABILITY_SLOT_KEYS.map(() => undefined);
  /** Loadout the slot views were built from; see abilityLoadoutSignature. */
  private abilitySlotViewSignature = '';
  /** Strikes between the click that fired them and the blast landing. */
  private readonly strikes = new SignatureStrikes();
  /**
   * Seconds left before the signature block can fire again, and the cooldown
   * it is counting down from. Both are zero for a rig carrying no signature
   * block, which is also how the reticle knows to hide its gauge.
   */
  private signatureCooldown = 0;
  private signatureCooldownTotal = 0;
  /** Set by a click, consumed on the next fixed step. */
  private signatureRequested = false;
  /**
   * Seconds left on a flame lance, and the numbers it is burning at. The lance
   * has no host weapon to ride, so unlike Hellfire the mode owns it outright.
   */
  private flameLanceSeconds = 0;
  /** What that lance started from, so the HUD can draw it draining. */
  private flameLanceDuration = 0;
  private flameLanceTickTimer = 0;
  private flameLanceStats: {
    damage: number;
    ticksPerSecond: number;
    rangeM: number;
    coneDeg: number;
  } | null = null;
  /** Scratch vectors for the lance, so a burning frame allocates nothing. */
  private readonly lanceForward = new THREE.Vector3();
  private readonly lanceQuaternion = new THREE.Quaternion();
  /** Whether the shield bubble was up last frame, for its raise/drop effects. */
  private shieldWasUp = false;
  private debugProgressionSuppressed = false;
  private audioUnlocked = false;
  private devPanel: DevTunerPanel | null = null;
  private tuningUnsubscribe: (() => void) | null = null;
  private readonly recoveryImpulse = { x: 0, y: 0, z: 0 };
  private readonly recoveryTranslation = { x: 0, y: 0, z: 0 };
  private readonly recoveryVelocity = { x: 0, y: 0, z: 0 };
  private readonly recoveryAngularVelocity = { x: 0, y: 0, z: 0 };
  private readonly recoveryForward = new THREE.Vector3();
  private readonly recoveryQuaternion = new THREE.Quaternion();
  private readonly recoveryTargetQuaternion = new THREE.Quaternion();
  private readonly onUiButtonClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    this.unlockAudioFromInput();
    playSfx('uiClick');
  };
  /**
   * Scuttle-charge state. `armed` latches on the first lost wheel and never
   * clears, `requested` is the press waiting for the next fixed step, and
   * `holdSeconds` is the post-blast frame hold that owns the run's outcome
   * (`cleared`) and the pre-blast rig the Garage rebuilds from (`salvage`).
   */
  private selfDestructArmed = false;
  private selfDestructRequested = false;
  private selfDestructHoldSeconds = 0;
  private selfDestructAftershockSeconds = 0;
  private selfDestructCleared = false;
  /** Fuel factor the charge went off with, so the aftershocks match it. */
  private selfDestructFuelFired = 0;
  private selfDestructSalvage: {
    survivingPartIds: string[];
    partHp: Record<string, number>;
  } | null = null;
  /** HUD state the prompt was last built from, so a steady HUD costs nothing. */
  private selfDestructHudArmed = false;
  private selfDestructHudReachM = -1;

  private readonly keydown = (event: KeyboardEvent): void => {
    this.unlockAudioFromInput();
    if (event.key === 'Escape' && this.phase !== 'gameOver') {
      this.setSettingsOpen(!this.settingsOpen);
      event.preventDefault();
      return;
    }
    if (this.settingsOpen) {
      event.preventDefault();
      return;
    }
    if (this.phase === 'gameOver') return;
    const key = event.key.toLowerCase();
    if (key === 'j') {
      if (!event.repeat) this.recoveryRequested = true;
      event.preventDefault();
      return;
    }
    if (key === 'k') {
      if (!event.repeat) this.requestSelfDestruct();
      event.preventDefault();
      return;
    }
    const abilitySlot = ABILITY_SLOT_KEYS.indexOf(
      key as (typeof ABILITY_SLOT_KEYS)[number],
    );
    if (abilitySlot >= 0) {
      if (!event.repeat) this.requestAbility(abilitySlot);
      event.preventDefault();
      return;
    }
    this.keys.add(key);
    // Auto-repeat is excluded: a key already held when a card opens must not
    // dismiss it, and the coach is asking for a press rather than a hold.
    if (!event.repeat) {
      this.notifyFirstPlay(DRIVE_KEYS.has(key) ? 'drive' : 'other');
    }
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly blur = (): void => {
    this.keys.clear();
    this.pointerFiring = false;
    this.controls.fire = false;
    this.controls.manualAim = false;
    // A phone that backgrounds mid-gesture never delivers the pointerup, so
    // without this the rig drives itself into the horde while the player is
    // reading a notification.
    this.touchBraking = false;
    this.touch?.reset();
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    bp: VehicleBlueprint,
    run: SurvivalRunState,
    private readonly callbacks: SurvivalCallbacks,
  ) {
    this.mode = getGameMode(run.modeId ?? DEFAULT_GAME_MODE_ID);
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      320,
    );
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    const biome = getBiome(run.biomeId ?? DEFAULT_BIOME_ID);
    this.terrainSfx =
      biome.id === 'desert'
        ? 'sand'
        : biome.id === 'snowfield'
          ? 'snow'
          : 'gravel';
    this.biomeDrive = biome.drive;
    this.biomeHazard = biome.hazard;
    this.biomeEnvironment = biome.drive;
    this.arena = new ArenaBuilder(
      this.scene,
      this.world,
      biome,
      run.seed ?? randomSeed(),
    );
    this.vehicle = this.spawnVehicle(bp);
    // Measured while the chassis group still sits at the origin under an
    // identity transform (syncView is what first moves it), so this world box
    // is also the vehicle-local one.
    const chassisRadiusM = chassisFootprintRadiusM(this.vehicleGroup);
    this.threatPointer = new ThreatPointer(
      this.scene,
      chassisRadiusM + ORBIT_MARGIN_M,
    );
    // Measured off the same footprint: the flight loiters outside the rig
    // whatever shape it is, and stays hidden until a bay is actually on it.
    this.droneEscort = new DroneEscort(chassisRadiusM);
    this.scene.add(this.droneEscort.root);
    this.followCamera = new FollowCamera(
      this.camera,
      this.vehicle,
      this.arena.bounds,
    );
    // Before the first frame, so the run opens at the right distance rather
    // than easing in from the reference one.
    this.followCamera.setViewportHeight(container.clientHeight);
    this.followCamera.snap();
    // Added before the zombie visuals are captured below, so the two VFX
    // layers stay parented to the scene rather than to the zombie root.
    this.vfx = new VfxSystem(this.scene);
    const firstZombieVisualIndex = this.scene.children.length;
    this.zombies = new ZombieSystem(
      this.world,
      this.scene,
      this.arena.spawnPoints,
      this.vehicle,
      (reward, kind) => this.handleZombieKilled(reward, kind),
      this.vfx,
    );
    const zombieVisuals = this.scene.children.slice(firstZombieVisualIndex);
    this.zombieVisualRoot.name = 'zombie-system-visuals';
    this.zombieVisualRoot.add(...zombieVisuals);
    this.scene.add(this.zombieVisualRoot);
    this.autoAim = new AutoAim(this.vehicle, this.zombies, this.world);
    this.pickups = new Pickups(
      this.scene,
      this.vehicle,
      this.arena.bounds,
      (pickup) => this.collectPickup(pickup),
      () => this.rollSalvageBlock(),
    );
    this.sentries = new SentryTurrets(this.scene, {
      nearestTarget: (x, z, radiusM) => this.nearestSentryTarget(x, z, radiusM),
      hit: (handle, damage) =>
        this.zombies.hitZombieHandle(handle, damage) !== 'miss',
      onShot: (from, to) => {
        this.tracerRenderer.spawn(from, to, 'turret');
        this.vfx.muzzleFlash(from, to);
        playSfx('gunLight', { pitch: 1.12 });
      },
    });
    this.waves = new WaveManager(this.zombies, {
      onRemainingChanged: () => undefined,
      onWaveComplete: (wave, reward) => this.onWaveComplete(wave, reward),
      onEndlessWaveAdvanced: (wave, reward) =>
        this.onEndlessWaveAdvanced(wave, reward),
    });
    this.waves.setEndless(this.mode.endlessWaves);
    // Necromancer raises are bodies the director never assigned; hand them to
    // it so the wave's remaining count covers them.
    this.zombies.onZombiesRaised = (count) =>
      this.waves.countBonusSpawns(count);
    this.zombies.onSfx = (report) => {
      this.camera.getWorldDirection(this.audioListenerForward);
      playZombieSfx(report, {
        x: this.camera.position.x,
        z: this.camera.position.z,
        forwardX: this.audioListenerForward.x,
        forwardZ: this.audioListenerForward.z,
      });
    };
    // A melee weapon biting a zombie was the one hit in the game that neither
    // the camera nor the reticle acknowledged. Contacts are only recorded here;
    // the step spends the strongest one, because a grinder drum sitting in a
    // horde lands one of these per zombie and stacking them would rattle the
    // screen flat.
    this.zombies.onMeleeHit = (x, z, force) => {
      if (force <= this.meleeHitForce) return;
      this.meleeHitForce = force;
      this.meleeHitX = x;
      this.meleeHitZ = z;
    };
    // A behemoth's slam is the heaviest hit a zombie lands on the vehicle, so
    // it gets the same camera-kick treatment as a Heavy Cannon shell.
    this.zombies.onBehemothSmash = (x, _y, z) => this.shakeCameraAt(x, z, 1.1);
    this.zombies.onVehicleStun = (seconds, x, _y, z) => {
      this.applyStun(seconds);
      // Harder kick than the slam: this one took the car's controls away, and
      // the shake is the only thing that says so at the moment it happens.
      this.shakeCameraAt(x, z, 1.4);
    };
    this.tracerRenderer = new TracerRenderer(this.scene);
    this.phaseGhosts = new PhaseGhosts(this.scene);

    const builtUi = this.buildUI();
    this.ui = builtUi.root;
    this.ui.addEventListener('click', this.onUiButtonClick, true);
    this.speedValue = builtUi.speedValue;
    this.speedTrack = builtUi.speedTrack;
    this.speedSafeLabel = builtUi.speedSafeLabel;
    this.speedDamageLabel = builtUi.speedDamageLabel;
    this.speedKillLabel = builtUi.speedKillLabel;
    this.integrityValue = builtUi.integrityValue;
    this.integrityFill = builtUi.integrityFill;
    this.healthPanel = builtUi.healthPanel;
    this.fuelValue = builtUi.fuelValue;
    this.fuelFill = builtUi.fuelFill;
    this.waveTimelineHud = builtUi.waveTimeline;
    this.bossHud = builtUi.bossHud;
    this.bossNameValue = builtUi.bossNameValue;
    this.bossHealthTrack = builtUi.bossHealthTrack;
    this.bossHealthFill = builtUi.bossHealthFill;
    this.bossHealthValue = builtUi.bossHealthValue;
    this.cashCounter = builtUi.cashCounter;
    this.cashValue = builtUi.cashValue;
    this.cashGains = builtUi.cashGains;
    this.pickupToasts = builtUi.pickupToasts;
    this.stuckPrompt = builtUi.stuckPrompt;
    this.selfDestructButton = builtUi.selfDestructButton;
    this.selfDestructHint = builtUi.selfDestructHint;
    this.selfDestructBanner = builtUi.selfDestructBanner;
    this.endlessWaveBanner = builtUi.endlessWaveBanner;
    this.countdownOverlay = builtUi.countdownOverlay;
    this.countdownValue = builtUi.countdownValue;
    this.arenaLoadingOverlay = builtUi.arenaLoadingOverlay;
    this.arenaLoadingFill = builtUi.arenaLoadingFill;
    this.waveClearCard = builtUi.waveClearCard;
    this.gameOverOverlay = builtUi.gameOverOverlay;
    this.gameOverBest = builtUi.gameOverBest;
    this.gameOverScore = builtUi.gameOverScore;
    this.gameOverWaveValue = builtUi.gameOverWaveValue;
    this.gameOverKillsValue = builtUi.gameOverKillsValue;
    this.gameOverBoard = builtUi.gameOverBoard;
    this.settingsOverlay = builtUi.settingsOverlay;
    this.settingsButton = builtUi.settingsButton;
    this.hudGarageButton = builtUi.hudGarageButton;
    this.hudGarageButton.hidden = !this.mode.midRunGarage;
    this.settingsEyebrow = builtUi.settingsEyebrow;
    this.settingsSfxVolumeControl = builtUi.settingsSfxVolumeControl;
    this.settingsMusicVolumeControl = builtUi.settingsMusicVolumeControl;
    this.spawnCheatButton = builtUi.spawnCheatButton;
    this.skipWaveInput = builtUi.skipWaveInput;
    this.settingsStatus = builtUi.settingsStatus;
    this.minimap = new Minimap(
      this.ui,
      this.arena.bounds,
      this.arena.minimapFeatures,
      {
        renderer: this.renderer,
        scene: this.scene,
        hide: [
          this.vehicleGroup,
          ...this.wheelMeshes.values(),
          this.zombieVisualRoot,
          this.threatPointer.root,
        ],
        ready: this.arena.whenReady(),
      },
    );
    this.scopeCursor = new ScopeCursor(this.ui, this.renderer.domElement);
    this.ui.appendChild(this.threatAlert.root);
    this.warningHud = new WarningHud(this.ui);
    this.damageNumbers = new DamageNumbersOverlay(this.ui);
    this.zombies.setDamageListener((report) => {
      this.damageNumbers.add(
        report.targetKey,
        report.amount,
        report.x,
        report.y,
        report.z,
        report.killed,
      );
      playDamageNumberSfx(report.amount, report.killed);
    });
    this.buffBar = new BuffBar(this.ui);
    this.abilityBar = new AbilityBar(this.ui, MAX_ABILITY_SLOTS, (slot) =>
      this.requestAbility(slot),
    );
    // After the bar, so it stacks above it in DOM order as well as in CSS.
    this.strikeGauge = new StrikeGauge(this.ui);
    // The ability boxes are already buttons, so touch reaches the specials
    // through the same bar the mouse uses; what the overlay has to add is the
    // driving, the aim, and the two keybinds with no on-screen twin.
    this.syncTouchControls();
    this.touchUnsubscribe = onTouchControlsChange(() =>
      this.syncTouchControls(),
    );
    this.mobileHud = installSurvivalMobileHud(this.ui);

    // The tutorial is a property of this one deployment, so everything it
    // changes is decided here, once, rather than re-tested all over the mode:
    // the coach exists or it does not, and the wave's roster is authored or it
    // is the curve's.
    this.firstPlay =
      run.firstPlay === true
        ? new FirstPlayCoach(this.ui, {
            onChanged: () => this.syncFirstPlayHud(),
          })
        : null;
    this.firstPlayVictory =
      this.firstPlay === null
        ? null
        : new FirstPlayVictory(this.ui, {
            onStartRun: () => this.leaveFirstPlayWave(),
          });
    if (this.firstPlay !== null) {
      this.waves.setCompositionOverride(FIRST_PLAY_WAVE_COMPOSITION);
    }
    this.syncFirstPlayHud();

    if (Number.isFinite(run.kills) && (run.kills ?? 0) >= 0) {
      this.kills = Math.floor(run.kills ?? 0);
    }
    this.waveStartKills = this.kills;
    this.cleanWaveStreak = 0;
    if (Number.isFinite(run.score) && (run.score ?? 0) >= 0) {
      this.runScore = Math.floor(run.score ?? 0);
    }
    // Waves before this one were played in an earlier mode instance, so the
    // run clock continues from what App committed rather than from zero.
    if (Number.isFinite(run.elapsedSeconds) && (run.elapsedSeconds ?? 0) > 0) {
      this.runElapsedSeconds = run.elapsedSeconds ?? 0;
    }

    // A resumed run begins from App's committed wave-start damage.
    if (run.partHp) {
      this.attachNewIslands(this.vehicle.applyPartHpSnapshot(run.partHp));
    }

    this.beginCountdown(run.wave);
    // Draw the catalogue thumbnails in the background so the threat alert has
    // them at wave clear. A new player now meets the arena before the garage,
    // so this can no longer assume the editor already rendered them — and it is
    // a cache hit rather than work when the editor did.
    this.stopIconRender = renderPartIcons(
      this.renderer,
      SIMPLE_PART_IDS.flatMap((id) => {
        const definition = PART_CATALOG[id];
        return definition ? [definition] : [];
      }),
    );
    // `whenReady` settles rather than rejects, so this needs no catch: an asset
    // that failed every retry has already been replaced with a placeholder.
    void this.arena.whenReady().then(() => this.markArenaReady());
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    window.addEventListener('pointerup', this.onFireUp);
    window.addEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.addEventListener('pointermove', this.onAim);
    this.renderer.domElement.addEventListener('pointerdown', this.onFireDown);

    if (isDevMode()) this.mountDevTuner();
  }

  /** Build the dev tuner panel and keep living zombies in sync with edits. */
  private mountDevTuner(): void {
    this.devPanel = new DevTunerPanel(this.ui, {
      currentWave: () => this.currentWave,
      aliveCount: () => this.zombies.getActiveCount(),
      applyLiveTuning: () => this.applyLiveTuning(),
      restartWave: () => this.debugStartWave(this.currentWave),
      skipToWave: (wave) => this.debugStartWave(wave),
      spawnOneOfEach: () => this.onSpawnEveryZombie(),
      killAllZombies: () => this.debugKillAllZombies(),
      grantInfiniteMoney: () => this.callbacks.onCheatInfiniteMoney(),
    });
    this.tuningUnsubscribe = subscribeTuning(() => this.applyLiveTuning());
  }

  /**
   * Push a live tuning edit onto the running wave: refresh the wave multipliers
   * from the (possibly edited) curves, then re-stat every living zombie. God
   * mode / time scale are read each frame, so they need no work here.
   */
  private applyLiveTuning(): void {
    if (this.disposed) return;
    const wave = this.currentWave;
    this.zombies.setWaveMultipliers(
      healthMultiplierForWave(wave),
      speedMultiplierForWave(wave),
      attackDamageMultiplierForWave(wave),
    );
    this.zombies.reapplyTuningToAlive();
  }

  private spawnVehicle(bp: VehicleBlueprint): RuntimeVehicle {
    const clone = JSON.parse(JSON.stringify(bp)) as VehicleBlueprint;
    const connections = deriveConnections(clone, getPartDef);
    const spawnY = -lowestPointM(clone, getPartDef) + 0.32;
    const vehicle = new RuntimeVehicle(
      this.world,
      clone,
      getPartDef,
      connections,
      {
        translation: { x: 0, y: spawnY, z: 0 },
      },
    );

    for (const [id, part] of vehicle.assembled.parts) {
      const mesh = buildPartMesh(part.def, part.placed);
      // Named whichever group it ends up in, so `findPartMesh` can still reach
      // a wheel after it has broken off and moved into an island's group.
      mesh.name = `part:${id}`;
      if (part.def.wheel) {
        const spin = mesh.getObjectByName('wheel-spin');
        if (spin) spin.userData.baseQuat = spin.quaternion.clone();
        // The part group is moved to the wheel's suspension-travelled centre
        // every frame, so its children must sit on the group origin. A tread
        // has a static belt alongside its spinning rollers, so zero them all
        // rather than just the spin group.
        for (const child of mesh.children) child.position.set(0, 0, 0);
        this.wheelMeshes.set(id, mesh);
        this.wheelSpin.set(id, 0);
        this.scene.add(mesh);
      } else {
        this.vehicleGroup.add(mesh);
      }
    }
    this.scene.add(this.vehicleGroup);
    return vehicle;
  }

  private buildUI(): SurvivalUi {
    const root = document.createElement('div');
    root.className = 'ui-layer survival-ui';
    this.container.appendChild(root);

    const waveTimeline = new WaveTimelineHud();
    root.appendChild(waveTimeline.root);

    // Boss health bar: hidden on ordinary waves, revealed under the wave
    // timeline for as long as a boss is alive.
    const bossHud = document.createElement('section');
    bossHud.className = 'panel survival-boss-hud';
    bossHud.hidden = true;
    const bossNameValue = document.createElement('strong');
    bossNameValue.className = 'survival-boss-hud__name';
    const bossHealthTrack = document.createElement('div');
    bossHealthTrack.className = 'survival-boss-hud__track';
    bossHealthTrack.setAttribute('role', 'progressbar');
    bossHealthTrack.setAttribute('aria-label', 'Boss health');
    bossHealthTrack.setAttribute('aria-valuemin', '0');
    bossHealthTrack.setAttribute('aria-valuemax', '100');
    const bossHealthFill = document.createElement('span');
    bossHealthFill.className = 'survival-boss-hud__fill';
    bossHealthTrack.appendChild(bossHealthFill);
    const bossHealthValue = document.createElement('span');
    bossHealthValue.className = 'survival-boss-hud__value';
    bossHud.append(bossNameValue, bossHealthTrack, bossHealthValue);
    root.appendChild(bossHud);

    const hud = document.createElement('div');
    hud.className = 'panel survival-driver-hud';
    const speedRow = document.createElement('div');
    speedRow.className = 'survival-speed';
    const speedHeader = document.createElement('div');
    speedHeader.className = 'survival-speed__header';
    const speedLabel = document.createElement('span');
    speedLabel.textContent = 'Speed';
    const speedReadout = document.createElement('div');
    speedReadout.className = 'survival-speed__readout';
    const speedValue = document.createElement('span');
    speedValue.textContent = '0';
    const speedUnit = document.createElement('small');
    speedUnit.textContent = 'KM/H';
    speedReadout.append(speedValue, speedUnit);
    speedHeader.append(speedLabel, speedReadout);

    const speedGauge = document.createElement('div');
    speedGauge.className = 'survival-speed__gauge';
    const speedTrack = document.createElement('div');
    speedTrack.className = 'survival-speed__track';
    speedTrack.setAttribute('role', 'meter');
    speedTrack.setAttribute('aria-label', 'Ram damage speed');
    speedTrack.setAttribute('aria-valuemin', '0');
    const safeTier = document.createElement('span');
    safeTier.className = 'survival-speed__tier survival-speed__tier--safe';
    const damageTier = document.createElement('span');
    damageTier.className = 'survival-speed__tier survival-speed__tier--damage';
    const killTier = document.createElement('span');
    killTier.className = 'survival-speed__tier survival-speed__tier--kill';
    const speedMarker = document.createElement('span');
    speedMarker.className = 'survival-speed__marker';
    speedMarker.setAttribute('aria-hidden', 'true');
    speedTrack.append(safeTier, damageTier, killTier, speedMarker);
    const speedLegend = document.createElement('div');
    speedLegend.className = 'survival-speed__legend';
    const speedSafeLabel = document.createElement('span');
    const speedDamageLabel = document.createElement('span');
    const speedKillLabel = document.createElement('span');
    speedLegend.append(speedSafeLabel, speedDamageLabel, speedKillLabel);
    speedGauge.append(speedTrack, speedLegend);
    speedRow.append(speedHeader, speedGauge);
    const health = document.createElement('div');
    health.className = 'survival-health';
    const healthHeader = document.createElement('div');
    const healthLabel = document.createElement('span');
    healthLabel.textContent = 'Vehicle Health';
    const integrityValue = document.createElement('span');
    healthHeader.append(healthLabel, integrityValue);
    const healthTrack = document.createElement('div');
    healthTrack.className = 'survival-health__track';
    healthTrack.setAttribute('role', 'progressbar');
    healthTrack.setAttribute('aria-label', 'Vehicle health');
    healthTrack.setAttribute('aria-valuemin', '0');
    healthTrack.setAttribute('aria-valuemax', '100');
    const integrityFill = document.createElement('span');
    integrityFill.className = 'survival-health__fill';
    healthTrack.appendChild(integrityFill);
    health.append(healthHeader, healthTrack);
    // Onboard fuel gauge — the resource the player manages, refilled by driving
    // into refuel crates (see FuelPickups).
    const fuel = document.createElement('div');
    fuel.className = 'survival-fuel';
    const fuelHeader = document.createElement('div');
    const fuelLabel = document.createElement('span');
    fuelLabel.textContent = 'Fuel';
    const fuelValue = document.createElement('span');
    fuelHeader.append(fuelLabel, fuelValue);
    const fuelTrack = document.createElement('div');
    fuelTrack.className = 'survival-fuel__track';
    fuelTrack.setAttribute('role', 'progressbar');
    fuelTrack.setAttribute('aria-label', 'Fuel');
    fuelTrack.setAttribute('aria-valuemin', '0');
    fuelTrack.setAttribute('aria-valuemax', '100');
    const fuelFill = document.createElement('span');
    fuelFill.className = 'survival-fuel__fill';
    fuelTrack.appendChild(fuelFill);
    fuel.append(fuelHeader, fuelTrack);
    // Specials live in their own centre-screen bar (see AbilityBar), not in
    // this corner panel — the driver reads them mid-fight, eyes on the road.
    // Score lives in the wave strip up top, next to the wave it was earned on.
    hud.append(speedRow, health, fuel);
    root.appendChild(hud);

    // Cash: one big number in the free top-left corner. Banked earnings and the
    // wave's unbanked kill money read as a single wallet, so a kill visibly
    // moves the number the driver is playing for rather than a second tally.
    const cashCounter = document.createElement('div');
    cashCounter.className = 'survival-cash';
    cashCounter.setAttribute('role', 'status');
    cashCounter.setAttribute('aria-label', 'Money');
    const cashValue = document.createElement('span');
    cashValue.className = 'survival-cash__value';
    const cashGains = document.createElement('div');
    cashGains.className = 'survival-cash__gains';
    cashGains.setAttribute('aria-hidden', 'true');
    cashCounter.append(cashValue, cashGains);
    root.appendChild(cashCounter);

    // Supply crates say what they did in their own column under the wallet:
    // a crate is a thing that just happened, not a state to keep reading.
    const pickupToasts = document.createElement('div');
    pickupToasts.className = 'survival-pickup';
    pickupToasts.setAttribute('role', 'status');
    pickupToasts.setAttribute('aria-label', 'Supply crates');
    root.appendChild(pickupToasts);

    // Both driver prompts live in one centred row, so whichever are up sit
    // side by side and read as the same kind of offer: a key, right now.
    const promptRow = document.createElement('div');
    promptRow.className = 'survival-prompts';

    const stuckPrompt = document.createElement('div');
    stuckPrompt.className = 'panel survival-prompt survival-stuck-prompt';
    stuckPrompt.setAttribute('role', 'status');
    const stuckIcon = document.createElement('span');
    stuckIcon.className = 'survival-prompt__icon';
    stuckIcon.setAttribute('aria-hidden', 'true');
    const stuckCopy = document.createElement('div');
    stuckCopy.className = 'survival-prompt__copy';
    const stuckTitle = document.createElement('strong');
    stuckTitle.textContent = 'Vehicle Stuck';
    const stuckAction = document.createElement('span');
    stuckAction.textContent = shouldUseTouchControls()
      ? 'Tap ↻ to Jump'
      : 'Press J to Jump';
    stuckCopy.append(stuckTitle, stuckAction);
    stuckPrompt.append(stuckIcon, stuckCopy);
    promptRow.appendChild(stuckPrompt);

    // Scuttle charge: the same prompt card in danger colours, shown only once a
    // wheel is gone. Its hint quotes the live blast reach, which is fuel.
    const selfDestructButton = document.createElement('button');
    selfDestructButton.type = 'button';
    selfDestructButton.className = 'panel survival-prompt survival-scuttle';
    const selfDestructIcon = document.createElement('span');
    selfDestructIcon.className = 'survival-prompt__icon';
    selfDestructIcon.setAttribute('aria-hidden', 'true');
    // A span rather than a div: this card is a button, whose content must stay
    // phrasing-level.
    const selfDestructCopy = document.createElement('span');
    selfDestructCopy.className = 'survival-prompt__copy';
    const selfDestructTitle = document.createElement('strong');
    selfDestructTitle.textContent = 'Self-Destruct';
    const selfDestructHint = document.createElement('span');
    selfDestructCopy.append(selfDestructTitle, selfDestructHint);
    selfDestructButton.append(selfDestructIcon, selfDestructCopy);
    selfDestructButton.addEventListener('click', this.onSelfDestructClick);
    promptRow.appendChild(selfDestructButton);
    root.appendChild(promptRow);

    const selfDestructBanner = document.createElement('div');
    selfDestructBanner.className = 'survival-scuttle-banner';
    selfDestructBanner.setAttribute('role', 'status');
    selfDestructBanner.hidden = true;
    root.appendChild(selfDestructBanner);

    // Endless runs never stop, so the wave number changing is the only signal
    // that anything happened. One big numeral, gone in a second and a half —
    // it is a punctuation mark on a fight that is still going, not a card.
    const endlessWaveBanner = document.createElement('div');
    endlessWaveBanner.className = 'survival-endless-banner';
    endlessWaveBanner.setAttribute('role', 'status');
    endlessWaveBanner.hidden = true;
    root.appendChild(endlessWaveBanner);

    const countdownOverlay = overlayPanel();
    countdownOverlay.style.pointerEvents = 'none';
    const countdownLabel = document.createElement('div');
    countdownLabel.textContent = 'WAVE STARTING';
    countdownLabel.style.cssText =
      'font-size:15px;font-weight:800;letter-spacing:.12em;color:#ffb44d';
    const countdownValue = document.createElement('div');
    countdownValue.style.cssText =
      'font-size:54px;font-weight:900;line-height:1.1';
    countdownOverlay.append(countdownLabel, countdownValue);
    root.appendChild(countdownOverlay);

    // A full-bleed scrim rather than a panel: the whole point is that the
    // half-built arena behind it — bare ground, props still popping in — is
    // never the first thing a player sees of a level.
    const arenaLoadingOverlay = document.createElement('div');
    arenaLoadingOverlay.setAttribute('role', 'status');
    arenaLoadingOverlay.style.cssText =
      'position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:18px;background:#0b0d0b;' +
      'transition:opacity 240ms ease-out';
    // Key art behind the bar. `arenaReady` is latched for the life of the mode,
    // so this screen is shown once per mount and one painting is picked here
    // rather than per wave.
    applySplashBackground(arenaLoadingOverlay, pickLoadingSplash());
    const arenaLoadingLabel = document.createElement('div');
    arenaLoadingLabel.textContent = 'ROLLING OUT';
    // A shadow the flat-background version did not need: the label sits over
    // paint now, and one of the two paintings is bright green right where this
    // lands.
    arenaLoadingLabel.style.cssText =
      'font-size:15px;font-weight:800;letter-spacing:.24em;color:#c2d47f;' +
      'text-shadow:0 2px 6px rgb(0 0 0 / 0.85)';
    const arenaLoadingTrack = document.createElement('div');
    arenaLoadingTrack.style.cssText =
      'width:min(19rem,62vw);height:10px;background:rgb(9 11 9 / 0.86);' +
      'border:2px solid #070907;overflow:hidden;' +
      'box-shadow:0 3px 10px rgb(0 0 0 / 0.6)';
    const arenaLoadingFill = document.createElement('div');
    arenaLoadingFill.style.cssText =
      'height:100%;width:0%;background:#a8bd68;transition:width 180ms linear';
    arenaLoadingTrack.appendChild(arenaLoadingFill);
    arenaLoadingOverlay.append(arenaLoadingLabel, arenaLoadingTrack);
    root.appendChild(arenaLoadingOverlay);

    const waveClearCard = new WaveClearCard({
      onContinue: this.onNextWave,
      onGarage: this.onGoToGarage,
      onRepairAndContinue: this.onRepairAndContinue,
    });
    root.appendChild(waveClearCard.root);

    const gameOverOverlay = overlayPanel();
    gameOverOverlay.classList.add('survival-gameover');
    // Visibility is the `hidden` attribute, never an inline `display`: the
    // touch layout re-lays the card out in landscape, and a layout rule strong
    // enough to beat an inline `display: block` also beats `display: none`.
    gameOverOverlay.hidden = true;
    gameOverOverlay.setAttribute('role', 'dialog');
    gameOverOverlay.setAttribute('aria-modal', 'true');
    gameOverOverlay.setAttribute('aria-labelledby', 'survival-gameover-title');
    const gameOverTitle = document.createElement('h2');
    gameOverTitle.id = 'survival-gameover-title';
    gameOverTitle.textContent = 'Run Over';
    const gameOverBest = document.createElement('div');
    gameOverBest.className = 'survival-gameover__best';
    gameOverBest.textContent = 'New Best!';
    gameOverBest.hidden = true;
    const gameOverScore = document.createElement('div');
    gameOverScore.className = 'survival-gameover__score';
    const gameOverScoreLabel = document.createElement('div');
    gameOverScoreLabel.className = 'survival-gameover__score-label';
    gameOverScoreLabel.textContent = 'Final Score';
    const gameOverStats = document.createElement('div');
    gameOverStats.className = 'survival-gameover__stats';
    const gameOverStatRow = (label: string): HTMLElement => {
      const row = document.createElement('div');
      const rowLabel = document.createElement('span');
      rowLabel.textContent = label;
      const rowValue = document.createElement('strong');
      row.append(rowLabel, rowValue);
      gameOverStats.appendChild(row);
      return rowValue;
    };
    const gameOverWaveValue = gameOverStatRow('Wave Reached');
    const gameOverKillsValue = gameOverStatRow('Zombies Killed');
    const gameOverBoard = document.createElement('div');
    gameOverBoard.className = 'survival-gameover__board';
    const gameOverReset = document.createElement('p');
    gameOverReset.className = 'survival-gameover__reset';
    gameOverReset.textContent =
      'Your rig, cash and upgrades are gone. Parts you unlocked stay unlocked — build again and go further.';
    const gameOverActions = document.createElement('div');
    gameOverActions.className = 'survival-gameover__actions';
    const gameOverMenuButton = document.createElement('button');
    gameOverMenuButton.type = 'button';
    gameOverMenuButton.className = 'ui-button ui-button--medium';
    gameOverMenuButton.textContent = 'Return to Menu';
    gameOverMenuButton.addEventListener('click', this.onGameOverMenu);
    const gameOverButton = document.createElement('button');
    gameOverButton.type = 'button';
    gameOverButton.className = 'primary';
    gameOverButton.textContent = 'Restart Run';
    gameOverButton.addEventListener('click', this.onGameOverContinue);
    gameOverActions.append(gameOverMenuButton, gameOverButton);
    // The verdict is one block — title, badge, and the score it is about — so a
    // short landscape phone can set it beside the run's numbers instead of
    // above them and make the card scroll.
    const gameOverHeadline = document.createElement('div');
    gameOverHeadline.className = 'survival-gameover__headline';
    gameOverHeadline.append(
      gameOverTitle,
      gameOverBest,
      gameOverScoreLabel,
      gameOverScore,
    );
    gameOverOverlay.append(
      gameOverHeadline,
      gameOverStats,
      gameOverBoard,
      gameOverReset,
      gameOverActions,
    );
    root.appendChild(gameOverOverlay);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className =
      'ui-button ui-button--medium survival-settings-button';
    settingsButton.textContent = 'Settings';
    settingsButton.setAttribute('aria-haspopup', 'dialog');
    settingsButton.addEventListener('click', () => this.setSettingsOpen(true));
    root.appendChild(settingsButton);

    // Creative's own exit, sat beside Settings rather than buried inside it.
    // The sandbox loop is build, test, change something, test again, so the way
    // back to the bench has to be one press from the arena — in every other
    // mode leaving mid-wave forfeits the wave, which is why it stays hidden in
    // the settings panel there.
    const hudGarageButton = document.createElement('button');
    hudGarageButton.type = 'button';
    hudGarageButton.className =
      'ui-button ui-button--medium survival-garage-button';
    hudGarageButton.textContent = 'Garage';
    hudGarageButton.hidden = true;
    hudGarageButton.addEventListener('click', () => this.onReturnToGarage());
    root.appendChild(hudGarageButton);

    const settingsOverlay = document.createElement('div');
    settingsOverlay.className = 'survival-settings-overlay';
    settingsOverlay.hidden = true;
    settingsOverlay.setAttribute('role', 'dialog');
    settingsOverlay.setAttribute('aria-modal', 'true');
    settingsOverlay.setAttribute('aria-label', 'Wave settings');
    const settingsPanel = document.createElement('section');
    settingsPanel.className = 'panel survival-settings';
    const settingsHeader = document.createElement('header');
    const settingsHeading = document.createElement('div');
    const settingsEyebrow = document.createElement('span');
    settingsEyebrow.textContent = `Wave ${this.currentWave}`;
    const settingsTitle = document.createElement('h2');
    settingsTitle.textContent = 'Settings';
    settingsHeading.append(settingsEyebrow, settingsTitle);
    const closeSettingsButton = document.createElement('button');
    closeSettingsButton.type = 'button';
    closeSettingsButton.className = 'ui-button ui-button--small';
    closeSettingsButton.textContent = 'Close';
    closeSettingsButton.addEventListener('click', () =>
      this.setSettingsOpen(false),
    );
    settingsHeader.append(settingsHeading, closeSettingsButton);

    const audioControls = document.createElement('div');
    audioControls.className = 'survival-settings__audio';
    const volumeClasses = {
      row: 'survival-settings__volume-row',
      input: 'survival-settings__volume',
      output: 'survival-settings__volume-value',
    } as const;
    const settingsSfxVolumeControl = createAudioVolumeControl({
      label: 'Sound effects',
      classes: volumeClasses,
    });
    const settingsMusicVolumeControl = createAudioVolumeControl({
      label: 'Music',
      classes: volumeClasses,
    });
    audioControls.append(
      settingsSfxVolumeControl.row,
      settingsMusicVolumeControl.row,
    );
    settingsSfxVolumeControl.input.addEventListener(
      'input',
      this.onSfxVolumeInput,
    );
    settingsMusicVolumeControl.input.addEventListener(
      'input',
      this.onMusicVolumeInput,
    );

    const cheatsToggle = createToggle('Enable Cheats');
    cheatsToggle.classList.add('survival-settings__cheat-toggle');
    const cheatsInput = cheatsToggle.querySelector('input');
    const cheatActions = document.createElement('div');
    cheatActions.className = 'survival-settings__cheats';
    cheatActions.hidden = true;
    const spawnCheatButton = document.createElement('button');
    spawnCheatButton.type = 'button';
    spawnCheatButton.className = 'ui-button ui-button--medium';
    spawnCheatButton.textContent = 'Spawn 1 of Every Zombie';
    spawnCheatButton.addEventListener('click', this.onSpawnEveryZombie);
    const infiniteMoneyButton = document.createElement('button');
    infiniteMoneyButton.type = 'button';
    infiniteMoneyButton.className = 'ui-button ui-button--medium';
    infiniteMoneyButton.textContent = 'Give Infinite Money';
    infiniteMoneyButton.addEventListener('click', this.onInfiniteMoney);
    const skipWaveRow = document.createElement('div');
    skipWaveRow.className = 'survival-settings__skip-wave';
    const skipWaveInput = document.createElement('input');
    skipWaveInput.type = 'number';
    skipWaveInput.min = '1';
    skipWaveInput.step = '1';
    skipWaveInput.value = String(this.currentWave);
    skipWaveInput.setAttribute('aria-label', 'Wave to skip to');
    const skipWaveButton = document.createElement('button');
    skipWaveButton.type = 'button';
    skipWaveButton.className = 'ui-button ui-button--medium';
    skipWaveButton.textContent = 'Skip to Wave';
    skipWaveButton.addEventListener('click', this.onSkipToWave);
    skipWaveRow.append(skipWaveInput, skipWaveButton);
    cheatActions.append(spawnCheatButton, infiniteMoneyButton, skipWaveRow);
    cheatsInput?.addEventListener('change', () => {
      cheatActions.hidden = !cheatsInput.checked;
      this.settingsStatus.textContent = cheatsInput.checked
        ? 'Cheats enabled for this run.'
        : '';
    });

    const resetSection = document.createElement('div');
    resetSection.className = 'survival-settings__reset';
    const resetCopy = document.createElement('div');
    const resetTitle = document.createElement('strong');
    resetTitle.textContent = 'Reset Wave';
    const resetDescription = document.createElement('span');
    resetDescription.textContent =
      "Restart this wave with your vehicle restored. This wave's pending rewards are discarded.";
    resetCopy.append(resetTitle, resetDescription);
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'ui-button ui-button--danger ui-button--medium';
    resetButton.textContent = 'Reset Wave';
    resetButton.addEventListener('click', () => this.onResetWave());
    resetSection.append(resetCopy, resetButton);

    const garageSection = document.createElement('div');
    garageSection.className = 'survival-settings__reset';
    const garageCopy = document.createElement('div');
    const garageTitle = document.createElement('strong');
    garageTitle.textContent = 'Return to Garage';
    const garageDescription = document.createElement('span');
    garageDescription.textContent =
      'Head back to the Garage to build and repair. This wave restarts when you deploy, and its pending rewards are discarded.';
    garageCopy.append(garageTitle, garageDescription);
    const garageButton = document.createElement('button');
    garageButton.type = 'button';
    garageButton.className = 'ui-button ui-button--medium';
    garageButton.textContent = 'Return to Garage';
    garageButton.addEventListener('click', () => this.onReturnToGarage());
    garageSection.append(garageCopy, garageButton);

    const saveSection = document.createElement('div');
    saveSection.className = 'survival-settings__reset';
    const saveCopy = document.createElement('div');
    const saveTitle = document.createElement('strong');
    saveTitle.textContent = 'Save & Quit';
    const saveDescription = document.createElement('span');
    saveDescription.textContent =
      'Bank your progress and return to the title screen. This wave restarts when you resume.';
    saveCopy.append(saveTitle, saveDescription);
    const saveQuitButton = document.createElement('button');
    saveQuitButton.type = 'button';
    saveQuitButton.className = 'ui-button ui-button--medium';
    saveQuitButton.textContent = 'Save & Quit';
    saveQuitButton.addEventListener('click', () => this.onSaveAndQuit());
    saveSection.append(saveCopy, saveQuitButton);

    const settingsStatus = document.createElement('div');
    settingsStatus.className = 'survival-settings__status';
    settingsStatus.setAttribute('role', 'status');
    settingsPanel.append(
      settingsHeader,
      audioControls,
      cheatsToggle,
      cheatActions,
      garageSection,
      resetSection,
      saveSection,
      settingsStatus,
    );
    settingsOverlay.appendChild(settingsPanel);
    settingsOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === settingsOverlay) this.setSettingsOpen(false);
    });
    root.appendChild(settingsOverlay);

    return {
      root,
      speedValue,
      speedTrack,
      speedSafeLabel,
      speedDamageLabel,
      speedKillLabel,
      integrityValue,
      integrityFill,
      healthPanel: health,
      fuelValue,
      fuelFill,
      waveTimeline,
      bossHud,
      bossNameValue,
      bossHealthTrack,
      bossHealthFill,
      bossHealthValue,
      cashCounter,
      cashValue,
      cashGains,
      pickupToasts,
      stuckPrompt,
      selfDestructButton,
      selfDestructHint,
      selfDestructBanner,
      endlessWaveBanner,
      countdownOverlay,
      countdownValue,
      arenaLoadingOverlay,
      arenaLoadingFill,
      waveClearCard,
      gameOverOverlay,
      gameOverBest,
      gameOverScore,
      gameOverWaveValue,
      gameOverKillsValue,
      gameOverBoard,
      settingsOverlay,
      settingsButton,
      hudGarageButton,
      settingsEyebrow,
      settingsSfxVolumeControl,
      settingsMusicVolumeControl,
      spawnCheatButton,
      skipWaveInput,
      settingsStatus,
    };
  }

  private setSettingsOpen(open: boolean): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.settingsOpen = open;
    this.settingsOverlay.hidden = !open;
    this.settingsEyebrow.textContent = `Wave ${this.currentWave}`;
    this.syncVolumeControls();
    this.settingsButton.setAttribute('aria-expanded', String(open));
    this.spawnCheatButton.disabled = this.phase !== 'active';
    if (open) this.skipWaveInput.value = String(this.currentWave);
    this.keys.clear();
    this.pointerFiring = false;
    this.controls.fire = false;
    this.controls.manualAim = false;
    // The dialog owns the screen while it is up: the driving overlay sits over
    // it and would eat every tap aimed at a setting, and a thumb that was on
    // the stick when it opened never delivers its pointerup.
    this.touchBraking = false;
    this.touch?.reset();
    this.touch?.setVisible(!open);
    this.mobileHud.setCompact(open);
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.syncGameplayActivity();
  }

  private unlockAudioFromInput(): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    unlockAudio();
  }

  private syncVolumeControls(): void {
    const sfxPercent = Math.round(getSfxVolume() * 100);
    const musicPercent = Math.round(getMusicVolume() * 100);
    this.settingsSfxVolumeControl.setPercent(sfxPercent);
    this.settingsMusicVolumeControl.setPercent(musicPercent);
  }

  private syncGameplayActivity(): void {
    // A coach freeze is deliberately *not* a gameplay break. Each card lasts a
    // second or two and there are five of them, so reporting every one would
    // strobe the platform SDK through ten state changes in the opening minute
    // for no benefit to the player.
    this.callbacks.onGameplayActiveChanged?.(
      !this.settingsOpen &&
        (this.phase === 'countdown' || this.phase === 'active'),
    );
  }

  /**
   * Put the HUD where the First Play coach says it should be.
   *
   * Everything here is derived from the coach rather than tracked separately,
   * so it is safe to call on any change and idempotent when nothing moved. A
   * run without a coach reveals everything, which is the ordinary HUD.
   */
  private syncFirstPlayHud(): void {
    const coach = this.firstPlay;
    const healthUp = coach === null || coach.isRevealed('health');
    const timelineUp = coach === null || coach.isRevealed('waveTimeline');
    this.healthPanel.hidden = !healthUp;
    this.waveTimelineHud.root.hidden = !timelineUp;
    this.healthPanel.classList.toggle(
      'is-first-play-spotlight',
      coach?.isSpotlighting('health') === true,
    );
    this.waveTimelineHud.root.classList.toggle(
      'is-first-play-spotlight',
      coach?.isSpotlighting('waveTimeline') === true,
    );
  }

  /**
   * Feed an input to the coach. A no-op outside the tutorial, and it never
   * consumes the press: the key that dismisses the driving card is the same
   * key that drives on the very next step.
   */
  private notifyFirstPlay(input: FirstPlayInput): void {
    this.firstPlay?.notifyInput(input);
  }

  /**
   * Offer the coach whatever is *still* held while a card is up.
   *
   * The press handlers only see edges, and half of what the coach asks for is
   * something the player was already doing when the card arrived: W held down
   * from the previous lesson, the fire button held on a crowd, a thumb parked
   * on the joystick. Without this the card waits for a release-and-repress the
   * player has no reason to perform. The coach applies a longer grace to these
   * so the line is still read.
   */
  private pollHeldFirstPlayInput(): void {
    const coach = this.firstPlay;
    if (coach === null) return;
    if (this.touch?.stick.active === true) coach.notifyInput('drive', true);
    if (this.pointerFiring) coach.notifyInput('fire', true);
    for (const key of this.keys) {
      coach.notifyInput(DRIVE_KEYS.has(key) ? 'drive' : 'other', true);
    }
  }

  private readonly onSfxVolumeInput = (): void => {
    if (this.disposed) return;
    this.unlockAudioFromInput();
    setSfxVolume(Number(this.settingsSfxVolumeControl.input.value) / 100);
    this.syncVolumeControls();
  };

  private readonly onMusicVolumeInput = (): void => {
    if (this.disposed) return;
    this.unlockAudioFromInput();
    setMusicVolume(Number(this.settingsMusicVolumeControl.input.value) / 100);
    this.syncVolumeControls();
  };

  private readonly onSpawnEveryZombie = (): void => {
    if (this.disposed || this.phase !== 'active') return;
    const spawned = this.waves.spawnBonusHorde([
      'walker',
      'gunslinger',
      'necromancer',
      'thrower',
      'worker',
      'phone-addict',
      'kamikaze',
      'behemoth',
      'zamboni',
    ]);
    this.settingsStatus.textContent =
      spawned === 9
        ? 'Spawned a Walker, Gunslinger, Necromancer, Ranged, Worker, Phone User, Kamikaze, Behemoth, and Zamboni.'
        : `Spawned ${spawned} of 9 zombies — clear some room and try again.`;
  };

  private readonly onInfiniteMoney = (): void => {
    if (this.disposed) return;
    this.callbacks.onCheatInfiniteMoney();
    this.lastHudCash = -1;
    this.settingsStatus.textContent = 'Money set to the maximum safe amount.';
  };

  private readonly onSkipToWave = (): void => {
    if (this.disposed || this.phase === 'gameOver') return;
    const requested = Math.floor(Number(this.skipWaveInput.value));
    const wave = Number.isFinite(requested) ? Math.max(1, requested) : 1;
    this.debugStartWave(wave);
    this.settingsEyebrow.textContent = `Wave ${this.currentWave}`;
    this.skipWaveInput.value = String(this.currentWave);
    this.settingsStatus.textContent = `Jumped to Wave ${this.currentWave}.`;
  };

  private onResetWave(): void {
    if (this.disposed) return;
    this.discardPendingWaveRewards();
    this.damageNumbers?.clear();
    this.callbacks.onResetWave(this.currentRunState());
  }

  /**
   * Bail out of a live wave into the Garage. The wave is abandoned rather than
   * cleared, so this rewinds to the same checkpoint "Reset Wave" uses instead
   * of taking the cleared-wave path that advances the wave counter.
   */
  private onReturnToGarage(): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.damageNumbers?.clear();
    // A sandbox bench trip is not an abandoned wave: the loop is build, test,
    // change something, test again, and rewinding to the wave's start would
    // undo the fight the player stepped out of to think about. The live wave
    // and the live vehicle go back with them, so deploying again picks up
    // exactly where they left rather than restarting.
    if (this.mode.midRunGarage) {
      const payload = this.clearedWavePayload();
      this.callbacks.onReturnToGarage({
        ...payload.clearedRun,
        partHp: payload.partHp,
      });
      return;
    }
    this.discardPendingWaveRewards();
    this.callbacks.onReturnToGarage(this.currentRunState());
  }

  private onSaveAndQuit(): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.discardPendingWaveRewards();
    this.callbacks.onSaveAndQuit({
      wave: this.currentWave,
      kills: this.kills,
      score: this.runScore,
    });
  }

  private readonly onNextWave = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const payload = this.clearedWavePayload();
    this.beginCountdown(payload.nextRun.wave);
    this.callbacks.onWaveAdvance(
      payload.nextRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
      payload.score,
    );
  };

  /**
   * Priced from the live vehicle rather than the checkpoint: "Continue Now"
   * carries the live rig straight into the next wave, so that is what the
   * player is actually paying to fix.
   *
   * It is a genuinely full repair, so it prices the holes as well as the
   * dents: every block torn off this wave, plus anything still missing from an
   * earlier one, is bought back at shelf price. Quoting only the surviving
   * parts made the card read as "you are whole again" while the rig went into
   * the next wave a wheel down.
   */
  private repairQuote(): WaveClearRepairOffer | null {
    const items: Parameters<typeof repairPlan>[0] = [];
    let rebuildCost = 0;
    let rebuiltParts = 0;
    for (const [id, part] of this.vehicle.assembled.parts) {
      const baseCost = getPartDef(part.placed.defId).cost;
      if (!part.alive || part.detached) {
        rebuildCost += baseCost;
        rebuiltParts += 1;
        continue;
      }
      items.push({
        id,
        baseCost,
        currentHp: Math.max(0, part.health),
        maxHp: part.def.health,
      });
    }
    // Blocks lost in an earlier wave and never bought back are App's to price:
    // they left the blueprint, so this mode has never seen them.
    const carried = this.callbacks.missingPartsQuote?.() ?? {
      cost: 0,
      count: 0,
    };
    rebuildCost += Math.max(0, carried.cost);
    rebuiltParts += Math.max(0, carried.count);

    const totalCost = repairPlan(items).totalCost + rebuildCost;
    if (totalCost <= 0) return null;
    return {
      cost: totalCost,
      affordable: this.callbacks.profileMoney() >= totalCost,
      rebuiltParts,
    };
  }

  private readonly onRepairAndContinue = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const quote = this.repairQuote();
    if (quote === null || !quote.affordable) return;
    if (quote.rebuiltParts > 0) {
      // Bolting blocks back onto a live Rapier rig is not a thing this mode
      // can do: their colliders are gone and their meshes with them. So the
      // rebuild hands off to App, which commits the cleared wave, restores the
      // parts into the checkpoint, and redeploys onto the whole rig.
      const payload = this.clearedWavePayload();
      this.threatAlert.hide();
      this.waveClearCard.hide();
      this.callbacks.onFullRepairRebuild(
        quote.cost,
        payload.clearedRun,
        payload.survivingPartIds,
        payload.partHp,
        payload.kills,
        payload.score,
      );
      return;
    }
    // Charge first: if the wallet says no, nothing is healed.
    if (!this.callbacks.onRepairAll(quote.cost)) return;
    this.repairLiveVehicle();
    this.onNextWave();
  };

  private repairLiveVehicle(): void {
    for (const [, part] of this.vehicle.assembled.parts) {
      if (!part.alive || part.detached) continue;
      part.health = part.def.health;
    }
    // Structural joints wear down alongside the parts they hold. Leaving them
    // damaged would let a "fully repaired" rig shed parts on the next impact.
    for (const connection of this.vehicle.assembled.connections) {
      if (connection.health > 0) connection.health = 1;
    }
  }

  private readonly onGoToGarage = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const payload = this.clearedWavePayload();
    this.threatAlert.hide();
    this.waveClearCard.hide();
    this.callbacks.onBuildPhase(
      payload.clearedRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
      payload.score,
    );
  };

  private clearedWavePayload(): WaveClearPayload {
    return createWaveClearPayload(
      this.currentWave,
      this.vehicle.survivingPartIds(),
      this.vehicle.partHpSnapshot(),
      this.kills,
      this.runScore,
      this.runElapsedSeconds,
    );
  }

  private readonly onAim = (event: PointerEvent): void => {
    this.aimAtClientPoint(event.clientX, event.clientY);
  };

  /**
   * Point the manual turrets at a viewport pixel.
   *
   * Shared by the mouse and the touch aim pad: both produce a client-space
   * point, and everything downstream — the ground-plane raycast, the aim yaw,
   * the shared aim point every turret fires at — is identical either way.
   */
  private aimAtClientPoint(clientX: number, clientY: number): void {
    if (this.phase !== 'active' || this.settingsOpen) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.aimRaycaster.setFromCamera(this.pointerNdc, this.camera);
    if (!this.aimRaycaster.ray.intersectPlane(this.aimPlane, this.aimPoint))
      return;
    const position = this.vehicle.body.translation();
    this.controls.aimYawWorld = Math.atan2(
      this.aimPoint.x - position.x,
      this.aimPoint.z - position.z,
    );
    // Every turret fires at this point while the override is held, so the
    // barrel and the shot agree with the reticle.
    this.controls.aimPoint = this.aimPoint;
  }

  /**
   * World yaw the stick is pointing at, in the `atan2(x, z)` convention the
   * rest of the game uses.
   *
   * Derived from the live camera basis rather than a constant, so it stays
   * correct if the follow rig's offset is ever retuned: the ground-plane
   * projections of the camera's forward and right axes are what "up" and
   * "right" mean to the player looking at the screen.
   */
  private stickYawWorld(x: number, y: number): number {
    this.camera.getWorldDirection(this.stickForward);
    this.stickForward.y = 0;
    if (this.stickForward.lengthSq() < 1e-6) this.stickForward.set(0, 0, 1);
    this.stickForward.normalize();
    // Screen-right on the ground plane: forward x worldUp. Check it against the
    // Three.js default of looking down -Z, which must give +X.
    this.stickRight.set(-this.stickForward.z, 0, this.stickForward.x);
    this.stickHeading
      .copy(this.stickRight)
      .multiplyScalar(x)
      .addScaledVector(this.stickForward, y);
    return Math.atan2(this.stickHeading.x, this.stickHeading.z);
  }

  /** The rig's heading. Vehicles face local +Z, so the axis is rotated and read. */
  private vehicleYawWorld(): number {
    const rotation = this.vehicle.body.rotation();
    this.stickQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.stickHeading.set(0, 0, 1).applyQuaternion(this.stickQuaternion);
    return Math.atan2(this.stickHeading.x, this.stickHeading.z);
  }

  /**
   * Build or tear down the on-screen controls to match the current device.
   *
   * Called at construction and again whenever the primary pointer changes — a
   * tablet gaining a keyboard should get its screen back, and a desktop
   * browser must never be handed an invisible input shield over the arena.
   */
  private syncTouchControls(): void {
    const wanted = shouldUseTouchControls();
    if (wanted === (this.touch !== null)) return;
    if (!wanted) {
      this.touch?.dispose();
      this.touch = null;
      this.touchBraking = false;
      this.pointerFiring = false;
      return;
    }
    const touch = new TouchControls({
      parent: this.ui,
      buttons: [
        { id: 'brake', glyph: '▤', label: 'Handbrake', mode: 'hold' },
        { id: 'recover', glyph: '↻', label: 'Right the vehicle', mode: 'tap' },
      ],
      onButton: (id, pressed) => this.onTouchButton(id, pressed),
      onAim: (sample) => this.aimAtClientPoint(sample.clientX, sample.clientY),
      onFireChange: (firing) => {
        this.unlockAudioFromInput();
        if (this.phase !== 'active' || this.settingsOpen) return;
        this.pointerFiring = firing;
        // A tap on the arena is also how a signature strike is called down on
        // desktop, and the two inputs must not disagree about that.
        if (firing) this.signatureRequested = true;
        if (firing) this.notifyFirstPlay('fire');
      },
    });
    // First child, so the full-screen input zones stay underneath every HUD
    // panel: an ability box or a prompt card must win the tap that lands on it.
    this.ui.prepend(touch.element);
    // Recovery is offered only while the rig is actually stuck; the stuck
    // detector turns it back on every frame it applies.
    touch.setButtonVisible('recover', false);
    touch.setVisible(true);
    this.touch = touch;
  }

  /** Route a touch button to the same request path its keybind uses. */
  private onTouchButton(id: string, pressed: boolean): void {
    this.unlockAudioFromInput();
    if (id === 'brake') {
      this.touchBraking = pressed;
      return;
    }
    if (!pressed) return;
    if (id === 'recover') {
      // Same queue as `J`: honoured on the next fixed step, or dropped there if
      // the rig is not actually stuck.
      this.recoveryRequested = true;
    }
  }

  private readonly onFireDown = (event: PointerEvent): void => {
    this.unlockAudioFromInput();
    if (this.phase !== 'active' || this.settingsOpen || event.button !== 0)
      return;
    this.pointerFiring = true;
    // The same click both pulls the turrets onto the cursor and calls the
    // signature strike down on it. Queued rather than fired here so the strike
    // resolves inside the fixed step with everything else.
    this.signatureRequested = true;
    this.notifyFirstPlay('fire');
  };

  private readonly onFireUp = (): void => {
    this.pointerFiring = false;
  };

  update(dtMs?: number): void {
    if (this.disposed) return;
    const now = performance.now();
    let frameDt =
      dtMs === undefined ? (now - this.lastTime) / 1000 : dtMs / 1000;
    this.lastTime = now;
    if (this.settingsOpen) {
      this.syncView(0);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.debugPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // Time stop. The coach's cards are read over a genuinely stopped arena —
    // nothing steps, nothing animates, the crowd hangs mid-stride — so a new
    // player is never asked to read while something is closing on them. Zero
    // delta rather than an early return so the frame is still drawn.
    if (this.firstPlay?.isFrozen() === true) {
      this.pollHeldFirstPlayInput();
      this.syncView(0);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    frameDt = Math.min(Math.max(frameDt, 0), 0.1);
    if (this.devPanel) {
      // God mode and time scale are read live so they need no per-edit wiring.
      this.vehicle.invulnerable = devTuning.cheats.godMode;
      this.waves.setSpawnPaused(devTuning.cheats.freezeSpawns);
      frameDt *= Math.max(0, devTuning.cheats.timeScale);
      this.devPanel.refreshReadout();
    }
    this.accumulator += frameDt;

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.stepFixed();
      if (this.pendingTransition !== null) break;
    }
    this.syncArenaLoading();
    this.syncView(frameDt);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  private stepFixed(): void {
    // The scuttle charge owns the frame while it plays: the wave, the physics,
    // and the run's outcome all wait for the blast to finish.
    if (this.selfDestructHoldSeconds > 0) {
      this.tickSelfDestructHold();
      return;
    }
    if (this.phase === 'countdown') {
      // Hold the whole countdown — and with it the wave — until the arena is
      // actually standing. Timing out rather than waiting forever: a prop that
      // never arrives leaves a placeholder, not a stuck run.
      if (!this.arenaReady) {
        this.arenaLoadSeconds += FIXED_DT;
        if (this.arenaLoadSeconds >= ARENA_LOAD_TIMEOUT_SECONDS) {
          this.markArenaReady();
        }
        return;
      }
      this.countdownRemaining -= FIXED_DT;
      if (this.countdownRemaining <= 0) this.startCurrentWave();
    } else if (this.phase === 'active') {
      this.stepPhysics();
    }
  }

  private stepPhysics(): void {
    this.refreshSelfDestructArmed();
    if (this.selfDestructRequested) {
      this.selfDestructRequested = false;
      // Re-checked against live state rather than trusted from the press: the
      // wave can clear or the rig can die between the keydown and this step.
      if (this.selfDestructArmed && this.phase === 'active') {
        this.detonateSelfDestruct();
        return;
      }
    }
    this.waveElapsedSeconds += FIXED_DT;
    this.runElapsedSeconds += FIXED_DT;
    // Arena time, not wall clock: the gap between two lessons is measured in
    // the seconds the player actually spends driving.
    this.firstPlay?.fixedUpdate(FIXED_DT);
    this.updateControls();
    this.updateRecoveryAssist(FIXED_DT);
    this.updateAbility();
    this.updateFlameLance();
    this.updateSignature();
    this.controls.weaponAim = this.autoAim.step();
    this.vehicle.preStep(
      FIXED_DT,
      this.controls,
      (colliderHandle) => this.arena.surfaceOf(colliderHandle),
      this.biomeEnvironment,
      (point) => this.zombies.hazardMuAt(point.x, point.z),
    );
    const driveTelemetry = this.vehicle.telemetry();
    syncDriveSfx({
      speedKmh: driveTelemetry.speedKmh,
      throttle: this.controls.throttle,
      groundedWheels: driveTelemetry.groundedWheels,
      wheelSlip: driveTelemetry.wheelSlip,
      terrain: this.terrainSfx,
    });

    this.pickups.step(FIXED_DT);
    this.waves.fixedUpdate(FIXED_DT);
    this.zombies.step(FIXED_DT);
    this.flushMeleeHit();
    // After the zombies moved, so a sentry shoots where they are now. It also
    // runs after the pickup pass, so a sentry crate collected this step gets
    // its first shot off on the same step it was taken.
    this.sentries.step(FIXED_DT);
    // After the zombie step, so a pass sees the projectiles as they are right
    // now rather than one frame's travel behind them.
    this.updateDroneInterceptors();

    this.world.step(this.eventQueue);
    this.vehicle.postStepStability(FIXED_DT);
    this.eventQueue.drainContactForceEvents((event) => {
      const force = event.totalForceMagnitude();
      const hitScenery =
        this.arena.isObstacle(event.collider1()) ||
        this.arena.isObstacle(event.collider2());
      if (hitScenery) playSceneryImpactSfx(force);
      else playImpactSfx(force);
      this.vehicle.onContactForce(event.collider1(), force);
      this.vehicle.onContactForce(event.collider2(), force);
    });

    const shots = this.vehicle.shotsThisStep();
    // Flame burns every zombie in the cone, so its hits arrive by the dozen:
    // one cue for the whole volley instead of one per body caught in the fire.
    let burnAnnounced = false;
    for (const shot of shots) {
      const missed = shot.hitZombieHandle === null && !shot.hitSurface;
      this.shotDirection.set(
        shot.to.x - shot.from.x,
        shot.to.y - shot.from.y,
        shot.to.z - shot.from.z,
      );
      if (this.shotDirection.lengthSq() > 1e-8) this.shotDirection.normalize();
      if (!shot.damageOnly) {
        playWeaponSfx(shot.weaponDefId, { overcharged: shot.overcharged });
        this.showTracer(shot, missed);
        this.emitShotVfx(shot);
      }
      this.detonateShell(shot);
      if (shot.hitZombieHandle === null) continue;
      if (!shot.damageOnly || !burnAnnounced) {
        this.scopeCursor.flashHit('hit');
        burnAnnounced ||= shot.damageOnly;
      }
      const pierceContinues = applyZombieShot(
        this.zombies,
        shot,
        this.shotDirection,
      );
      if (pierceContinues && shot.pierceTo !== null) {
        this.tracerRenderer.spawn(
          shot.to,
          shot.pierceTo,
          tracerStyleForWeapon(shot.weaponDefId),
          tracerOptionsForShot(shot, false, true),
        );
      }
    }

    const newIslands = this.vehicle.finishStep();
    if (newIslands.length > 0) playSfx('partBreak');
    this.attachNewIslands(newIslands);
    this.trackDamageTaken();
    this.queueCompletedStepTransition();
  }

  /**
   * Explosive shells (Heavy Cannon): damage everything around the point of
   * impact, then play the blast and kick the camera. The zombie the shell hit
   * directly is excluded — `applyZombieShot` already charges it full damage,
   * and the splash is what the *rest* of the crowd takes.
   *
   * A miss still detonates: shells that land in dirt are the whole point of an
   * area weapon, and rewarding a near miss is what makes it feel heavy.
   */
  private detonateShell(shot: TracerShot): void {
    if (shot.splashRadiusM <= 0 || shot.splashDamage <= 0) return;
    this.zombies.explodeAt(
      shot.to.x,
      shot.to.y,
      shot.to.z,
      shot.splashRadiusM,
      shot.splashDamage,
      shot.hitZombieHandle,
    );
    this.vfx.shellBurst(shot.to.x, shot.to.y, shot.to.z, shot.splashRadiusM);
    playExplosionSfx({ gain: 0.3, playbackRate: 0.92 });
    this.shakeCameraAt(shot.to.x, shot.to.z, 0.9);
  }

  /**
   * Spend the step's melee contacts as one kick and one reticle confirm.
   *
   * Coalescing is the whole point: the drum in a packed horde reports a contact
   * per zombie, and both answers are things that must not stack — shakes add up
   * to the camera's ceiling, and `flashHit` forces a layout to restart its
   * keyframes. One per step is the same cadence a shot already gets.
   */
  private flushMeleeHit(): void {
    if (this.meleeHitForce <= 0) return;
    this.shakeCameraAt(
      this.meleeHitX,
      this.meleeHitZ,
      MELEE_SHAKE_STRENGTH * this.meleeHitForce,
    );
    this.scopeCursor.flashHit('hit');
    this.meleeHitForce = 0;
  }

  /**
   * Kick the camera for a blast at a world point, falling off with distance so
   * a shell across the graveyard registers without rattling the screen.
   */
  private shakeCameraAt(x: number, z: number, strength: number): void {
    const position = this.vehicle.body.translation();
    const distance = Math.hypot(x - position.x, z - position.z);
    const falloff = Math.max(0, 1 - distance / CAMERA_SHAKE_FALLOFF_M);
    if (falloff <= 0) return;
    this.followCamera.addShake(strength * falloff * falloff);
  }

  /**
   * Total health of every part still attached and alive. Losing a part drops
   * this by whatever health it had left, which is exactly the "that hurt"
   * signal the vignette wants.
   */
  private liveVehicleHealth(): number {
    let total = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      if (!part.alive || part.detached) continue;
      total += Math.max(0, part.health);
    }
    return total;
  }

  /** Feed this step's health loss to the damage vignette. */
  private trackDamageTaken(): void {
    const health = this.liveVehicleHealth();
    if (this.lastLiveHealth >= 0 && health < this.lastLiveHealth) {
      const damage = this.lastLiveHealth - health;
      this.warningHud.reportDamage(damage);
      playVehicleDamageSfx(damage);
    }
    this.lastLiveHealth = health;
  }

  private updateRecoveryAssist(dt: number): void {
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    this.recoverySettleSeconds = Math.max(0, this.recoverySettleSeconds - dt);
    const telemetry = this.vehicle.telemetry();
    const rotation = this.vehicle.body.rotation();
    const upright = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const tryingToMove =
      this.controls.throttle > 0 || (this.controls.reverse ?? 0) > 0;
    const stalled =
      tryingToMove && telemetry.speedKmh < 3 && telemetry.groundedWheels > 0;
    const tipped = upright < 0.35;
    if (stalled || tipped) this.stuckSeconds += dt;
    else this.stuckSeconds = Math.max(0, this.stuckSeconds - dt * 2);

    const canRecover =
      this.stuckSeconds >= STUCK_PROMPT_SECONDS && this.recoveryCooldown <= 0;
    this.stuckPrompt.classList.toggle('is-visible', canRecover);
    // The prompt is a status card, not a button, and there is no `J` key to
    // press on a phone — so on touch the recovery button appears and vanishes
    // with it rather than sitting in the cluster permanently greyed out.
    this.touch?.setButtonVisible('recover', canRecover);
    if (this.recoverySettleSeconds > 0) this.applyRecoveryControlLock();
    if (!this.recoveryRequested) return;
    this.recoveryRequested = false;
    if (!canRecover) return;
    this.performRecoveryJump();
  }

  private performRecoveryJump(): void {
    playSfx('vehicleRecover');
    const body = this.vehicle.body;
    this.vehicle.resetRecoveryState();
    const mass = Math.max(1, body.mass());
    const rotation = body.rotation();
    this.recoveryQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // Preserve the car's heading while rotating most of the way back toward
    // world-up. The jump finishes the reset physically instead of adding spin
    // to whatever roll/pitch momentum the crash left behind.
    this.recoveryForward.set(0, 0, 1).applyQuaternion(this.recoveryQuaternion);
    this.recoveryForward.y = 0;
    if (this.recoveryForward.lengthSq() < 1e-5) {
      this.recoveryForward.set(0, 0, 1);
    } else {
      this.recoveryForward.normalize();
    }
    this.recoveryTargetQuaternion.setFromAxisAngle(
      this.wheelSteerAxis,
      Math.atan2(this.recoveryForward.x, this.recoveryForward.z),
    );
    this.recoveryQuaternion.slerp(this.recoveryTargetQuaternion, 0.9);
    const translation = body.translation();
    this.recoveryTranslation.x = translation.x;
    this.recoveryTranslation.y = translation.y + 0.75;
    this.recoveryTranslation.z = translation.z;
    body.setTranslation(this.recoveryTranslation, true);
    body.setRotation(
      {
        x: this.recoveryQuaternion.x,
        y: this.recoveryQuaternion.y,
        z: this.recoveryQuaternion.z,
        w: this.recoveryQuaternion.w,
      },
      true,
    );

    this.recoveryVelocity.x = 0;
    this.recoveryVelocity.y = 0;
    this.recoveryVelocity.z = 0;
    body.setLinvel(this.recoveryVelocity, true);
    this.recoveryAngularVelocity.x = 0;
    this.recoveryAngularVelocity.y = 0;
    this.recoveryAngularVelocity.z = 0;
    body.setAngvel(this.recoveryAngularVelocity, true);

    this.recoveryImpulse.x = 0;
    this.recoveryImpulse.y = mass * 5.25;
    this.recoveryImpulse.z = 0;
    body.applyImpulse(this.recoveryImpulse, true);
    this.recoverySettleSeconds = RECOVERY_SETTLE_SECONDS;
    this.applyRecoveryControlLock();
    this.stuckSeconds = 0;
    this.recoveryCooldown = RECOVERY_COOLDOWN_SECONDS;
    this.stuckPrompt.classList.remove('is-visible');
  }

  private applyRecoveryControlLock(): void {
    this.controls.throttle = 0;
    this.controls.reverse = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
  }

  /**
   * Take the rig's momentum and its controls away for `seconds`. The velocity
   * is killed here, once, rather than being held at zero for the duration —
   * the car should be dead in the water and then shoved around by whatever
   * hits it next, not pinned in place. A second blast landing inside an
   * existing stun extends it rather than restarting a shorter one.
   */
  private applyStun(seconds: number): void {
    if (this.phase !== 'active' || !(seconds > 0)) return;
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    playSfx('uiDeny');
  }

  private updateControls(): void {
    if (this.stunTimer > 0 && this.phase === 'active') {
      this.stunTimer = Math.max(0, this.stunTimer - FIXED_DT);
      // Full brake, no steering, no throttle — but the guns are left on their
      // own inputs so the player is stranded rather than defenceless.
      this.controls.throttle = 0;
      this.controls.reverse = 0;
      this.controls.brake = 1;
      this.controls.steer = 0;
      this.controls.fire = this.keys.has('f') || this.pointerFiring;
      this.controls.manualAim =
        this.controls.fire && this.controls.aimPoint !== undefined;
      return;
    }
    if (this.phase !== 'active') {
      this.controls.throttle = 0;
      this.controls.reverse = 0;
      this.controls.brake = 1;
      this.controls.steer = 0;
      this.controls.fire = false;
      this.controls.manualAim = false;
      return;
    }

    const forwardSpeed = this.vehicle.forwardSpeed();
    const stick = this.touch?.stick;
    if (stick?.active) {
      // Steer toward where the stick points rather than mapping stick-x onto
      // the front wheels. The follow camera never rotates with the rig, so once
      // the car has come about, screen-left and driver-left are opposites and
      // every correction the player makes is backwards. The handbrake button
      // still wins: holding brake meant brake, stick or no stick.
      const drive = driveTowardHeading(
        stick,
        this.stickYawWorld(stick.x, stick.y),
        this.vehicleYawWorld(),
        forwardSpeed,
      );
      this.controls.throttle = drive.throttle;
      this.controls.reverse = this.touchBraking ? 0 : drive.reverse;
      this.controls.brake = this.touchBraking ? 1 : drive.brake;
      this.controls.steer = drive.steer;
      this.controls.brake = brakeInputWithAutoHold(this.controls, forwardSpeed);
      this.controls.fire = this.pointerFiring;
      this.controls.manualAim =
        this.controls.fire && this.controls.aimPoint !== undefined;
      return;
    }
    if (this.touch) {
      // Touch device, thumb off the stick: coast rather than falling through to
      // a keyboard read that can only ever return neutral anyway.
      this.controls.throttle = 0;
      this.controls.reverse = 0;
      this.controls.steer = 0;
      this.controls.brake = this.touchBraking ? 1 : 0;
      this.controls.brake = brakeInputWithAutoHold(this.controls, forwardSpeed);
      this.controls.fire = this.pointerFiring;
      this.controls.manualAim =
        this.controls.fire && this.controls.aimPoint !== undefined;
      return;
    }

    const forward = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const reverse = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    // S brakes while rolling forward, reverses once (near-)stopped.
    const movingForward = forwardSpeed > 0.6;
    this.controls.throttle = forward;
    this.controls.reverse = reverse && !forward && !movingForward ? 1 : 0;
    this.controls.brake = this.keys.has(' ')
      ? 1
      : reverse && movingForward
        ? 1
        : 0;
    this.controls.brake = brakeInputWithAutoHold(this.controls, forwardSpeed);
    this.controls.steer =
      (this.keys.has('a') || this.keys.has('arrowleft') ? -1 : 0) +
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0);
    this.controls.fire = this.keys.has('f') || this.pointerFiring;
    // Guns hunt on their own; holding fire takes them off their own targets
    // and puts every one of them on the cursor. It needs a sampled cursor
    // point to aim at, so before the first pointer move the guns keep hunting.
    this.controls.manualAim =
      this.controls.fire && this.controls.aimPoint !== undefined;
  }

  /**
   * The mesh drawing one block, wherever it currently lives. A block that has
   * broken off is no longer under `vehicleGroup` — `attachNewIslands` moved it
   * into that island's own group and dropped its wheel-mesh entry — so a
   * lookup that only searched the rig left the wreckage of a chunk that died
   * after it detached standing in the arena for the rest of the run.
   */
  private findPartMesh(partId: string): THREE.Object3D | undefined {
    const mesh = this.vehicleGroup.getObjectByName(`part:${partId}`);
    if (mesh) return mesh;
    const wheelMesh = this.wheelMeshes.get(partId);
    if (wheelMesh) return wheelMesh;
    for (const group of this.islandGroups.values()) {
      const detached = group.getObjectByName(`part:${partId}`);
      if (detached) return detached;
    }
    return undefined;
  }

  private attachNewIslands(
    islands: ReturnType<RuntimeVehicle['finishStep']>,
  ): void {
    for (const island of islands) {
      const group = new THREE.Group();
      const position = island.body.translation();
      const rotation = island.body.rotation();
      group.position.set(position.x, position.y, position.z);
      group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.scene.add(group);
      group.updateMatrixWorld(true);
      for (const partId of island.partIds) {
        const mesh = this.vehicleGroup.getObjectByName(`part:${partId}`);
        if (mesh) {
          this.vehicleGroup.remove(mesh);
          group.add(mesh);
        }
        const wheelMesh = this.wheelMeshes.get(partId);
        if (wheelMesh) {
          this.wheelMeshes.delete(partId);
          this.wheelSpin.delete(partId);
          group.attach(wheelMesh);
        }
      }
      this.islandGroups.set(island.body.handle, group);
    }
  }

  /**
   * Drop the loading scrim and let the countdown run.
   *
   * Reached either by the arena reporting itself complete or by the gate timing
   * out, and safe to call twice because both can happen in a slow enough load.
   */
  private markArenaReady(): void {
    if (this.arenaReady || this.disposed) return;
    this.arenaReady = true;
    this.arenaLoadingFill.style.width = '100%';
    this.arenaLoadingOverlay.style.opacity = '0';
    this.arenaLoadingOverlay.style.pointerEvents = 'none';
    // Left in the tree behind `hidden` rather than removed: the same overlay is
    // reused if this mode ever rebuilds its arena.
    window.setTimeout(() => {
      if (!this.disposed) this.arenaLoadingOverlay.hidden = true;
    }, 260);
    if (this.phase === 'countdown') {
      this.countdownOverlay.style.display = 'block';
    }
  }

  /** Drive the loading bar from the arena's settled-placement count. */
  private syncArenaLoading(): void {
    if (this.arenaReady) return;
    const { loaded, total } = this.arena.progress();
    // An arena with nothing to stream still shows a full bar for the frame it
    // takes to notice, which reads better than a bar stuck at zero.
    const fraction = total === 0 ? 1 : loaded / total;
    this.arenaLoadingFill.style.width = `${(fraction * 100).toFixed(1)}%`;
  }

  private beginCountdown(wave: number): void {
    // Any lesson still open belongs to the wave being left. `active` is false
    // for a coach that has not started yet, which is what the construction-time
    // call into here relies on.
    if (this.firstPlay?.active === true) this.firstPlay.finish();
    this.setCurrentWave(wave);
    this.phase = 'countdown';
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastCountdownSecond = -1;
    this.pointerFiring = false;
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.keys.clear();
    this.stuckSeconds = 0;
    this.recoverySettleSeconds = 0;
    this.recoveryRequested = false;
    // The charge stays armed across waves — the wheel is still gone — but a
    // press made during the last wave never carries into this one.
    this.selfDestructRequested = false;
    // Each wave is its own fight: abilities come back charged for it.
    this.abilityCooldowns.clear();
    this.abilityRequests.clear();
    // Nobody starts a wave still stunned by the last one's boulder.
    this.stunTimer = 0;
    // The signature block recharges with them, and anything still in the air
    // is dropped rather than carried over — a shell fired at the last zombie
    // of the previous wave must not land on the first of this one.
    this.signatureCooldown = 0;
    this.signatureRequested = false;
    this.strikes.clear();
    this.flameLanceSeconds = 0;
    this.flameLanceDuration = 0;
    this.flameLanceStats = null;
    this.stuckPrompt.classList.remove('is-visible');
    this.threatAlert.hide();
    this.waveClearCard.hide();
    this.damageNumbers?.clear();
    // While the arena is still building the loading scrim owns the screen, so
    // the countdown card waits behind it rather than counting down over it.
    this.countdownOverlay.style.display = this.arenaReady ? 'block' : 'none';
    this.syncGameplayActivity();
  }

  private setCurrentWave(wave: number): void {
    const nextWave = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
    if (
      this.currentWave === nextWave &&
      this.biomeEnvironmentWave === nextWave
    ) {
      return;
    }

    this.currentWave = nextWave;
    const intensity = hazardIntensity(this.biomeHazard, nextWave);
    this.biomeEnvironment = combineEnvironments(
      this.biomeDrive,
      hazardEnvironment(this.biomeHazard, intensity),
    );
    this.arena.setHazardFog(intensity);
    this.biomeEnvironmentWave = nextWave;
  }

  private startCurrentWave(): void {
    this.phase = 'active';
    this.countdownOverlay.style.display = 'none';
    playSfx('waveStart');
    this.resetWaveStats();
    this.waves.startWave(this.currentWave);
    // Only now: the coach freezes the world, and freezing the countdown would
    // leave a player staring at a card over a "3" that never becomes a "1".
    this.firstPlay?.begin();
    this.syncGameplayActivity();
  }

  private resetWaveStats(): void {
    this.waveStartKills = this.kills;
    this.waveMoneyEarned = 0;
    this.waveBadgeBonusEarned = 0;
    this.waveElapsedSeconds = 0;
    this.waveStartIntegrityPct = this.vehicle.integrityPct();
    // A fresh wave starts on clean ground rather than inheriting the last
    // wave's airborne gibs and settled splats.
    this.vfx.reset();
    this.tracerRenderer.reset();
    this.phaseGhosts.clear();
    this.threatPointer.reset();
    // Re-baseline damage tracking: carried-over wave damage is not a new hit.
    this.lastLiveHealth = -1;
    this.warningRefreshSeconds = 0;
  }

  private handleZombieKilled(reward: number, kind: ZombieKind): void {
    this.kills++;
    if (!this.debugProgressionSuppressed) {
      this.scopeCursor?.flashHit('kill');
      this.runScore = addScore(
        this.runScore,
        killScore(kind, this.currentWave),
      );
    }
    if (kind === 'phone-addict' && !this.debugProgressionSuppressed) {
      this.phoneAddictKills++;
      this.callbacks.onPhoneAddictKilled();
    }
    this.addPendingWaveKillReward(reward);
    this.waves.recordZombieKilled();
  }

  /**
   * An endless run rolled into its next wave without pausing.
   *
   * This is the cleared-wave bookkeeping with everything that would interrupt
   * the fight taken out: the score and the clear bonus are paid, the wave
   * readout moves, and play continues. No phase change, no clear card, no
   * garage — and no clearing of landmines, trails or sentries, because those
   * belong to a fight that is still going on.
   */
  private onEndlessWaveAdvanced(wave: number, reward: number): void {
    if (this.phase === 'gameOver') return;
    if (!this.debugProgressionSuppressed) {
      this.runScore = addScore(this.runScore, waveClearScore(wave));
      // Creative runs are practice, so they never touch lifetime progression —
      // a sandbox with unlimited money must not be able to unlock anything.
      if (this.mode.scored) this.callbacks.onWaveCleared(wave);
    }
    // Paid straight into the wave's pending purse rather than parked in
    // `pendingWaveReward`, which the clear card owns and an endless run never
    // shows: left there, the next advance would overwrite it unbanked.
    this.addPendingWaveKillReward(
      Number.isSafeInteger(reward) && reward > 0 ? reward : 0,
    );
    this.setCurrentWave(wave + 1);
    this.showWaveBanner(wave + 1);
  }

  /**
   * Flash the new wave number over the fight. Restarting the animation needs
   * the element out of the document's animation list for a frame, which is what
   * the forced reflow between the class removal and its re-addition buys —
   * without it, two advances close together leave the second one silent.
   */
  private showWaveBanner(wave: number): void {
    window.clearTimeout(this.endlessBannerTimer);
    this.endlessWaveBanner.textContent = `WAVE ${wave}`;
    this.endlessWaveBanner.hidden = false;
    this.endlessWaveBanner.classList.remove('is-in');
    void this.endlessWaveBanner.offsetWidth;
    this.endlessWaveBanner.classList.add('is-in');
    this.endlessBannerTimer = window.setTimeout(() => {
      this.endlessWaveBanner.hidden = true;
    }, 1500);
  }

  private onWaveComplete(wave: number, reward: number): void {
    if (this.phase === 'gameOver') return;
    if (wave !== this.currentWave) this.setCurrentWave(wave);
    // Resolve the completed physics step before paying the clear bonus. If the
    // final zombie and vehicle die together, destruction wins consistently and
    // the uncleared wave is neither counted nor rewarded.
    this.pendingWaveReward =
      Number.isSafeInteger(reward) && reward > 0 ? reward : 0;
    if (!this.debugProgressionSuppressed) {
      this.runScore = addScore(this.runScore, waveClearScore(wave));
      this.callbacks.onWaveCleared(wave);
    }
    this.zombies.clearLandmines();
    this.zombies.clearIceTrail();
    this.zombies.clearAcidPuddles();
    this.zombies.clearGasTrail();
    // A dropped sentry belongs to the fight that dropped it; it does not stand
    // guard over an empty arena between waves.
    this.sentries.clear();
    fadeOutDriveSfx();
    this.phase = 'cleared';
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.stuckPrompt.classList.remove('is-visible');
    this.syncGameplayActivity();
  }

  private addPendingWaveKillReward(amount: number): void {
    if (
      this.phase !== 'active' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return;
    }
    const next = this.pendingWaveKillReward + amount;
    if (!Number.isSafeInteger(next)) return;
    this.pendingWaveKillReward = next;
    this.popCashGain(amount);
  }

  /**
   * The one number the corner shows: the whole wallet the player spends in the
   * garage, plus what this wave has earned but not yet banked. Run earnings are
   * already part of the profile balance, so this is the full total, not a
   * per-round tally.
   */
  private hudCashTotal(): number {
    const banked = this.callbacks.profileMoney();
    const pending =
      this.phase === 'active' || this.phase === 'cleared'
        ? this.pendingWaveTotal()
        : 0;
    // Clamp rather than reject: the infinite-money cheat parks the balance at
    // the safe-integer ceiling, and pending cash on top must not blank the HUD.
    const total = Math.min(banked + pending, Number.MAX_SAFE_INTEGER);
    return total > 0 ? Math.floor(total) : 0;
  }

  /**
   * Kicks the counter and floats the kill's payout off it. Each chit gets its
   * own scatter so a pack of kills throws a spray of numbers instead of laying
   * them on top of each other.
   */
  private popCashGain(amount: number): void {
    const now = performance.now();
    const merged = this.lastCashGain;
    if (merged && now - this.lastCashGainAt < CASH_GAIN_MERGE_MS) {
      merged.amount += amount;
      merged.element.textContent = `+$${merged.amount}`;
    } else {
      const chit = document.createElement('span');
      chit.className = 'survival-cash__gain';
      chit.textContent = `+$${amount}`;
      chit.style.setProperty(
        '--gain-drift',
        `${Math.round((Math.random() - 0.5) * 54)}px`,
      );
      chit.style.setProperty(
        '--gain-rise',
        `${-34 - Math.round(Math.random() * 20)}px`,
      );
      chit.addEventListener('animationend', () => {
        chit.remove();
        if (this.lastCashGain?.element === chit) this.lastCashGain = null;
      });
      this.cashGains.appendChild(chit);
      this.lastCashGain = { element: chit, amount };
    }
    this.lastCashGainAt = now;
    // Restart the kick even mid-animation: kills in quick succession should
    // each land, not be swallowed by the class already being set.
    this.cashCounter.classList.remove('is-hit');
    void this.cashCounter.offsetWidth;
    this.cashCounter.classList.add('is-hit');
  }

  private pendingWaveTotal(): number {
    const total = this.pendingWaveKillReward + this.pendingWaveReward;
    return Number.isSafeInteger(total) && total > 0 ? total : 0;
  }

  private discardPendingWaveRewards(): void {
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.lastHudCash = -1;
  }

  private bankPendingWaveRewards(): void {
    const total = this.pendingWaveTotal();
    if (total <= 0) {
      this.discardPendingWaveRewards();
      return;
    }
    this.discardPendingWaveRewards();
    this.waveMoneyEarned = 0;
    const credited = this.callbacks.onReward(total);
    if (Number.isSafeInteger(credited) && credited > 0) {
      this.waveMoneyEarned = credited;
    }
  }

  /** Pays the cleared wave's badge cash on top of the banked payout. */
  private creditBadgeBonus(bonus: number): void {
    this.waveBadgeBonusEarned = 0;
    if (!Number.isSafeInteger(bonus) || bonus <= 0) return;
    const credited = this.callbacks.onReward(bonus);
    if (!Number.isSafeInteger(credited) || credited <= 0) return;
    this.waveBadgeBonusEarned = credited;
    this.waveMoneyEarned += credited;
  }

  private currentRunState(): RunState {
    return { wave: this.currentWave, elapsedSeconds: this.runElapsedSeconds };
  }

  private queueCompletedStepTransition(): void {
    if (this.pendingTransition !== null) return;
    if (this.vehicle.isDestroyed()) {
      const pendingMoneyDiscarded = this.pendingWaveTotal();
      this.discardPendingWaveRewards();
      this.queueGameOver(pendingMoneyDiscarded);
    } else if (this.phase === 'cleared') {
      this.bankPendingWaveRewards();
      if (this.callbacks.onWaveCheckpoint) {
        const payload = this.clearedWavePayload();
        this.callbacks.onWaveCheckpoint(
          payload.nextRun,
          payload.survivingPartIds,
          payload.partHp,
          payload.kills,
          payload.score,
        );
      }
      this.stopVehicleMotion();
      if (this.firstPlay !== null) {
        this.celebrateFirstPlayWave();
        return;
      }
      this.showVictory();
    }
  }

  /**
   * End of the tutorial wave: a celebration, and one button out of it.
   *
   * Every other cleared wave earns a threat alert, a payout card and a
   * "Continue Now" button, and all three are wrong here. The rig the player
   * just drove is a demo they do not own and are about to give back, so there
   * is nothing to bank a repair against and no next wave to warn them about —
   * the only thing that happens next is picking the Build they will actually
   * play, which is why the celebration has exactly one exit. Badges are skipped
   * for the same reason: a wave fought on a rig with six engines and a Heavy
   * Cannon on it has not earned a NO DAMAGE stamp.
   *
   * The money is banked by the caller before this runs, so `waveMoneyEarned` is
   * the real, credited figure the card counts up to and the player walks into
   * the Garage holding.
   */
  private celebrateFirstPlayWave(): void {
    // Re-entry guard: the debug kill-all and the fixed step can both land on a
    // clear, and replaying the entrance would restart the fireworks over a card
    // the player is already reading.
    if (this.firstPlayVictory?.visible === true) return;
    this.firstPlay?.finish();
    this.fireCelebrationVfx();
    if (this.firstPlayVictory === null) {
      this.leaveFirstPlayWave();
      return;
    }
    // No `setCompact`: the celebration is a full-screen scrim over everything
    // the mobile layout would have been hiding, exactly like the wave-clear
    // card, and setting it here would fight the settings overlay for the flag.
    this.firstPlayVictory.show({
      kills: Math.max(0, this.kills - this.waveStartKills),
      cashEarned: this.waveMoneyEarned,
      elapsedSeconds: this.waveElapsedSeconds,
    });
  }

  /**
   * Fireworks over the rig, behind the celebration's scrim.
   *
   * The wave is over and `stepFixed` has stopped, but `syncView` keeps running
   * the VFX layer every frame, so pooled bursts still animate — which makes
   * this free in a way it would not be in the middle of a fight. Scattered in
   * space and staggered in time so it reads as a display rather than as one
   * explosion; the shells are cosmetic and touch nothing.
   */
  private fireCelebrationVfx(): void {
    const origin = this.vehicle.body.translation();
    for (let index = 0; index < CELEBRATION_SHELLS; index += 1) {
      const angle = (index / CELEBRATION_SHELLS) * Math.PI * 2;
      const reach = 5 + Math.random() * 5;
      const x = origin.x + Math.cos(angle) * reach;
      const z = origin.z + Math.sin(angle) * reach;
      const y = origin.y + 3 + Math.random() * 4;
      window.setTimeout(
        () => {
          if (this.disposed) return;
          this.vfx.shellBurst(x, y, z, 2.4 + Math.random() * 1.4);
        },
        index * 140 + Math.random() * 90,
      );
    }
  }

  /** The celebration's single button: hand the player to the rig picker. */
  private leaveFirstPlayWave(): void {
    this.firstPlayVictory?.hide();
    const payload = this.clearedWavePayload();
    this.callbacks.onBuildPhase(
      payload.clearedRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
      payload.score,
    );
  }

  private showVictory(): void {
    const survivingPartIds = new Set(this.vehicle.survivingPartIds());
    const damagedPartCount = [...this.vehicle.assembled.parts].filter(
      ([partId, part]) =>
        survivingPartIds.has(partId) &&
        part.alive &&
        !part.detached &&
        part.health < part.def.health,
    ).length;
    const lostParts = [...this.vehicle.assembled.parts]
      .filter(([partId]) => !survivingPartIds.has(partId))
      .map(([, part]) => {
        const def = getPartDef(part.placed.defId);
        return `${def.name} ($${def.cost})`;
      });
    const nextWave = this.currentWave + 1;
    const killsThisWave = Math.max(0, this.kills - this.waveStartKills);
    const integrityPct = this.vehicle.integrityPct();
    this.cleanWaveStreak =
      lostParts.length === 0 ? this.cleanWaveStreak + 1 : 0;

    const bestSecondsForWave = badgeStore.bestTimeForWave(this.currentWave);
    if (!this.debugProgressionSuppressed) {
      badgeStore.recordWaveTime(this.currentWave, this.waveElapsedSeconds);
    }
    const stats: WaveResultStats = {
      wave: this.currentWave,
      killsThisWave,
      elapsedSeconds: this.waveElapsedSeconds,
      moneyEarned: this.waveMoneyEarned,
      integrityPct,
      startIntegrityPct: this.waveStartIntegrityPct,
      partsLost: lostParts.length,
      damagedParts: damagedPartCount,
      bestSecondsForWave,
      cleanWaveStreak: this.cleanWaveStreak,
    };
    // Badges are judged on the payout the wave itself produced, so the bonus
    // below can never feed back into BIG PAYDAY and pay for itself.
    const earned = evaluateWaveBadges(stats);
    const newBadgeIds = this.debugProgressionSuppressed
      ? []
      : badgeStore.record(earned.map((badge) => badge.id)).newlyEarned;
    // Cut from the banked payout, which is still bonus-free at this point.
    const awards = badgeAwards(earned, this.waveMoneyEarned);
    // Credit before quoting repairs so the bonus counts toward affording one.
    this.creditBadgeBonus(badgeBonusTotal(awards));
    const view: WaveClearCardView = {
      wave: this.currentWave,
      moneyEarned: this.waveMoneyEarned,
      badgeBonus: this.waveBadgeBonusEarned,
      runMoneyTotal: this.callbacks.runEarnings(),
      kills: killsThisWave,
      elapsedSeconds: this.waveElapsedSeconds,
      integrityPct,
      nextWaveComposition: formatWaveComposition(
        zombieCompositionForWave(nextWave),
      ),
      // Only a boss earns a line on the payout card. Everything else the next
      // wave brings has just been shown, full screen, by the threat alert.
      bossWarning: (() => {
        const boss = bossForWave(nextWave);
        return boss === null ? null : bossEncounterWarning(boss);
      })(),
      badges: awards,
      newBadgeIds,
      repair: this.repairQuote(),
    };

    // The alert runs first, over the quiet arena, and hands off to the card:
    // "here is what is coming" lands before "here is what you earned", so the
    // threat is already in the player's head when they reach the garage button.
    const alert = this.threatAlertView(nextWave);
    if (alert === null) {
      this.waveClearCard.show(view);
      return;
    }
    this.threatAlert.show(alert, () => {
      // The run can end or reset while the alert is up — a self-destruct
      // resolving on the same frame, say — so the card is only shown if the
      // mode is still sitting on the wave it cleared.
      if (this.phase === 'cleared') this.waveClearCard.show(view);
    });
  }

  /**
   * Assemble the threat alert for `wave`, or null when the wave brings nothing
   * new to warn about.
   *
   * The alert stays free of the part catalog: the counter thumbnails are
   * rendered here through the garage's own icon pipeline — the same meshes the
   * store shows, so a recommendation is recognisable when the player goes
   * looking for it — and handed over as PNGs. `this.renderer` is only the
   * cache key; the pipeline builds and drops its own short-lived context.
   */
  private threatAlertView(wave: number): ThreatAlertView | null {
    const preview = threatPreviewForWave(wave);
    if (preview === null) return null;

    const definitions = preview.counters
      .map((partId) => {
        try {
          return getPartDef(partId);
        } catch {
          // A counter naming a part the catalog has dropped loses its tile
          // rather than the whole alert. `unit/threat-preview.test.ts` is what
          // stops one from shipping.
          return null;
        }
      })
      .filter((def): def is PartDefinition => def !== null);

    return {
      preview,
      // The live map. Icons are drawn a few per frame from the constructor, so
      // by the time a wave is cleared they are already there; a counter whose
      // icon somehow is not yet rendered simply loses its tile, which the alert
      // already handles.
      counterIcons: partIconUrls(this.renderer),
      counterNames: new Map(definitions.map((def) => [def.id, def.name])),
      ownedPartIds: new Set(
        [...this.vehicle.assembled.parts.values()].map(
          (part) => part.placed.defId,
        ),
      ),
    };
  }

  private queueGameOver(pendingMoneyDiscarded = 0): void {
    if (this.pendingTransition !== null || this.phase === 'gameOver') return;
    fadeOutDriveSfx();
    // A coach mid-lesson would otherwise hold the frame frozen behind the
    // game-over card, since the freeze outranks the phase in `update`.
    this.firstPlay?.finish();
    this.phase = 'gameOver';
    this.controls.throttle = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
    this.controls.fire = false;
    this.controls.manualAim = false;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.threatAlert.hide();
    this.waveClearCard.hide();
    this.stuckPrompt.classList.remove('is-visible');
    this.stopVehicleMotion();
    this.syncGameplayActivity();
    this.pendingTransition = {
      kind: 'gameOver',
      run: this.currentRunState(),
      pendingMoneyDiscarded,
    };
  }

  private flushPendingTransition(): void {
    const pending = this.pendingTransition;
    if (pending === null) return;
    this.pendingTransition = null;
    if (pending.kind === 'buildPhase') {
      this.callbacks.onBuildPhase(
        pending.run,
        pending.survivingPartIds,
        pending.partHp,
        pending.kills,
        pending.score,
      );
    } else {
      // The run is recorded and the garage wiped now, but the mode stays alive
      // so the player can read the result before the reset garage appears.
      this.showGameOver(
        this.callbacks.onGameOver(
          pending.run,
          pending.pendingMoneyDiscarded,
          this.runScore,
          this.kills,
        ),
      );
    }
  }

  /** Present the finished run and its leaderboard placing. */
  private showGameOver(outcome: RunOutcome): void {
    playSfx('gameOver');
    this.gameOverScore.textContent = outcome.score.toLocaleString();
    this.gameOverBest.hidden = !outcome.isPersonalBest;
    this.gameOverWaveValue.textContent = outcome.wave.toLocaleString();
    this.gameOverKillsValue.textContent = outcome.kills.toLocaleString();
    this.gameOverBoard.replaceChildren(
      buildLeaderboardTable(
        leaderboardRows(
          outcome.entries,
          outcome.rank,
          GAME_OVER_LEADERBOARD_ROWS,
        ),
        { emptyMessage: 'No runs recorded yet.' },
      ),
    );
    this.gameOverOverlay.hidden = false;
  }

  private readonly onGameOverContinue = (): void => {
    if (this.disposed) return;
    this.gameOverOverlay.hidden = true;
    this.callbacks.onGameOverContinue();
  };

  private readonly onGameOverMenu = (): void => {
    if (this.disposed) return;
    this.gameOverOverlay.hidden = true;
    this.callbacks.onGameOverMenu();
  };

  private stopVehicleMotion(): void {
    this.vehicle.body.setLinvel(this.stoppedVelocity, false);
    this.vehicle.body.setAngvel(this.stoppedVelocity, false);
    this.vehicle.body.resetForces(false);
    this.vehicle.body.resetTorques(false);
    for (const island of this.vehicle.islands) {
      island.body.setLinvel(this.stoppedVelocity, false);
      island.body.setAngvel(this.stoppedVelocity, false);
      island.body.resetForces(false);
      island.body.resetTorques(false);
    }
    for (const wheel of this.vehicle.wheels()) wheel.omega = 0;
  }

  private syncView(frameDt: number): void {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    // Colossus grows the rig on screen while its colliders stay the size they
    // were assembled at. The growth is anchored to the ground the wheels are
    // standing on rather than the body origin, so a rig twice the size still
    // sits on the road instead of half-buried in it.
    const scale = this.updateRigScale(frameDt);
    const groundY = this.rigGroundY(position.y);
    this.vehicleGroup.scale.setScalar(scale);
    this.vehicleGroup.position.set(
      position.x,
      groundY + (position.y - groundY) * scale,
      position.z,
    );
    this.vehicleGroup.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );

    for (const [id, part] of this.vehicle.assembled.parts) {
      if (part.alive) continue;
      const mesh = this.findPartMesh(id);
      if (mesh) mesh.visible = false;
    }

    // Turn each gun to where it is actually shooting.
    for (const weapon of this.vehicle.weaponStates()) {
      const mesh = this.vehicleGroup.getObjectByName(`part:${weapon.partId}`);
      if (mesh)
        applyWeaponAim(mesh, weapon.forwardLocal, weapon.yaw, weapon.pitch);
    }

    for (const wheel of this.vehicle.wheels()) {
      const mesh = this.wheelMeshes.get(wheel.partId);
      if (!mesh || wheel.broken) continue;
      const centre = wheelVisualCentre(this.vehicle.body, wheel);
      // Wheels are parented to the scene, not the chassis group, so Colossus
      // has to push them out from the hull by hand — around the same body axis
      // and ground plane the chassis was grown about.
      mesh.scale.setScalar(scale);
      mesh.position.set(
        position.x + (centre.x - position.x) * scale,
        groundY + (centre.y - groundY) * scale,
        position.z + (centre.z - position.z) * scale,
      );
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const visualSpin =
        (this.wheelSpin.get(wheel.partId) ?? 0) + wheel.omega * frameDt;
      this.wheelSpin.set(wheel.partId, visualSpin);
      const spin = mesh.getObjectByName('wheel-spin');
      const baseQuaternion = spin?.userData.baseQuat as
        THREE.Quaternion | undefined;
      if (spin && baseQuaternion) {
        this.wheelSteerQuaternion.setFromAxisAngle(
          this.wheelSteerAxis,
          -wheel.steerAngle,
        );
        spin.quaternion
          .copy(this.wheelSteerQuaternion)
          .multiply(baseQuaternion);
        spin.rotateY(visualSpin);
      }
    }

    for (const [handle, group] of this.islandGroups) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      const islandPosition = body.translation();
      const islandRotation = body.rotation();
      group.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
      group.quaternion.set(
        islandRotation.x,
        islandRotation.y,
        islandRotation.z,
        islandRotation.w,
      );
    }

    this.zombies.updateVisuals(frameDt);
    this.pickups.updateVisuals(frameDt);
    this.sentries.updateVisuals(frameDt);
    this.syncShieldBubble(frameDt);
    this.syncDroneEscort(frameDt, position);
    this.syncReinforceWard(frameDt);
    this.syncZapBlast(frameDt);
    this.syncCharmPulse(frameDt);
    this.syncExplosions(frameDt);
    this.syncThumpRing(frameDt);
    this.threatPointer.update(
      frameDt,
      position.x,
      position.y,
      position.z,
      // Only while the wave is being fought: between waves there is nothing to
      // warn about, and the countdown should not show a marker.
      this.phase === 'active' ? this.zombies.getAliveTargets() : EMPTY_TARGETS,
    );
    this.syncOverdriveTrail();
    this.phaseGhosts.update(frameDt);
    this.tracerRenderer.update(frameDt, this.camera);
    // Camera-relative LOD, so a firefight across the graveyard costs less than
    // the same firefight under the player's nose — with the rig itself pinned
    // to full detail, since the follow camera sits far enough back that
    // everything bolted to the vehicle would otherwise be thinned out.
    this.vfx.setViewpoint(this.camera.position);
    this.vfx.setFocus(this.vehicle.body.translation());
    this.vfx.update(frameDt);
    this.warningHud.update(frameDt);
    this.syncWarnings(frameDt);
    this.followCamera.update(frameDt);
    this.damageNumbers.update(frameDt, this.camera);
    this.arena.follow(this.vehicleGroup);
    this.syncHud();
    // Vehicles face local +Z, so the heading the arrow should point along is the
    // yaw of the rotated forward axis. The minimap throttles its own redraws.
    this.minimapForward
      .set(0, 0, 1)
      .applyQuaternion(this.vehicleGroup.quaternion);
    this.minimap.update(
      position.x,
      position.z,
      Math.atan2(this.minimapForward.x, this.minimapForward.z),
      this.zombies.getAliveTargets(),
      // Buried mines are always on the radar. They used to be gated behind the
      // Mine Sweeper block, and with that part gone the counter-play to a
      // Worker burying the approach has to live somewhere — so it lives here,
      // free, for every rig.
      this.zombies.activeMines(),
      this.pickups.activeMarkers(),
      this.zombies.activeBoss(),
    );
  }

  /**
   * Ease the drawn size of the rig toward whatever Colossus says it should be.
   * The buff switches on and off in one step; growing into it over a fraction
   * of a second is what makes it read as the rig swelling rather than the
   * camera cutting to a different vehicle.
   */
  private updateRigScale(frameDt: number): number {
    const target = this.vehicle.colossusScale;
    if (this.rigScale !== target) {
      const step = RIG_SCALE_RATE * Math.max(0, frameDt);
      this.rigScale =
        Math.abs(target - this.rigScale) <= step
          ? target
          : this.rigScale + Math.sign(target - this.rigScale) * step;
    }
    return this.rigScale;
  }

  /**
   * The plane the rig should be grown about: the ground its wheels are on.
   * Airborne (or wheel-less) rigs fall back to a nominal ride height, which
   * only has to be close — nothing but the visual anchor depends on it.
   */
  private rigGroundY(bodyY: number): number {
    let total = 0;
    let count = 0;
    for (const wheel of this.vehicle.wheels()) {
      if (wheel.broken || !wheel.grounded || wheel.contactPointW === null) {
        continue;
      }
      total += wheel.contactPointW.y;
      count += 1;
    }
    return count > 0 ? total / count : bodyY - NOMINAL_RIDE_HEIGHT_M;
  }

  /** Closest live zombie to a dropped sentry, in the sentry's own terms. */
  private nearestSentryTarget(
    x: number,
    z: number,
    radiusM: number,
  ): SentryTarget | null {
    let bestSq = radiusM * radiusM;
    let best: Zombie | null = null;
    for (const zombie of this.zombies.getAliveTargets()) {
      const dx = zombie.position.x - x;
      const dz = zombie.position.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > bestSq) continue;
      bestSq = distanceSq;
      best = zombie;
    }
    if (best === null) return null;
    this.sentryTarget.x = best.position.x;
    this.sentryTarget.y = best.position.y;
    this.sentryTarget.z = best.position.z;
    this.sentryTarget.colliderHandle = best.collider.handle;
    return this.sentryTarget;
  }

  /** The block a salvage crate spawning right now should be carrying. */
  private rollSalvageBlock(): { defId: string; name: string } | null {
    const defId = rollPartDrop(Math.random, this.currentWave);
    if (defId === null) return null;
    return { defId, name: getPartDef(defId).name };
  }

  /**
   * Spend one supply crate. Returning false leaves it standing — a full tank
   * drives over fuel and comes back for it later.
   */
  private collectPickup(pickup: CollectedPickup): boolean {
    // Three of the kinds are only worth anything to a wave in progress: kill
    // money has nowhere to go, a sentry would guard an empty arena, and a
    // twelve-second buff would burn down before the horde arrived. Those are
    // left standing for the fight instead of being spent on the countdown.
    if (
      this.phase !== 'active' &&
      (pickup.kind === 'cash' ||
        pickup.kind === 'sentry' ||
        pickup.kind === 'colossus')
    ) {
      return false;
    }
    switch (pickup.kind) {
      case 'fuel': {
        if (this.vehicle.refuel(FUEL_REFILL_FRACTION) <= 0) return false;
        playSfx('fuelPickup');
        this.popPickupToast('Refuelled', PICKUP_KINDS.fuel.minimapColor);
        return true;
      }
      case 'cash': {
        const amount = cashDropAmount(this.currentWave);
        this.addPendingWaveKillReward(amount);
        playSfx('pickupCash');
        this.popPickupToast(`+$${amount}`, PICKUP_KINDS.cash.minimapColor);
        return true;
      }
      case 'colossus': {
        this.vehicle.grantColossus(
          COLOSSUS_SECONDS,
          COLOSSUS_SCALE,
          COLOSSUS_DAMAGE_MULTIPLIER,
          COLOSSUS_TOUGHNESS,
          COLOSSUS_MOBILITY,
        );
        playSfx('pickupPower');
        this.popPickupToast('COLOSSUS', PICKUP_KINDS.colossus.minimapColor);
        return true;
      }
      case 'part': {
        // The crate has been showing this exact block since it spawned, so it
        // hands over what the player drove across the arena for.
        if (pickup.defId === null) return false;
        this.callbacks.onPartSalvaged?.(pickup.defId);
        playSfx('pickupSalvage');
        this.popPickupToast(
          `SALVAGED ${getPartDef(pickup.defId).name}`,
          PICKUP_KINDS.part.minimapColor,
        );
        return true;
      }
      case 'sentry': {
        this.sentries.deploy(pickup.x, pickup.z, SENTRY_SECONDS);
        playSfx('pickupSentry');
        this.popPickupToast('SENTRY UP', PICKUP_KINDS.sentry.minimapColor);
        return true;
      }
      case 'repair': {
        const repaired = this.vehicle.repairOne();
        playSfx(repaired === null ? 'uiDeny' : 'pickupRepair');
        if (repaired === null) {
          this.popPickupToast('RIG INTACT', PICKUP_KINDS.repair.minimapColor);
          return true;
        }
        if (repaired.action === 'rebuild')
          this.showRepairedPart(repaired.partId);
        this.popPickupToast(
          repaired.action === 'rebuild'
            ? `REBUILT ${repaired.name}`
            : `PATCHED ${repaired.name}`,
          PICKUP_KINDS.repair.minimapColor,
        );
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * A rebuilt block is alive again, but `syncView` hid its mesh the frame it
   * died and never looks at living parts. Show it here, once, on the step the
   * repair kit put it back.
   */
  private showRepairedPart(partId: string): void {
    const mesh = this.findPartMesh(partId);
    if (mesh) mesh.visible = true;
  }

  /** Float what a crate just did off the top of the screen. */
  private popPickupToast(text: string, color: string): void {
    const chit = document.createElement('span');
    chit.className = 'survival-pickup__chit';
    chit.textContent = text;
    chit.style.setProperty('--pickup-color', color);
    chit.addEventListener('animationend', () => chit.remove());
    this.pickupToasts.appendChild(chit);
  }

  /**
   * Run one point-defence pass for every live Drone Swarm bay on the rig.
   *
   * A pass is a single attempt at a single projectile: roll the bay's level
   * chance, and on a hit swat the closest incoming shot out of the air. That
   * shape is deliberate — the bay thins what is coming in rather than sealing
   * the rig off, so a wave of throwers is still a wave of throwers, just a
   * survivable one. The chance ladder is the whole upgrade payoff (see
   * `droneInterceptChance`).
   *
   * The interval comes off the first bay found; every bay in the catalog uses
   * the same one, and mixing intervals would need a timer each for no gain the
   * player could feel.
   */
  private updateDroneInterceptors(): void {
    this.droneInterceptTimer -= FIXED_DT;
    if (this.droneInterceptTimer > 0) return;

    let interval = 0;
    const position = this.vehicle.body.translation();
    for (const part of this.vehicle.assembled.parts.values()) {
      const interceptor = part.def.interceptor;
      if (interceptor === undefined) continue;
      if (!this.isAttachedAlivePart(part)) continue;
      interval = interval === 0 ? interceptor.intervalSeconds : interval;
      if (Math.random() >= droneInterceptChance(part.placed.config.level ?? 1))
        continue;
      const hit = this.zombies.interceptProjectileNear(
        position.x,
        position.y,
        position.z,
        interceptor.radiusM,
      );
      if (hit === null) continue;
      this.vfx.droneIntercept(hit.x, hit.y, hit.z);
      // The catch happens out where the box was; the bubble is what says the
      // rig itself was covered, so both go off together — and the flight is
      // handed the kill point so the nearest drones are seen going out to it,
      // rather than the shot popping on its own with the escort still loitering.
      this.droneEscort.flashIntercept(hit);
      playSfx('droneIntercept');
    }
    // No bay on the rig: check again next step rather than every frame forever,
    // so a bay bolted on mid-run starts working within one interval.
    this.droneInterceptTimer = interval > 0 ? interval : 1;
  }

  /**
   * Rebuild the ability bar's loadout from the rig as it stands right now.
   * Only attached, living parts count, so an ability disappears the moment a
   * zombie tears its emitter off — and comes back if the part is repaired.
   */
  private refreshAbilityLoadout(): void {
    this.abilityCandidates.length = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      const ability = part.def.ability;
      if (ability === undefined) continue;
      if (!this.isAttachedAlivePart(part)) continue;
      const level = part.placed.config.level ?? 1;
      // An ability the part has not unlocked yet holds no slot.
      if (!abilityUnlocked(ability, level)) continue;
      this.abilityCandidates.push({
        partId: part.placed.id,
        partName: part.def.name,
        ability,
        level,
        preferred: part.placed.config.activeAbility === true,
        slot: part.placed.config.abilitySlot,
      });
    }
    this.abilityLoadout = resolveAbilityLoadout(this.abilityCandidates);
  }

  /**
   * Burn the flame lance for one step: a sheet of fire down the rig's heading,
   * damaging everything standing in the cone and charring what survives.
   *
   * It follows the chassis rather than the cursor, so steering is aiming. That
   * is the whole shape of the ability — five seconds where the player's line
   * of travel and their line of fire are the same thing — and pointing it at
   * the mouse instead would make it a second, better primary fire.
   */
  private updateFlameLance(): void {
    if (this.flameLanceSeconds <= 0 || this.flameLanceStats === null) return;
    const lance = this.flameLanceStats;
    this.flameLanceSeconds = Math.max(0, this.flameLanceSeconds - FIXED_DT);
    if (this.flameLanceSeconds === 0) {
      this.flameLanceStats = null;
      this.flameLanceDuration = 0;
    }

    const pos = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.lanceQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.lanceForward.set(0, 0, 1).applyQuaternion(this.lanceQuaternion);
    // Flat heading: a rig climbing a wreck still throws its flame across the
    // ground rather than into the sky.
    this.lanceForward.y = 0;
    if (this.lanceForward.lengthSq() < 1e-6) return;
    this.lanceForward.normalize();

    // Flame and damage share one cadence. Drawing the jet every fixed step
    // instead would spawn it sixty times a second — several times what the
    // flamethrower itself asks for — and the frame spawn budget would then
    // thin out every other effect on screen to pay for it. At eight ticks a
    // second the sheet still reads as unbroken.
    this.flameLanceTickTimer -= FIXED_DT;
    if (this.flameLanceTickTimer > 0) return;
    this.flameLanceTickTimer += 1 / Math.max(1, lance.ticksPerSecond);

    this.vfx.flameJet(
      { x: pos.x, y: pos.y + 0.3, z: pos.z },
      {
        x: pos.x + this.lanceForward.x * lance.rangeM,
        y: pos.y + 0.3,
        z: pos.z + this.lanceForward.z * lance.rangeM,
      },
      true,
    );

    const burned = this.zombies.damageInCone(
      { x: pos.x, z: pos.z },
      { x: this.lanceForward.x, z: this.lanceForward.z },
      lance.rangeM,
      lance.coneDeg,
      lance.damage,
    );
    // Char whatever the sheet is washing over, on the same cadence as the
    // damage, so a lance leaves the same blackened trail a fireball does.
    if (burned > 0) {
      this.zombies.burnInCone(
        { x: pos.x, z: pos.z },
        { x: this.lanceForward.x, z: this.lanceForward.z },
        lance.rangeM,
        lance.coneDeg,
        SurvivalMode.LANCE_CHAR_SECONDS,
      );
    }
  }

  // ------------------------------------------------ Build signature strikes

  /**
   * The live signature block: the first attached, working part carrying one.
   *
   * Resolved fresh every step, like the ability loadout, so a block torn off
   * mid-wave takes its click attack with it — and a repaired one brings it
   * back. Only one is ever fitted (the blocks are `unique` and unbuyable), so
   * the first match is the answer.
   */
  private resolveLiveSignature(): {
    stats: SignatureStats;
    kind: 'lightning' | 'fireball' | 'nuke';
    origin: RuntimePart;
  } | null {
    for (const part of this.vehicle.assembled.parts.values()) {
      const signature = part.def.signature;
      if (signature === undefined) continue;
      if (!this.isAttachedAlivePart(part)) continue;
      return {
        stats: effectiveSignature(signature, part.placed.config.level ?? 1),
        kind: signature.kind,
        origin: part,
      };
    }
    return null;
  }

  /**
   * Tick the signature cooldown, fire a queued click, and advance whatever is
   * already in the air.
   *
   * Strikes keep flying even after the block that launched them is destroyed:
   * a shell that has left the tube is not the tube's business any more, and
   * cancelling it in mid-air would read as the game eating a shot.
   */
  private updateSignature(): void {
    const live = this.resolveLiveSignature();
    if (this.signatureCooldown > 0) {
      this.signatureCooldown = Math.max(0, this.signatureCooldown - FIXED_DT);
    }

    // An auto-firing signature needs no click: the player aims and it keeps up.
    // It is only asked to fire when it is actually ready, so a weapon that
    // cannot find a target never spends a cooldown and never plays a refusal.
    const clicked = this.signatureRequested;
    this.signatureRequested = false;
    if (live !== null && this.stunTimer <= 0) {
      if (live.stats.autoFire) {
        if (this.signatureCooldown <= 0) this.fireSignature(live);
      } else if (clicked) {
        this.fireSignature(live);
      }
    }

    this.strikes.step(FIXED_DT, (impact) => this.detonateStrike(impact));
    this.drawStrikeVisuals();
    this.syncSignatureReadouts(live !== null);
  }

  /**
   * Fire the signature at the player's cursor point, or refuse the click.
   *
   * A press made while the block is still recharging is refused on the reticle
   * rather than buffered. Buffering would fire a strike a moment after the
   * player stopped asking for one, which on a ten-second nuke is a wasted
   * cooldown they did not choose to spend.
   */
  private fireSignature(live: {
    stats: SignatureStats;
    kind: 'lightning' | 'fireball' | 'nuke';
    origin: RuntimePart;
  }): void {
    if (this.signatureCooldown > 0) {
      // Only a hand-fired weapon can be refused: an auto-firing one is never
      // asked to shoot early, so flashing at a stray click would be noise.
      if (!live.stats.autoFire) {
        this.scopeCursor.flashDenied();
        this.strikeGauge.flashDenied();
        playSfx('uiDeny');
      }
      return;
    }
    // No cursor point yet — the pointer has not moved over the canvas this
    // wave. Nothing to aim at, so the shot is dropped without a cooldown.
    const aim = this.controls.aimPoint;
    if (aim === undefined) return;

    const pos = this.vehicle.body.translation();
    const target = clampStrikePoint(
      { x: pos.x, z: pos.z },
      { x: aim.x, z: aim.z },
      live.stats.rangeM,
    );

    // A chain resolves here rather than through the flight queue: it has no
    // travel time and no blast, and it needs the bodies it struck to draw the
    // arc between them.
    if (live.stats.chainTargets > 1) {
      this.fireChain(live.stats, target);
      return;
    }

    this.strikes.fire(
      live.stats,
      live.kind,
      { x: pos.x, y: pos.y + SurvivalMode.STRIKE_LAUNCH_LIFT_M, z: pos.z },
      target,
      (impact) => this.detonateStrike(impact),
    );
    this.signatureCooldown = live.stats.cooldownSeconds;
    this.signatureCooldownTotal = live.stats.cooldownSeconds;
    playSfx(
      live.kind === 'nuke'
        ? 'signatureNukeLaunch'
        : live.kind === 'fireball'
          ? 'signatureFireball'
          : 'signatureLightning',
    );
  }

  /**
   * Fire a chain strike at the cursor and draw the arc it walked.
   *
   * A shot that finds nobody is not a shot: it starts no cooldown and makes no
   * sound. That matters far more here than for the other two signatures,
   * because this one fires itself twice a second — burning a cooldown on empty
   * ground would leave the weapon silently unavailable the instant a zombie
   * finally walked into reach.
   */
  private fireChain(
    stats: SignatureStats,
    target: { x: number; z: number },
  ): void {
    const path = this.zombies.chainFrom(
      target,
      stats.radiusM,
      stats.chainRangeM,
      stats.chainTargets,
      stats.damage,
      stats.chainFalloff,
      stats.shockSeconds,
    );
    if (path.length === 0) return;

    // The bolt itself lands on the first body; every jump after it is an arc
    // between two bodies, so the shape on screen is the shape of the damage.
    const [first] = path;
    this.vfx.lightningStrike(first.x, first.y, first.z, 1.2);
    for (let i = 1; i < path.length; i++) {
      this.vfx.lightningArc(path[i - 1], path[i]);
    }
    this.signatureCooldown = stats.cooldownSeconds;
    this.signatureCooldownTotal = stats.cooldownSeconds;
    playSfx('signatureLightning');
  }

  /**
   * Land a strike: damage with distance falloff, the status it leaves behind,
   * and the effect that sells it.
   *
   * `explodeAt` already applies linear falloff from the centre and shoves the
   * survivors outward, which is exactly the contract all three signatures
   * describe — so none of them reimplements it.
   */
  private detonateStrike(impact: StrikeImpact): void {
    this.zombies.explodeAt(
      impact.x,
      impact.y,
      impact.z,
      impact.radiusM,
      impact.damage,
    );
    // Status is applied after the damage so it also marks the bodies the blast
    // just killed — a corpse the fire caught should look like it.
    if (impact.burnSeconds > 0) {
      this.zombies.burnWithin(impact, impact.radiusM, impact.burnSeconds);
    }
    if (impact.shockSeconds > 0) {
      this.zombies.shockWithin(impact, impact.radiusM, impact.shockSeconds);
    }

    if (impact.kind === 'lightning') {
      this.vfx.lightningStrike(impact.x, impact.y, impact.z, impact.radiusM);
      return;
    }
    if (impact.kind === 'fireball') {
      this.vfx.fireballBurst(impact.x, impact.y, impact.z, impact.radiusM);
      playSfx('signatureFireballBurst');
      return;
    }
    this.vfx.nukeBlast(impact.x, impact.y, impact.z, impact.radiusM);
    // The blast sphere on top of the particles: the nuke is the one strike big
    // enough that the particle layer alone under-sells it.
    this.spawnExplosion(
      impact.x,
      impact.y + 1,
      impact.z,
      impact.radiusM,
      0xffd76e,
      0.7,
    );
    playSfx('signatureNukeBlast');
  }

  /**
   * Draw every in-flight payload and its ground marker for this frame.
   *
   * Guarded on the count because `visuals()` builds a list, and the common
   * case by a wide margin is nothing in the air at all.
   */
  private drawStrikeVisuals(): void {
    if (this.strikes.activeCount === 0) return;
    for (const visual of this.strikes.visuals()) {
      if (visual.kind === 'fireball') {
        this.vfx.fireballTrail(visual.x, visual.y, visual.z);
        continue;
      }
      if (visual.kind !== 'nuke' || !visual.drawMark) continue;
      this.vfx.nukeMarker(
        visual.targetX,
        0,
        visual.targetZ,
        visual.radiusM,
        visual.progress,
      );
    }
  }

  /**
   * Push the signature's recharge into both readouts: the reticle on desktop,
   * the strike gauge on touch. A rig with no signature block clears them
   * rather than showing a permanently full one, so the brackets go back to
   * being decoration and the gauge stops claiming a weapon that is not fitted.
   */
  private syncSignatureReadouts(hasSignature: boolean): void {
    if (!hasSignature) {
      this.scopeCursor.clearCooldown();
      this.strikeGauge.clearCooldown();
      return;
    }
    const charge =
      this.signatureCooldownTotal <= 0
        ? 1
        : 1 - this.signatureCooldown / this.signatureCooldownTotal;
    this.scopeCursor.setCooldown(charge);
    this.strikeGauge.setCooldown(charge);
  }

  /** Queue an ability slot, from either its keybind or a click on its box. */
  private requestAbility(slot: number): void {
    if (this.phase !== 'active' || this.settingsOpen) return;
    this.abilityRequests.add(slot);
    this.notifyFirstPlay('ability');
  }

  /** Tick every ability's cooldown and discharge the ones pressed this step. */
  private updateAbility(): void {
    for (const [partId, remaining] of this.abilityCooldowns) {
      if (remaining <= FIXED_DT) this.abilityCooldowns.delete(partId);
      else this.abilityCooldowns.set(partId, remaining - FIXED_DT);
    }
    this.refreshAbilityLoadout();
    if (this.stunTimer > 0) {
      // Cooldowns keep ticking through a stun; only firing is locked out.
      // Presses made while stunned are dropped rather than queued, so nothing
      // discharges the instant it wears off.
      if (this.abilityRequests.size > 0) {
        this.abilityRequests.clear();
        playSfx('uiDeny');
      }
      return;
    }
    if (this.abilityRequests.size === 0) return;

    let denied = false;
    for (const assignment of this.abilityLoadout) {
      if (!this.abilityRequests.delete(assignment.slot)) continue;
      if ((this.abilityCooldowns.get(assignment.partId) ?? 0) > 0) {
        denied = true;
        continue;
      }
      this.abilityCooldowns.set(
        assignment.partId,
        this.fireAbility(assignment),
      );
    }
    // Anything left asked for an empty slot; drop it rather than let it fire
    // the moment an ability part is bolted on.
    denied ||= this.abilityRequests.size > 0;
    this.abilityRequests.clear();
    if (denied) playSfx('uiDeny');
  }

  /**
   * Apply one ability's effect at the vehicle's current position and return
   * the cooldown it starts.
   */
  private fireAbility(assignment: AbilitySlotAssignment): number {
    const { ability, level } = assignment;
    const pos = this.vehicle.body.translation();
    if (ability.kind === 'shield') {
      const shield = effectiveShield(ability, level);
      this.vehicle.grantInvulnerability(shield.durationSeconds);
      playSfx('abilityShield');
      // The bubble itself is raised by syncShieldBubble, which also plays the
      // skin-forming burst off this state change.
      return shield.cooldownSeconds;
    }
    if (ability.kind === 'freeze') {
      const freeze = effectiveFreeze(ability, level);
      this.zombies.freezeNearest(
        { x: pos.x, z: pos.z },
        freeze.targets,
        freeze.rangeM,
        freeze.durationSeconds,
      );
      // Cold front off the chassis, out to the exact catch radius. Each zombie
      // it catches plays its own encasing burst from inside the zombie pool.
      this.vfx.freezeBurst(pos.x, pos.y, pos.z, freeze.rangeM);
      playSfx('abilityFreeze');
      return freeze.cooldownSeconds;
    }
    if (ability.kind === 'zap') {
      const zap = effectiveZap(ability, level);
      // Blast centred on the vehicle, matching the Shield Bubble's radius.
      this.zombies.damageWithin(
        { x: pos.x, z: pos.z },
        SHIELD_BUBBLE_RADIUS_M,
        zap.damage,
      );
      this.spawnZapBlast();
      return zap.cooldownSeconds;
    }
    if (ability.kind === 'charm') {
      const charm = effectiveCharm(ability, level);
      this.zombies.charmNearest(
        { x: pos.x, z: pos.z },
        charm.targets,
        charm.rangeM,
        charm.durationSeconds,
      );
      this.spawnCharmPulse(charm.rangeM);
      return charm.cooldownSeconds;
    }
    if (ability.kind === 'rocket') {
      const rocket = effectiveRocket(ability, level);
      // Land the rocket on the thickest cluster in range; if the field is empty
      // fire straight ahead so the ability still feels responsive.
      const impact =
        this.zombies.bestBlastTarget(
          { x: pos.x, z: pos.z },
          SurvivalMode.ROCKET_SEEK_RANGE_M,
          rocket.radiusM,
        ) ?? this.forwardGroundPoint(SurvivalMode.ROCKET_SEEK_RANGE_M);
      this.zombies.damageWithin(impact, rocket.radiusM, rocket.damage);
      this.spawnExplosion(
        impact.x,
        pos.y,
        impact.z,
        rocket.radiusM,
        0xffb020,
        0.5,
      );
      return rocket.cooldownSeconds;
    }
    if (ability.kind === 'thump') {
      const thump = effectiveThump(ability, level);
      // Shove every zombie in the circle straight away from the chassis, with a
      // share of the shove going upward so the ring throws bodies rather than
      // skidding them along the floor.
      this.zombies.knockbackWithin(
        { x: pos.x, z: pos.z },
        thump.radiusM,
        thump.knockbackSpeed,
        SurvivalMode.THUMP_LIFT_FRACTION,
      );
      this.spawnThumpRing(thump.radiusM);
      this.vfx.thumperSlam(pos.x, pos.y, pos.z, thump.radiusM);
      // The rams land on the rig's own ground, so the kick is at full strength
      // by definition — the shake is most of what sells a ground-pound.
      this.followCamera.addShake(SurvivalMode.THUMP_CAMERA_SHAKE);
      playSfx('abilityThump');
      return thump.cooldownSeconds;
    }
    if (ability.kind === 'pulse') {
      const pulse = effectivePulse(ability, level);
      // explodeAt already pushes survivors away from the centre, which is the
      // whole point of the ring.
      this.zombies.explodeAt(pos.x, pos.y, pos.z, pulse.radiusM, pulse.damage);
      this.vfx.pulseRing(pos.x, pos.y, pos.z, pulse.radiusM);
      playSfx('abilityPulse');
      return pulse.cooldownSeconds;
    }
    if (ability.kind === 'droneSwarm') {
      const swarm = effectiveDroneSwarm(ability, level);
      // Throwers only, nearest first. An empty sky still spends the cooldown:
      // the flight launched, and letting the press be free whenever nothing
      // was in range would make the ability something to mash.
      const killed = this.zombies.swarmNearestThrowers(
        { x: pos.x, z: pos.z },
        swarm.kills,
        swarm.rangeM,
      );
      for (const target of killed) {
        this.vfx.droneStrike(
          pos.x,
          pos.y + 1,
          pos.z,
          target.x,
          target.y,
          target.z,
        );
      }
      playSfx('abilityDroneSwarm');
      return swarm.cooldownSeconds;
    }
    if (ability.kind === 'phase') {
      return this.firePhase(ability, level);
    }
    if (ability.kind === 'reinforce') {
      const reinforce = effectiveReinforce(ability, level);
      this.vehicle.grantReinforce(
        reinforce.durationSeconds,
        reinforce.mobilityMultiplier,
        reinforce.shieldHp,
      );
      // The hex shell is raised by syncReinforceWard off the ward pool itself,
      // so the plating is already going up by the time this returns.
      playSfx('abilityReinforce');
      return reinforce.cooldownSeconds;
    }
    if (ability.kind === 'flamelance') {
      const lance = effectiveFlameLance(ability, level);
      this.flameLanceSeconds = Math.max(
        this.flameLanceSeconds,
        lance.durationSeconds,
      );
      this.flameLanceDuration = Math.max(
        this.flameLanceDuration,
        lance.durationSeconds,
      );
      this.flameLanceStats = {
        damage: lance.damage,
        ticksPerSecond: lance.ticksPerSecond,
        rangeM: lance.rangeM,
        coneDeg: lance.coneDeg,
      };
      // Start hot: the first tick lands on the frame the key was pressed
      // rather than an eighth of a second later.
      this.flameLanceTickTimer = 0;
      playSfx('abilityFlameLance');
      return lance.cooldownSeconds;
    }
    if (ability.kind === 'hellfire') {
      const hellfire = effectiveHellfire(ability, level);
      // The overcharge rides on the nozzle that fired it, so a rig with two
      // flamethrowers lights each one from its own slot. The flame itself is
      // the feedback: it starts on the next weapon step and comes out visibly
      // longer and wider.
      const lit = this.vehicle.grantHellfire(
        assignment.partId,
        hellfire.durationSeconds,
        hellfire,
      );
      if (lit) playSfx('abilityHellfire');
      // A part with no weapon has nothing to overcharge — don't burn the
      // cooldown on a no-op.
      return lit ? hellfire.cooldownSeconds : 0;
    }
    const overdrive = effectiveOverdrive(ability, level);
    this.vehicle.grantOverdrive(
      overdrive.durationSeconds,
      overdrive.torqueMultiplier,
      overdrive.topSpeedMultiplier,
      overdrive.thrustAccel,
    );
    const rotation = this.vehicle.body.rotation();
    this.abilityQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.abilityForward.set(0, 0, 1).applyQuaternion(this.abilityQuaternion);
    this.vfx.overdriveBurst(
      pos.x,
      pos.y,
      pos.z,
      this.abilityForward.x,
      this.abilityForward.z,
    );
    playSfx('abilityOverdrive');
    return overdrive.cooldownSeconds;
  }

  /**
   * Phase blink: set the rig down a short way along its own heading, straight
   * through whatever stood between the two points. Nothing is sweep-tested —
   * passing through zombies, wrecks, and scenery is the whole ability — so the
   * arena wall is enforced here instead, by clipping the trip to the last spot
   * inside the bounds.
   *
   * The frames the teleport skipped are drawn as after-images along the path,
   * because an instant reposition with no trail reads as a glitch rather than
   * as a move the player made.
   */
  private firePhase(ability: AbilityDefinition, level: number): number {
    const phase = effectivePhase(ability, level);
    const pos = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.abilityQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.abilityForward.set(0, 0, 1).applyQuaternion(this.abilityQuaternion);
    // Flat heading: a rig climbing a wreck or rolled onto its side still blinks
    // level across the ground rather than into the sky or under it.
    this.abilityForward.y = 0;
    // Nose pointing at the sky leaves no heading to blink along; refund the
    // press rather than teleport in an arbitrary direction.
    if (this.abilityForward.lengthSq() < 1e-6) return 0;
    this.abilityForward.normalize();

    const destination = phaseDestination(
      pos,
      { x: this.abilityForward.x, z: this.abilityForward.z },
      phase.distanceM,
      this.arena.bounds,
      PHASE_WALL_MARGIN_M,
    );
    // Already nosed into the fence: the blink has nowhere to go, so it never
    // happened and the cooldown does not start.
    if (destination.distanceM < PHASE_MIN_TRAVEL_M) return 0;

    const landingY = pos.y + PHASE_LANDING_LIFT_M;
    this.phaseFrom.set(pos.x, pos.y, pos.z);
    this.phaseTo.set(destination.x, landingY, destination.z);
    // Cloned before the body moves, while the visuals still stand at the
    // departure point — the trail is those frames, not the arrival.
    this.phaseSources.length = 0;
    this.phaseSources.push(this.vehicleGroup, ...this.wheelMeshes.values());
    this.phaseGhosts.spawn(this.phaseSources, this.phaseFrom, this.phaseTo);
    this.phaseSources.length = 0;

    this.vfx.phaseBurst(
      pos.x,
      pos.y,
      pos.z,
      this.abilityForward.x,
      this.abilityForward.z,
    );
    playSfx('abilityPhaseOut');
    this.vehicle.phaseShift(
      destination.x - pos.x,
      destination.z - pos.z,
      PHASE_LANDING_LIFT_M,
    );
    this.vfx.phaseBurst(
      destination.x,
      landingY,
      destination.z,
      this.abilityForward.x,
      this.abilityForward.z,
    );
    playSfx('abilityPhaseIn');
    return phase.cooldownSeconds;
  }

  private isAttachedAlivePart(part: RuntimePart): boolean {
    return part.alive && !part.detached && part.health > 0;
  }

  // -------------------------------------------------- scuttle charge (K) ---

  /** The HUD button and the K keybind share one request path. */
  private readonly onSelfDestructClick = (): void => {
    this.unlockAudioFromInput();
    this.requestSelfDestruct();
  };

  /**
   * Queue a detonation for the next fixed step. A press made outside a live
   * wave, before a wheel has been lost, or while the charge is already going
   * off is dropped rather than buffered — the charge may only ever fire on a
   * frame the player chose.
   */
  private requestSelfDestruct(): void {
    if (this.disposed || this.settingsOpen) return;
    if (this.phase !== 'active' || this.selfDestructHoldSeconds > 0) return;
    if (!this.selfDestructArmed) {
      playSfx('uiDeny');
      return;
    }
    this.selfDestructRequested = true;
  }

  /**
   * Arm the charge once any wheel has been destroyed or shaken off. It latches:
   * a wheel lost mid-wave cannot be bolted back on, so re-deriving this every
   * step could only ever confirm what the first lost wheel already established.
   */
  private refreshSelfDestructArmed(): void {
    if (this.selfDestructArmed) return;
    for (const part of this.vehicle.assembled.parts.values()) {
      if (part.def.wheel === undefined) continue;
      if (this.isAttachedAlivePart(part)) continue;
      this.selfDestructArmed = true;
      playSfx('selfDestructArm');
      return;
    }
  }

  /**
   * Blow the rig. Zombies are killed first: their deaths run WaveManager's
   * completion check synchronously, so by the time the vehicle itself is
   * scuttled the wave has already declared whether it is clear — and that is
   * the whole outcome of the run, decided on this one frame.
   */
  /**
   * Blast reach, in metres, for the fuel currently aboard. Dry tanks still pop
   * — there is always a charge — but the reach is the fuel.
   */
  private selfDestructRadiusM(): number {
    const litres = this.vehicle.fuelLitres;
    const fuel = Number.isFinite(litres) ? Math.max(0, litres) : 0;
    return Math.min(
      SELF_DESTRUCT_MAX_RADIUS_M,
      SELF_DESTRUCT_MIN_RADIUS_M + fuel * SELF_DESTRUCT_RADIUS_PER_LITRE_M,
    );
  }

  /** 0 on a dry tank, 1 at the fuel that maxes the blast out. */
  private selfDestructFuelFactor(radiusM: number): number {
    const span = SELF_DESTRUCT_MAX_RADIUS_M - SELF_DESTRUCT_MIN_RADIUS_M;
    if (span <= 0) return 1;
    return Math.min(
      1,
      Math.max(0, (radiusM - SELF_DESTRUCT_MIN_RADIUS_M) / span),
    );
  }

  private detonateSelfDestruct(): void {
    const position = this.vehicle.body.translation();
    const radiusM = this.selfDestructRadiusM();
    const fuelFactor = this.selfDestructFuelFactor(radiusM);
    const damage =
      SELF_DESTRUCT_MIN_DAMAGE +
      (SELF_DESTRUCT_MAX_DAMAGE - SELF_DESTRUCT_MIN_DAMAGE) * fuelFactor;
    // Captured before anything dies. If the blast clears the wave, this wreck
    // is what the Garage rebuilds from: the charge costs the run its momentum,
    // not the vehicle the player spent it building.
    this.selfDestructSalvage = {
      survivingPartIds: this.vehicle.survivingPartIds(),
      partHp: this.vehicle.partHpSnapshot(),
    };

    this.zombies.explodeAt(
      position.x,
      position.y + 0.4,
      position.z,
      radiusM,
      damage,
    );
    this.selfDestructCleared = this.phase === 'cleared';

    this.vfx.selfDestruct(
      position.x,
      position.y,
      position.z,
      radiusM,
      fuelFactor,
    );
    // Everything the blast is felt through scales with it too, so a dry-tank
    // pop never rattles the screen like a full one.
    this.followCamera.addShake(0.7 + fuelFactor * 1.1);
    // The vignette's own saturation ceiling caps this; a full charge going off
    // in the player's lap should read as the hardest hit the run ever took.
    this.warningHud.reportDamage(120 + fuelFactor * 280);
    playSfx('selfDestructBlast');
    playExplosionSfx({ gain: 0.62, playbackRate: 0.58 + fuelFactor * 0.18 });

    this.attachNewIslands(this.vehicle.scuttle());
    this.controls.throttle = 0;
    this.controls.brake = 0;
    this.controls.steer = 0;
    this.controls.fire = false;
    this.controls.manualAim = false;
    this.pointerFiring = false;
    this.keys.clear();
    this.stuckPrompt.classList.remove('is-visible');

    this.selfDestructFuelFired = fuelFactor;
    this.selfDestructHoldSeconds = SELF_DESTRUCT_HOLD_SECONDS;
    this.selfDestructAftershockSeconds = SELF_DESTRUCT_AFTERSHOCK_SECONDS;
    this.selfDestructBanner.textContent = this.selfDestructCleared
      ? 'Wave Cleared — Wreck Towed to the Garage'
      : 'Charge Blown — Zombies Left Standing';
    this.selfDestructBanner.classList.toggle(
      'is-clear',
      this.selfDestructCleared,
    );
    this.selfDestructBanner.hidden = false;
    this.syncSelfDestructHud();
  }

  /**
   * Hold the frame while the blast plays. Physics, the wave, and the vehicle
   * are all finished by now, so nothing steps: only the effects layer, which
   * runs off the render frame rather than off this loop, is still moving.
   */
  private tickSelfDestructHold(): void {
    this.selfDestructHoldSeconds -= FIXED_DT;
    this.selfDestructAftershockSeconds -= FIXED_DT;
    // Aftershocks stop before the hold does, so the wreck is quiet for a beat
    // before the card lands rather than still cooking off underneath it.
    if (
      this.selfDestructAftershockSeconds <= 0 &&
      this.selfDestructHoldSeconds > 0.45
    ) {
      this.selfDestructAftershockSeconds = SELF_DESTRUCT_AFTERSHOCK_SECONDS;
      this.emitSelfDestructAftershock();
    }
    if (this.selfDestructHoldSeconds > 0) return;
    this.selfDestructHoldSeconds = 0;
    this.resolveSelfDestruct();
  }

  /** One tank or magazine going up somewhere in the wreck. */
  private emitSelfDestructAftershock(): void {
    const position = this.vehicle.body.translation();
    const angle = Math.random() * Math.PI * 2;
    const spread = 0.6 + this.selfDestructFuelFired * 2;
    const distance = 0.5 + Math.random() * spread;
    const x = position.x + Math.cos(angle) * distance;
    const z = position.z + Math.sin(angle) * distance;
    this.vfx.explosion(x, position.y + 0.3, z, 1 + this.selfDestructFuelFired);
    this.shakeCameraAt(x, z, 0.2 + this.selfDestructFuelFired * 0.3);
  }

  /**
   * Cash the bargain. A cleared wave goes straight to the Garage on the
   * checkpoint the blast earned — there is no wave-clear card, because every
   * choice it offers ("continue now", "repair and continue") needs a vehicle
   * that is still standing. Anything else is an ordinary destroyed rig.
   */
  private resolveSelfDestruct(): void {
    this.selfDestructBanner.hidden = true;
    if (!this.selfDestructCleared) {
      const pendingMoneyDiscarded = this.pendingWaveTotal();
      this.discardPendingWaveRewards();
      this.queueGameOver(pendingMoneyDiscarded);
      return;
    }

    const salvage = this.selfDestructSalvage;
    this.bankPendingWaveRewards();
    const payload = createWaveClearPayload(
      this.currentWave,
      salvage?.survivingPartIds ?? [],
      salvage?.partHp ?? {},
      this.kills,
      this.runScore,
      this.runElapsedSeconds,
    );
    if (this.callbacks.onWaveCheckpoint) {
      this.callbacks.onWaveCheckpoint(
        payload.nextRun,
        payload.survivingPartIds,
        payload.partHp,
        payload.kills,
        payload.score,
      );
    }
    this.pendingTransition = {
      kind: 'buildPhase',
      run: payload.clearedRun,
      survivingPartIds: [...payload.survivingPartIds],
      partHp: payload.partHp,
      kills: payload.kills,
      score: payload.score,
    };
  }

  /**
   * Show the charge only while it can actually be fired, and quote what it is
   * worth right now. The reach is burning away with the fuel, so the number is
   * live — the player should never have to guess how big their last resort
   * still is.
   */
  private syncSelfDestructHud(): void {
    const visible =
      this.selfDestructArmed &&
      this.phase === 'active' &&
      this.selfDestructHoldSeconds <= 0;
    if (visible !== this.selfDestructHudArmed) {
      this.selfDestructHudArmed = visible;
      this.selfDestructButton.classList.toggle('is-visible', visible);
    }
    if (!visible) return;
    const reach = Math.round(this.selfDestructRadiusM());
    if (reach === this.selfDestructHudReachM) return;
    this.selfDestructHudReachM = reach;
    this.selfDestructHint.textContent = `Press K — ${reach}m Blast`;
  }

  /**
   * Refresh the ability boxes from the live loadout. The bar is a
   * fighting-phase HUD: it shows from the pre-wave countdown through the wave
   * itself and hides once the run is over, so it never sits on top of the
   * victory or game-over panels. A rig with no ability parts shows no boxes.
   */
  private syncAbilityHud(): void {
    // While a wave is running the fixed step already refreshes the loadout
    // every step; outside one nothing else does, so the HUD keeps it current.
    if (this.phase !== 'active') this.refreshAbilityLoadout();
    // Touch keeps the empty boxes: the row is the floor of a fixed centre
    // stack, and a bar that appears when the first ability is fitted would
    // shove the strike gauge sat on top of it.
    const combatHud = this.phase === 'countdown' || this.phase === 'active';
    this.abilityBar.setVisible(
      combatHud && (this.abilityLoadout.length > 0 || shouldUseTouchControls()),
    );
    // The gauge answers to the phase alone; whether the rig even has a
    // signature block is the readout's own business.
    this.strikeGauge.setVisible(combatHud);
    // The loadout only changes when a part is fitted, lost, or repaired, and
    // the labels only change with it — so the views (and the strings in them)
    // are rebuilt on that signature, not every frame. Cooldowns are the one
    // thing that moves continuously, so only those are written per frame.
    const signature = this.abilityLoadoutSignature();
    if (signature !== this.abilitySlotViewSignature) {
      this.abilitySlotViewSignature = signature;
      // Indexed by slot, not packed: the player can leave box E empty and
      // still have an ability bound to R.
      this.abilitySlotViews.fill(undefined);
      for (const assignment of this.abilityLoadout) {
        const meta = abilityMeta(assignment.ability);
        const keyLabel = assignment.key.toUpperCase();
        this.abilitySlotViews[assignment.slot] = {
          partId: assignment.partId,
          keyLabel,
          glyph: meta.glyph,
          name: meta.label,
          detail: abilityDetail(assignment),
          tooltip: `${meta.label} (${keyLabel}) — ${meta.blurb} [${assignment.partName}]`,
          cooldownSeconds: assignment.ability.cooldownSeconds,
          remainingSeconds: 0,
        };
      }
    }
    for (const assignment of this.abilityLoadout) {
      const view = this.abilitySlotViews[assignment.slot];
      if (view === undefined) continue;
      view.remainingSeconds = this.abilityCooldowns.get(assignment.partId) ?? 0;
    }
    this.abilityBar.render(this.abilitySlotViews);
    // The coach's ability card quotes a key, so it reads the bound one off the
    // loadout rather than assuming the slot the rig asked for. The Shield
    // Bubble is what it teaches; any ability at all is better than a card that
    // names a box with nothing in it.
    if (this.firstPlay !== null) {
      const shield = this.abilityLoadout.find(
        (assignment) => assignment.ability.kind === 'shield',
      );
      const taught = shield ?? this.abilityLoadout[0];
      this.firstPlay.setAbilityKey(taught?.key.toUpperCase() ?? '');
    }
    this.syncBuffHud();
  }

  /**
   * Timers for the two crate effects that run on a clock: how much Colossus is
   * left, and how long the last dropped sentry has to live. Both empty on their
   * own, so the bar exists to answer "how long have I got" at a glance without
   * the player counting seconds in their head.
   */
  private syncBuffHud(): void {
    this.buffViews.length = 0;
    // Only while there is a fight to spend them on. Outside one the timers are
    // not being stepped, and a frozen bar over the victory or game-over panel
    // would read as an effect the player still has.
    if (this.phase !== 'countdown' && this.phase !== 'active') {
      this.buffBar.render(this.buffViews);
      return;
    }
    // Fixed order, so a row never jumps to a different line when another
    // effect starts or stops underneath it.
    this.pushBuffView(
      'colossus',
      PICKUP_KINDS.colossus.label,
      PICKUP_KINDS.colossus.minimapColor,
      this.vehicle.colossusSecondsRemaining,
      COLOSSUS_SECONDS,
    );
    const overdrive = this.vehicle.overdriveSeconds;
    this.pushBuffView(
      'overdrive',
      ABILITY_KIND_META.overdrive.label,
      BUFF_COLORS.overdrive,
      overdrive.remaining,
      overdrive.total,
    );
    const reinforce = this.vehicle.reinforceSeconds;
    this.pushBuffView(
      'reinforce',
      ABILITY_KIND_META.reinforce.label,
      BUFF_COLORS.reinforce,
      reinforce.remaining,
      reinforce.total,
    );
    const shield = this.vehicle.invulnerableSeconds;
    this.pushBuffView(
      'shield',
      ABILITY_KIND_META.shield.label,
      BUFF_COLORS.shield,
      shield.remaining,
      shield.total,
    );
    const hellfire = this.vehicle.overchargeSeconds;
    this.pushBuffView(
      'hellfire',
      ABILITY_KIND_META.hellfire.label,
      BUFF_COLORS.hellfire,
      hellfire.remaining,
      hellfire.total,
    );
    this.pushBuffView(
      'flamelance',
      ABILITY_KIND_META.flamelance.label,
      BUFF_COLORS.flamelance,
      this.flameLanceSeconds,
      this.flameLanceDuration,
    );
    this.pushBuffView(
      'sentry',
      PICKUP_KINDS.sentry.label,
      PICKUP_KINDS.sentry.minimapColor,
      this.sentries.secondsRemaining,
      this.sentries.longestLifetime || SENTRY_SECONDS,
    );
    this.buffBar.render(this.buffViews);
  }

  /** Add one row for an effect that is actually running; skip it otherwise. */
  private pushBuffView(
    id: string,
    label: string,
    color: string,
    remainingSeconds: number,
    totalSeconds: number,
  ): void {
    if (remainingSeconds <= 0 || totalSeconds <= 0) return;
    this.buffViews.push({
      id,
      label: label.toUpperCase(),
      color,
      remainingSeconds,
      totalSeconds,
    });
  }

  /**
   * Boss health bar. Hidden whenever no boss is alive, so ordinary waves are
   * unchanged. Percentage is rounded before the guard so the DOM is touched at
   * most a hundred times over the whole fight. It takes over the wave
   * timeline's icon rail for the duration of the fight — the wave/score head
   * above it stays up, only the row of upcoming-wave icons hides to make room.
   */
  private syncBossHud(): void {
    const boss = this.zombies.activeBoss();
    const label = boss?.bossLabel ?? null;
    if (!boss || !label || boss.maxHealth <= 0) {
      if (!this.bossHud.hidden) this.bossHud.hidden = true;
      this.waveTimelineHud.setRailHidden(false);
      this.lastHudBossName = '';
      this.lastHudBossPct = -1;
      return;
    }

    if (this.bossHud.hidden) this.bossHud.hidden = false;
    this.waveTimelineHud.setRailHidden(true);
    if (label.name !== this.lastHudBossName) {
      this.lastHudBossName = label.name;
      this.bossNameValue.textContent = label.name;
    }

    const pct = Math.max(
      0,
      Math.min(100, Math.round((boss.currentHealth / boss.maxHealth) * 100)),
    );
    if (pct === this.lastHudBossPct) return;
    this.lastHudBossPct = pct;
    this.bossHealthValue.textContent = `${pct}%`;
    this.bossHealthFill.style.width = `${pct}%`;
    this.bossHealthTrack.setAttribute('aria-valuenow', String(pct));
    this.bossHealthFill.classList.toggle('is-critical', pct <= 25);
  }

  /**
   * Cheap identity for the current loadout: which part is in which box, and at
   * what upgrade level. Changes exactly when the bar's labels need rewriting.
   */
  private abilityLoadoutSignature(): string {
    let signature = '';
    for (const assignment of this.abilityLoadout) {
      signature += `${assignment.slot}:${assignment.partId}:${assignment.level}|`;
    }
    return signature;
  }

  /** Exhaust trail behind the rig for as long as an overdrive surge runs. */
  private syncOverdriveTrail(): void {
    if (!this.vehicle.isOverdriving) return;
    const pos = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.abilityQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.abilityForward.set(0, 0, 1).applyQuaternion(this.abilityQuaternion);
    this.vfx.overdriveTrail(
      pos.x,
      pos.y,
      pos.z,
      this.abilityForward.x,
      this.abilityForward.z,
    );
  }

  /**
   * Show a bright blue bubble around the vehicle while the shield special's
   * invulnerability is active. The mesh is a child of the vehicle group, so it
   * follows the chassis automatically; opacity pulses gently for a live feel.
   */
  private syncShieldBubble(frameDt: number): void {
    const active = this.vehicle.isInvulnerable;
    if (active !== this.shieldWasUp) {
      this.shieldWasUp = active;
      const pos = this.vehicle.body.translation();
      // The skin forms on the way up and lets go on the way down, so both ends
      // of the ability read without watching the timer.
      if (active) {
        this.vfx.shieldRaise(pos.x, pos.y, pos.z, SHIELD_BUBBLE_RADIUS_M);
      } else {
        this.vfx.shieldCollapse(pos.x, pos.y, pos.z, SHIELD_BUBBLE_RADIUS_M);
      }
    }
    if (!active) {
      if (this.shieldBubble && this.shieldBubble.visible) {
        this.shieldBubble.visible = false;
      }
      return;
    }
    if (this.shieldBubble === null) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x33aaff,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(SHIELD_BUBBLE_RADIUS_M, 24, 16),
        material,
      );
      mesh.name = 'shield-bubble';
      this.vehicleGroup.add(mesh);
      this.shieldBubble = mesh;
      this.shieldBubbleMaterial = material;
    }
    this.shieldBubble.visible = true;
    this.shieldBubblePhase += frameDt * 4;
    if (this.shieldBubbleMaterial) {
      this.shieldBubbleMaterial.opacity =
        0.24 + 0.1 * (0.5 + 0.5 * Math.sin(this.shieldBubblePhase));
    }
  }

  /**
   * Keep the Drone Swarm flight in the air over the rig.
   *
   * The count is the sum of what every live bay is worth at its level, so
   * upgrading a bay puts another drone up immediately and losing one to a
   * grabber takes its flight home. Recounting is throttled by the escort
   * itself; between recounts this is just the ring flying.
   */
  private syncDroneEscort(
    frameDt: number,
    position: { x: number; y: number; z: number },
  ): void {
    if (this.droneEscort.needsRecount()) {
      this.droneEscortLevels.length = 0;
      for (const part of this.vehicle.assembled.parts.values()) {
        if (part.def.interceptor === undefined) continue;
        if (!this.isAttachedAlivePart(part)) continue;
        this.droneEscortLevels.push(part.placed.config.level ?? 1);
      }
      this.droneEscort.setDroneCount(
        DroneEscort.droneCount(this.droneEscortLevels),
      );
    }
    this.droneEscort.update(frameDt, position);
  }

  /**
   * Drive the Reinforce ward's hex shell from the vehicle's ward pool. The
   * shell is a child of the vehicle group, so it follows the chassis; it is
   * built on the first activation of the run and reused from then on, since a
   * heavy rig raises it every twenty seconds.
   *
   * The shatter is reported separately from the fraction: a ward emptied by a
   * hit is down on the same frame, and without the explicit break the shell
   * would be asked to disappear while its last panels were still whole.
   */
  private syncReinforceWard(frameDt: number): void {
    const active = this.vehicle.isReinforced;
    if (!active && this.reinforceWard === null) return;
    if (this.reinforceWard === null) {
      this.reinforceWard = new ReinforceWard(SHIELD_BUBBLE_RADIUS_M);
      this.vehicleGroup.add(this.reinforceWard.root);
    }
    const hit = this.vehicle.consumeWardHit();
    if (hit.shattered) {
      this.reinforceWard.shatterAll();
      const pos = this.vehicle.body.translation();
      this.vfx.shieldCollapse(pos.x, pos.y, pos.z, SHIELD_BUBBLE_RADIUS_M);
      playSfx('abilityReinforce');
    }
    this.reinforceWard.update(frameDt, active, this.vehicle.wardFraction);
  }

  /** Duration of the Tesla Coil blast flash, seconds. */
  private static readonly ZAP_BLAST_SECONDS = 0.35;

  /**
   * Kick off the Tesla Coil blast flash: a bright blue sphere at the Shield
   * Bubble radius that expands and fades out. The mesh is a child of the vehicle
   * group so it stays centred on the chassis; it is created lazily and reused.
   */
  private spawnZapBlast(): void {
    if (this.zapBlast === null) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x66ccff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(SHIELD_BUBBLE_RADIUS_M, 24, 16),
        material,
      );
      mesh.name = 'zap-blast';
      this.vehicleGroup.add(mesh);
      this.zapBlast = mesh;
      this.zapBlastMaterial = material;
    }
    this.zapBlastTtl = SurvivalMode.ZAP_BLAST_SECONDS;
    this.zapBlast.visible = true;
  }

  /** Expand and fade the Tesla Coil blast flash, hiding it when spent. */
  private syncZapBlast(frameDt: number): void {
    if (this.zapBlast === null || this.zapBlastTtl <= 0) return;
    this.zapBlastTtl = Math.max(0, this.zapBlastTtl - frameDt);
    const progress = 1 - this.zapBlastTtl / SurvivalMode.ZAP_BLAST_SECONDS;
    // Snap out from a compact core, fading as it grows.
    const scale = 0.4 + 0.6 * progress;
    this.zapBlast.scale.setScalar(scale);
    if (this.zapBlastMaterial) {
      this.zapBlastMaterial.opacity = 0.5 * (1 - progress);
    }
    if (this.zapBlastTtl <= 0) this.zapBlast.visible = false;
  }

  /** Duration of the Mind Control range pulse, seconds. */
  private static readonly CHARM_PULSE_SECONDS = 0.5;

  /**
   * Kick off the Mind Control pulse: a purple sphere that expands from the
   * vehicle out to the charm range, showing which zombies were in reach. The
   * unit-radius mesh is a child of the vehicle group and is created lazily and
   * reused; the target radius is stored per activation and applied via scale.
   */
  private spawnCharmPulse(rangeM: number): void {
    if (this.charmPulse === null) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xc060ff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        material,
      );
      mesh.name = 'charm-pulse';
      this.vehicleGroup.add(mesh);
      this.charmPulse = mesh;
      this.charmPulseMaterial = material;
    }
    this.charmPulseRange = Math.max(0.1, rangeM);
    this.charmPulseTtl = SurvivalMode.CHARM_PULSE_SECONDS;
    this.charmPulse.visible = true;
  }

  /** Expand and fade the Mind Control range pulse, hiding it when spent. */
  private syncCharmPulse(frameDt: number): void {
    if (this.charmPulse === null || this.charmPulseTtl <= 0) return;
    this.charmPulseTtl = Math.max(0, this.charmPulseTtl - frameDt);
    const progress = 1 - this.charmPulseTtl / SurvivalMode.CHARM_PULSE_SECONDS;
    this.charmPulse.scale.setScalar(this.charmPulseRange * progress);
    if (this.charmPulseMaterial) {
      this.charmPulseMaterial.opacity = 0.4 * (1 - progress);
    }
    if (this.charmPulseTtl <= 0) this.charmPulse.visible = false;
  }

  /** Duration of the Thumper shockwave rings, seconds. */
  private static readonly THUMP_RING_SECONDS = 0.6;
  /**
   * The Thumper's ground rings, outer first: how thick each is as a fraction of
   * its own radius, how bright it starts, and how far behind the leading edge it
   * runs (0 = on the rim, 1 = still at the chassis when the lead ring lands).
   * Two rings rather than one is what makes the slam read as a wave with mass
   * behind its edge instead of a single expanding hoop.
   */
  private static readonly THUMP_RING_PASSES: readonly {
    readonly inner: number;
    readonly opacity: number;
    readonly lag: number;
  }[] = [
    { inner: 0.86, opacity: 0.85, lag: 0 },
    { inner: 0.6, opacity: 0.4, lag: 0.34 },
  ];
  /**
   * Share of the Thumper's horizontal shove that is redirected upward, so the
   * ring launches zombies off their feet. Kept well under 1 — the ability buys
   * ground, and a lift that dominated the push would fire the horde straight up
   * and drop it back exactly where it stood.
   */
  private static readonly THUMP_LIFT_FRACTION = 0.4;
  /**
   * Camera kick when the rams land. Below the scuttle charge's, above a shell
   * landing next to the rig: the Thumper is on a short cooldown and will be
   * fired many times a wave, so it registers without becoming exhausting.
   */
  private static readonly THUMP_CAMERA_SHAKE = 0.85;

  /**
   * Kick off the Thumper shockwave: two flat rings that snap outward from the
   * chassis to the knockback radius, showing which zombies got shoved. The
   * unit-radius rings lie flat on the ground as children of the vehicle group and
   * are created lazily and reused; the target radius is applied via scale.
   */
  private spawnThumpRing(radiusM: number): void {
    if (this.thumpRings.length === 0) {
      for (const [index, pass] of SurvivalMode.THUMP_RING_PASSES.entries()) {
        const material = new THREE.MeshBasicMaterial({
          color: 0xffcf80,
          transparent: true,
          opacity: pass.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        // Unit ring (outer radius 1) laid flat; scaled to the blast radius.
        const mesh = new THREE.Mesh(
          new THREE.RingGeometry(pass.inner, 1, 48),
          material,
        );
        mesh.rotation.x = -Math.PI / 2;
        // Staggered heights, so the two rings never z-fight where they overlap.
        mesh.position.y = 0.14 + index * 0.03;
        mesh.name = `thump-ring-${index}`;
        this.vehicleGroup.add(mesh);
        this.thumpRings.push(mesh);
        this.thumpRingMaterials.push(material);
      }
    }
    this.thumpRingRange = Math.max(0.1, radiusM);
    this.thumpRingTtl = SurvivalMode.THUMP_RING_SECONDS;
    for (const ring of this.thumpRings) ring.visible = true;
  }

  /** Expand and fade the Thumper shockwave rings, hiding them when spent. */
  private syncThumpRing(frameDt: number): void {
    if (this.thumpRings.length === 0 || this.thumpRingTtl <= 0) return;
    this.thumpRingTtl = Math.max(0, this.thumpRingTtl - frameDt);
    const progress = 1 - this.thumpRingTtl / SurvivalMode.THUMP_RING_SECONDS;
    for (const [index, pass] of SurvivalMode.THUMP_RING_PASSES.entries()) {
      const ring = this.thumpRings[index];
      if (ring === undefined) continue;
      // Each ring runs the same sweep, started `lag` of the way later, so the
      // trailing one is still crossing the ground when the lead one lands.
      const local = Math.max(0, (progress - pass.lag) / (1 - pass.lag));
      const scale = this.thumpRingRange * (0.18 + 0.82 * local);
      ring.scale.set(scale, scale, scale);
      const material = this.thumpRingMaterials[index];
      if (material) material.opacity = pass.opacity * (1 - local) ** 1.4;
    }
    if (this.thumpRingTtl <= 0) {
      for (const ring of this.thumpRings) ring.visible = false;
    }
  }

  /** How far the Missile Launcher Q rocket seeks a cluster / flies ahead, m. */
  private static readonly ROCKET_SEEK_RANGE_M = 30;
  /** Number of pooled explosion flash meshes cycled for rocket impacts. */
  private static readonly EXPLOSION_POOL_SIZE = 8;
  /**
   * Height a signature strike is launched from above the chassis origin, m.
   * Only the arcing bolus reads it — it decides where the trail starts, which
   * should be the block on the deck rather than the axle line.
   */
  private static readonly STRIKE_LAUNCH_LIFT_M = 0.8;
  /** Seconds of char the flame lance leaves on what it washes over. */
  private static readonly LANCE_CHAR_SECONDS = 2.5;

  /** A point `distanceM` ahead of the vehicle on its heading (rocket fallback). */
  private forwardGroundPoint(distanceM: number): { x: number; z: number } {
    const pos = this.vehicle.body.translation();
    const rot = this.vehicle.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const len = Math.hypot(fwd.x, fwd.z) || 1;
    return {
      x: pos.x + (fwd.x / len) * distanceM,
      z: pos.z + (fwd.z / len) * distanceM,
    };
  }

  /**
   * Flash an expanding, fading sphere at a world point (rocket/splash impact).
   * Meshes are created lazily up to {@link EXPLOSION_POOL_SIZE} and cycled, so
   * simultaneous blasts each claim a slot rather than fighting over one mesh.
   */
  private spawnExplosion(
    x: number,
    y: number,
    z: number,
    radiusM: number,
    color: number,
    durationSeconds: number,
  ): void {
    let slot = this.explosions[this.explosionCursor];
    if (slot === undefined) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        material,
      );
      mesh.name = 'rocket-blast';
      mesh.visible = false;
      this.scene.add(mesh);
      slot = {
        mesh,
        material,
        ttl: 0,
        duration: durationSeconds,
        radius: radiusM,
      };
      this.explosions[this.explosionCursor] = slot;
    }
    this.explosionCursor =
      (this.explosionCursor + 1) % SurvivalMode.EXPLOSION_POOL_SIZE;
    slot.material.color.setHex(color);
    slot.radius = Math.max(0.1, radiusM);
    slot.duration = durationSeconds;
    slot.ttl = durationSeconds;
    slot.mesh.position.set(x, y, z);
    slot.mesh.visible = true;
  }

  /** Expand and fade every live explosion flash, hiding each when spent. */
  private syncExplosions(frameDt: number): void {
    for (const slot of this.explosions) {
      if (slot.ttl <= 0) continue;
      slot.ttl = Math.max(0, slot.ttl - frameDt);
      const progress = 1 - slot.ttl / slot.duration;
      slot.mesh.scale.setScalar(slot.radius * (0.35 + 0.65 * progress));
      slot.material.opacity = 0.6 * (1 - progress);
      if (slot.ttl <= 0) slot.mesh.visible = false;
    }
  }

  /**
   * Re-evaluate the alert stack a few times a second. The inputs move slowly
   * compared with the frame rate, and the evaluation walks every part and
   * wheel, so there is nothing to gain from doing it per frame.
   */
  private syncWarnings(frameDt: number): void {
    this.warningRefreshSeconds -= frameDt;
    if (this.warningRefreshSeconds > 0) return;
    this.warningRefreshSeconds = WARNING_REFRESH_INTERVAL_SECONDS;

    if (this.phase !== 'active') {
      if (this.lastWarnings.length > 0) {
        this.lastWarnings = [];
        this.warningHud.setWarnings(this.lastWarnings);
      }
      this.warningHud.setCritical(false);
      return;
    }

    const telemetry = this.vehicle.telemetry();
    const integrityPct = this.vehicle.integrityPct();
    const wheels = this.vehicle.wheels().map((wheel) => {
      const part = this.vehicle.assembled.parts.get(wheel.partId);
      const maxHealth = part?.def.health ?? 0;
      return {
        healthFraction:
          part === undefined || maxHealth <= 0
            ? 0
            : Math.max(0, part.health) / maxHealth,
        broken: wheel.broken || part === undefined || !part.alive,
      };
    });

    let weaponCount = 0;
    let liveWeaponCount = 0;
    let liveEngineCount = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      const live = this.isAttachedAlivePart(part);
      if (part.def.weapon !== undefined || part.def.melee !== undefined) {
        weaponCount++;
        if (live) liveWeaponCount++;
      }
      if (part.def.engine !== undefined && live) liveEngineCount++;
    }

    this.lastWarnings = activeVehicleWarnings({
      integrityPct,
      wheels,
      fuel: telemetry.fuel,
      fuelCapacity: telemetry.fuelCapacity,
      liveEngineCount,
      weaponCount,
      liveWeaponCount,
      hazardMul: telemetry.hazardMul,
    });
    this.warningHud.setWarnings(this.lastWarnings);
    this.warningHud.setCritical(integrityPct <= HULL_CRITICAL_PCT);
  }

  private syncHud(): void {
    const telemetry = this.vehicle.telemetry();
    const speed = Math.round(telemetry.speedKmh);
    if (this.currentWave !== this.lastHudWave) {
      this.lastHudWave = this.currentWave;
      this.syncSpeedGaugeThresholds();
      this.lastHudSpeed = -1;
    }
    const killedThisWave = Math.max(0, this.kills - this.waveStartKills);
    const totalThisWave = zombieCountForWave(this.currentWave);
    if (
      this.waveTimeline === null ||
      this.waveTimeline.currentWave !== this.currentWave ||
      this.waveTimeline.killedThisWave !== killedThisWave ||
      this.waveTimeline.totalThisWave !== totalThisWave
    ) {
      this.waveTimeline = buildWaveTimeline({
        currentWave: this.currentWave,
        killedThisWave,
        totalThisWave,
        threatsForWave: newThreatsForWave,
      });
      this.waveTimelineHud.update(this.waveTimeline);
    }
    if (speed !== this.lastHudSpeed) {
      this.lastHudSpeed = speed;
      this.speedValue.textContent = String(speed);
      this.syncSpeedGauge(speed);
    }
    const integrity = Math.round(this.vehicle.integrityPct());
    if (integrity !== this.lastHudIntegrity) {
      this.lastHudIntegrity = integrity;
      this.integrityValue.textContent = `${integrity}%`;
      this.integrityFill.style.width = `${integrity}%`;
      this.integrityFill.parentElement?.setAttribute(
        'aria-valuenow',
        String(integrity),
      );
      this.integrityFill.classList.toggle('is-critical', integrity <= 30);
    }
    const fuelLitres = Math.ceil(telemetry.fuel);
    if (fuelLitres !== this.lastHudFuel) {
      this.lastHudFuel = fuelLitres;
      const cap = Math.round(telemetry.fuelCapacity);
      const pct =
        telemetry.fuelCapacity > 0
          ? (telemetry.fuel / telemetry.fuelCapacity) * 100
          : 0;
      this.fuelValue.textContent = `${fuelLitres} / ${cap} L`;
      this.fuelFill.style.width = `${pct}%`;
      this.fuelFill.parentElement?.setAttribute(
        'aria-valuenow',
        String(Math.round(pct)),
      );
      this.fuelFill.classList.toggle('is-low', pct <= 25);
      this.fuelFill.classList.toggle('is-empty', telemetry.fuel <= 0);
    }
    this.syncAbilityHud();
    this.syncBossHud();
    this.syncSelfDestructHud();
    if (this.runScore !== this.lastHudScore) {
      this.lastHudScore = this.runScore;
      this.waveTimelineHud.setScore(this.runScore);
    }
    const cash = this.hudCashTotal();
    if (cash !== this.lastHudCash) {
      this.lastHudCash = cash;
      this.cashValue.textContent = `$${cash}`;
    }
    if (this.phase === 'countdown') {
      const second = Math.max(1, Math.ceil(this.countdownRemaining));
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        this.countdownValue.textContent = String(second);
        playSfx('waveCountdown', {
          pitch: 0.9 + (COUNTDOWN_SECONDS - second) * 0.08,
        });
      }
    }
  }

  private syncSpeedGaugeThresholds(): void {
    this.ramDamageThresholdKmh = MIN_IMPACT_SPEED * 3.6;
    this.ramKillThresholdKmh = LETHAL_IMPACT_SPEED * 3.6;
    this.speedScaleMaxKmh = 120;

    const safeWidth =
      (this.ramDamageThresholdKmh / this.speedScaleMaxKmh) * 100;
    const damageWidth =
      ((this.ramKillThresholdKmh - this.ramDamageThresholdKmh) /
        this.speedScaleMaxKmh) *
      100;
    this.speedTrack.style.setProperty('--speed-safe-width', `${safeWidth}%`);
    this.speedTrack.style.setProperty(
      '--speed-damage-width',
      `${damageWidth}%`,
    );
    this.speedTrack.setAttribute(
      'aria-valuemax',
      String(this.speedScaleMaxKmh),
    );

    const damageAt = Math.round(this.ramDamageThresholdKmh);
    const killAt = Math.ceil(this.ramKillThresholdKmh);
    this.speedSafeLabel.textContent = `Safe <${damageAt}`;
    this.speedDamageLabel.textContent = `Damage ${damageAt}–${killAt - 1}`;
    this.speedKillLabel.textContent = `Kill ${killAt}+`;
  }

  private syncSpeedGauge(speedKmh: number): void {
    const markerPosition =
      (Math.min(Math.max(speedKmh, 0), this.speedScaleMaxKmh) /
        this.speedScaleMaxKmh) *
      100;
    this.speedTrack.style.setProperty(
      '--speed-marker-position',
      `${markerPosition}%`,
    );
    this.speedTrack.setAttribute('aria-valuenow', String(speedKmh));
    this.speedTrack.dataset.zone =
      speedKmh >= this.ramKillThresholdKmh
        ? 'kill'
        : speedKmh >= this.ramDamageThresholdKmh
          ? 'damage'
          : 'safe';
  }

  /**
   * Gun feedback for one fired ray: the muzzle event, the body of the shot for
   * flame cones, and whatever the round terminated against. `shotDirection`
   * must already hold the normalised travel direction for this shot.
   */
  private emitShotVfx(shot: TracerShot): void {
    this.vfx.muzzleFlash(shot.from, shot.to, muzzleStyleForShot(shot));
    if (shot.damageType === 'aoe') {
      this.vfx.flameJet(shot.from, shot.to, shot.overcharged);
    }

    const shielded =
      shot.hitZombieHandle !== null &&
      this.zombies.isShieldedTarget(shot.hitZombieHandle);
    const impact = impactKindForShot(shot, shielded);
    if (impact === null) return;
    this.vfx.bulletImpact(
      shot.to.x,
      shot.to.y,
      shot.to.z,
      this.shotDirection.x,
      this.shotDirection.y,
      this.shotDirection.z,
      impact,
    );
  }

  private showTracer(shot: TracerShot, faded: boolean): void {
    // The flamethrower draws its own cone of fire in the VFX layer; a tracer
    // line on top of it just reads as a stray orange wire.
    if (shot.damageType === 'aoe') return;
    this.tracerRenderer.spawn(
      shot.from,
      shot.to,
      tracerStyleForWeapon(shot.weaponDefId),
      tracerOptionsForShot(shot, faded),
    );
  }

  /** Debug seam control injection, matching ChamberMode's key-backed path. */
  debugSetSimPaused(paused: boolean): void {
    this.debugPaused = paused;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  /** Trailer-capture only: pull the follow camera closer (1 = normal). */
  debugSetCameraZoom(zoom: number): void {
    this.followCamera.setCaptureZoom(zoom);
  }

  debugStepSim(steps: number): void {
    if (this.disposed) return;
    const count = Math.max(0, Math.floor(Number.isFinite(steps) ? steps : 0));
    let stepped = 0;
    for (; stepped < count; stepped++) {
      this.stepFixed();
      if (this.pendingTransition !== null) {
        stepped++;
        break;
      }
    }
    this.syncView(stepped * FIXED_DT);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  debugSetControls(controls: Partial<VehicleControls>): void {
    Object.assign(this.controls, controls);
    if (controls.throttle !== undefined && controls.throttle > 0)
      this.keys.add('w');
    if (controls.throttle === 0) this.keys.delete('w');
    if (controls.steer !== undefined) {
      this.keys.delete('a');
      this.keys.delete('d');
      if (controls.steer < 0) this.keys.add('a');
      if (controls.steer > 0) this.keys.add('d');
    }
    if (controls.brake !== undefined) {
      if (controls.brake > 0) this.keys.add(' ');
      else this.keys.delete(' ');
    }
    if (controls.fire !== undefined) {
      if (controls.fire) this.keys.add('f');
      else this.keys.delete('f');
    }
    if (controls.reverse !== undefined) {
      if (controls.reverse > 0) this.keys.add('s');
      else this.keys.delete('s');
    }
  }

  debugStartWave(wave: number): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.zombies.reset();
    this.damageNumbers?.clear();
    this.waves.reset();
    this.setCurrentWave(wave);
    this.phase = 'active';
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.pendingTransition = null;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.threatAlert.hide();
    this.waveClearCard.hide();
    this.resetWaveStats();
    this.waves.startWave(this.currentWave);
    this.syncGameplayActivity();
  }

  debugKillAllZombies(): void {
    if (this.disposed || this.phase !== 'active') return;
    this.debugProgressionSuppressed = true;
    try {
      const unspawnedKills = this.waves.prepareDebugKillAll();
      this.kills += unspawnedKills;
      this.addPendingWaveKillReward(unspawnedKills * BASE_ZOMBIE_STATS.reward);
      this.zombies.forceKillAll();
      this.waves.fixedUpdate(0);
      this.attachNewIslands(this.vehicle.finishStep());
      this.queueCompletedStepTransition();
      this.syncView(0);
      this.renderer.render(this.scene, this.camera);
      this.flushPendingTransition();
    } finally {
      this.debugProgressionSuppressed = false;
    }
  }

  /**
   * Chip every part down to `fraction` of its maximum so tests can reach a
   * damaged-but-alive rig. Destruction is already covered by
   * `debugDestroyVehicle`; this exists for the repair flow, which only has
   * anything to offer while the vehicle is hurt but still driving.
   */
  debugDamageVehicle(fraction = 0.5): void {
    if (this.disposed || this.pendingTransition !== null) return;
    const keep = Math.min(0.95, Math.max(0.05, fraction));
    for (const [, part] of this.vehicle.assembled.parts) {
      if (!part.alive || part.detached) continue;
      part.health = Math.max(1, Math.round(part.def.health * keep));
    }
    this.syncView(0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Destroy the rig outright so tests can reach the game-over screen. */
  debugDestroyVehicle(): void {
    if (this.disposed || this.pendingTransition !== null) return;
    if (this.phase === 'countdown') this.startCurrentWave();
    if (this.phase !== 'active') return;
    for (const partId of Object.keys(this.vehicle.partHpSnapshot())) {
      this.vehicle.applyDirectDamage(partId, Number.MAX_SAFE_INTEGER);
    }
    this.attachNewIslands(this.vehicle.finishStep());
    this.queueCompletedStepTransition();
    this.syncView(0);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  debugForceWaveComplete(): void {
    if (this.disposed || this.pendingTransition !== null) return;
    if (this.phase === 'countdown') this.startCurrentWave();
    this.debugKillAllZombies();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.followCamera.setViewportHeight(height);
    this.mobileHud.refresh();
  }

  debugTelemetry(): SurvivalTelemetry {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    const angvel = this.vehicle.body.angvel();
    const boss = this.zombies.activeBoss();
    const bossLabel = boss?.bossLabel ?? null;
    return {
      mode: 'survival',
      kills: this.kills,
      score: this.runScore,
      phoneAddictKills: this.phoneAddictKills,
      wave: this.currentWave,
      zombiesAlive: this.zombies.getActiveCount(),
      money: this.callbacks.profileMoney(),
      runMoney: this.callbacks.runEarnings(),
      phase: this.phase,
      partHp: this.vehicle.partHpSnapshot(),
      integrityPct: this.vehicle.integrityPct(),
      boss:
        boss && bossLabel
          ? {
              id: bossLabel.id,
              name: bossLabel.name,
              health: boss.currentHealth,
              maxHealth: boss.maxHealth,
            }
          : null,
      vehiclePos: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      angvel: [angvel.x, angvel.y, angvel.z],
      cameraPos: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ],
      groundedWheels: this.vehicle.telemetry().groundedWheels,
      selfDestructArmed: this.selfDestructArmed,
      weapons: this.vehicle.weaponStates().map((weapon) => ({
        partId: weapon.partId,
        aimMode: weapon.def.aimMode,
        shotsFired: weapon.shotsFired,
      })),
      wheels: this.vehicle
        .wheels()
        .filter((wheel) => !wheel.broken)
        .map((wheel) => {
          const centre = wheelVisualCentre(this.vehicle.body, wheel);
          return {
            partId: wheel.partId,
            worldCentre: [centre.x, centre.y, centre.z] as [
              number,
              number,
              number,
            ],
          };
        }),
    };
  }

  debugZombiePositions(): [number, number, number][] {
    return this.zombies.debugAlivePositions();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.endlessBannerTimer);
    this.stopIconRender();
    stopDriveSfx();
    this.tuningUnsubscribe?.();
    this.tuningUnsubscribe = null;
    this.devPanel?.dispose();
    this.devPanel = null;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('pointerup', this.onFireUp);
    window.removeEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onAim);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onFireDown,
    );
    this.settingsSfxVolumeControl.input.removeEventListener(
      'input',
      this.onSfxVolumeInput,
    );
    this.settingsMusicVolumeControl.input.removeEventListener(
      'input',
      this.onMusicVolumeInput,
    );
    this.ui.removeEventListener('click', this.onUiButtonClick, true);
    this.firstPlay?.dispose();
    this.firstPlayVictory?.dispose();
    this.pickups.dispose();
    this.sentries.dispose();
    this.zombies.setDamageListener(null);
    this.zombies.onMeleeHit = null;
    this.damageNumbers.dispose();
    this.zombies.dispose();
    this.vfx.dispose();
    this.arena.dispose();
    this.vehicle.dispose();
    this.eventQueue.free();
    this.world.free();
    this.minimap.dispose();
    this.scopeCursor.dispose();
    this.warningHud.dispose();
    this.waveTimelineHud.dispose();
    this.threatAlert.dispose();
    this.waveClearCard.dispose();
    this.abilityBar.dispose();
    this.strikeGauge.dispose();
    this.buffBar.dispose();
    this.touchUnsubscribe?.();
    this.touchUnsubscribe = null;
    this.touch?.dispose();
    this.touch = null;
    this.mobileHud.dispose();
    this.ui.remove();
    this.tracerRenderer.dispose();
    // Before the scene walk below: the ghosts share the vehicle's geometry, so
    // they have to be off the graph before it is disposed.
    this.phaseGhosts.dispose();
    this.reinforceWard?.dispose();
    this.reinforceWard = null;
    this.droneEscort.dispose();
    this.threatPointer.dispose();
    disposeObject(this.scene);
    this.scene.clear();
    this.wheelMeshes.clear();
    this.wheelSpin.clear();
    this.islandGroups.clear();
  }
}

/**
 * The line under an ability's name in the HUD bar: what one activation buys at
 * the backing part's current upgrade level.
 */
function abilityDetail(assignment: AbilitySlotAssignment): string {
  const { ability, level } = assignment;
  if (ability.kind === 'shield') {
    const shield = effectiveShield(ability, level);
    return `${trimSeconds(shield.durationSeconds)}s immune`;
  }
  if (ability.kind === 'freeze') {
    const freeze = effectiveFreeze(ability, level);
    return `${freeze.targets} × ${trimSeconds(freeze.durationSeconds)}s`;
  }
  if (ability.kind === 'pulse') {
    const pulse = effectivePulse(ability, level);
    return `${Math.round(pulse.damage)} dmg · ${trimSeconds(pulse.radiusM)}m`;
  }
  if (ability.kind === 'hellfire') {
    const hellfire = effectiveHellfire(ability, level);
    return `×${trimSeconds(hellfire.damageMultiplier)} for ${trimSeconds(hellfire.durationSeconds)}s`;
  }
  if (ability.kind === 'phase') {
    return `${trimSeconds(effectivePhase(ability, level).distanceM)}m blink`;
  }
  if (ability.kind === 'flamelance') {
    const lance = effectiveFlameLance(ability, level);
    return `${trimSeconds(lance.durationSeconds)}s · ${trimSeconds(lance.rangeM)}m`;
  }
  if (ability.kind === 'reinforce') {
    const reinforce = effectiveReinforce(ability, level);
    return `${Math.round(reinforce.shieldHp)} shield · ${trimSeconds(reinforce.durationSeconds)}s, slowed`;
  }
  // The remaining kinds all read as "damage, or targets, at a radius"; they
  // used to fall through to the overdrive line below, which quoted a torque
  // multiplier at a Tesla Coil.
  if (ability.kind === 'zap') {
    return `${Math.round(effectiveZap(ability, level).damage)} dmg`;
  }
  if (ability.kind === 'rocket') {
    const rocket = effectiveRocket(ability, level);
    return `${Math.round(rocket.damage)} dmg · ${trimSeconds(rocket.radiusM)}m`;
  }
  if (ability.kind === 'charm') {
    const charm = effectiveCharm(ability, level);
    return `${charm.targets} × ${trimSeconds(charm.durationSeconds)}s`;
  }
  if (ability.kind === 'thump') {
    const thump = effectiveThump(ability, level);
    return `${Math.round(thump.knockbackSpeed)} m/s · ${trimSeconds(thump.radiusM)}m`;
  }
  const overdrive = effectiveOverdrive(ability, level);
  return `×${trimSeconds(overdrive.torqueMultiplier)} for ${trimSeconds(overdrive.durationSeconds)}s`;
}

/** One decimal at most, with no trailing ".0" — "2.5" and "4", never "4.0". */
function trimSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10}`;
}

function overlayPanel(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'panel';
  overlay.style.cssText =
    'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);' +
    'min-width:290px;padding:24px;text-align:center;z-index:20';
  return overlay;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object as THREE.Mesh | THREE.Line;
    geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) materials.add(material);
    } else {
      materials.add(renderable.material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
