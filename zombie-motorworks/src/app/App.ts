/**
 * Application shell: owns the WebGL renderer and switches between the title,
 * editor, test chamber, and survival modes. The Rapier wasm handshake runs once
 * per session and is owned by `physics.ts`, which boot starts early so the
 * compile overlaps the module fetches rather than following them.
 * Runtime modes deep-clone the blueprint; returning restores the editor with
 * the original untouched.
 */

import * as THREE from 'three';
import { funnel } from './funnel.ts';
import type {
  PartConfig,
  PlacedPart,
  Vec3i,
  VehicleBlueprint,
} from '../core/types.ts';
import {
  createEmptyBlueprint,
  pruneBlueprintToSurvivors,
} from '../core/blueprint.ts';
import { serializeBlueprint, deserializeBlueprint } from '../core/serialize.ts';
import { validateBlueprint } from '../core/placement.ts';
import { planRebuild } from '../core/rebuild.ts';
import { analyzeVehicle } from '../core/analysis.ts';
import { getPartDef, PART_CATALOG } from '../core/parts.ts';

/**
 * Stock count handed to every part in a mode with an unlimited inventory. Big
 * enough that no build could exhaust it, small enough that the garage's counts
 * still render as a number rather than scientific notation.
 */
const INFINITE_STOCK = 9_999;
import {
  CREATIVE_WALLET,
  DEFAULT_GAME_MODE_ID,
  getGameMode,
  type GameModeId,
} from '../core/gameModes.ts';
import {
  canPlayDaily,
  dailyBiome,
  dailyLoadout,
  dailySeed,
  dayIdFor,
} from '../core/dailyChallenge.ts';
import { dailyStore } from './dailyStore.ts';
import { getEffectiveDef } from '../core/upgrades.ts';
import { composeOrientations, orientationFromSteps } from '../core/grid.ts';
import {
  BLUEPRINT_STORAGE_KEY,
  EditorMode,
  type EditorSfxCue,
  type EditorViewState,
} from '../editor/EditorMode.ts';
import { CommandHistory } from '../core/commands.ts';
import { beginPhysicsInit } from './physics.ts';
import {
  BOOT_ARENA_SPAN,
  reportBootProgress,
  reportBootStage,
} from './bootSplash.ts';
import { maxPixelRatio } from '../ui/device.ts';
import { ChamberMode, type ScenarioName } from '../chamber/ChamberMode.ts';
import type { VehicleControls } from '../runtime/vehicle.ts';
import { SurvivalMode } from '../survival/SurvivalMode.ts';
import {
  canAfford,
  partRepairCost,
  repairPlan,
  scaledHpOnUpgrade,
  type RunState,
} from '../core/economy.ts';
import type { BiomeId } from '../core/biomes.ts';
import {
  DEFAULT_BUILD_ID,
  buildBeginnerBlueprint,
  buildFirstPlayBlueprint,
  buildStarterRig,
  buildStarterUnlocks,
  isBuildId,
  isFirstPlayBlueprint,
  type BuildId,
} from '../core/builds.ts';
import type { DebugCameraPose } from '../core/cameraPose.ts';
import { defaultProfile, type PlayerProfile } from '../core/profile.ts';
import type { RunOutcome } from '../core/leaderboard.ts';
import type { SavedRun } from '../core/runSave.ts';
import { randomSeed } from '../core/rng.ts';
import { DEFAULT_BIOME_ID } from '../survival/arena/recipes/index.ts';
import { isDevMode, waveJumpTarget } from '../survival/devtuning/devMode.ts';
import { leaderboardStore } from './leaderboardStore.ts';
import {
  platformHasAds,
  reportPlatformHappyTime,
  requestPlatformCommercialBreak,
  setPlatformGameplayActive,
  submitPlatformScore,
} from './platform.ts';
import { purgeFirstPlayLoaner } from './firstPlayLoaner.ts';
import { PROFILE_STORAGE_KEY, profileStore } from './profileStore.ts';
import { runSaveStore } from './runSaveStore.ts';
import { TitleScreen } from './TitleScreen.ts';
import {
  playSfx,
  startGarageMusic,
  stopGarageMusic,
  unlockAudio,
  type SfxName,
} from './sfx.ts';

/** Gestures a browser accepts as "the user is here" for unlocking audio. */
const FIRST_GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

const EDITOR_SFX: Record<EditorSfxCue, SfxName> = {
  click: 'uiClick',
  deny: 'uiDeny',
  place: 'garagePlace',
  remove: 'garageRemove',
  purchase: 'garagePurchase',
  repair: 'garageRepair',
  upgrade: 'garageUpgrade',
};

export interface RunCheckpoint {
  /** Wave the player will play next. */
  wave: number;
  /** Vehicle state committed at the start of `wave`. */
  blueprint: VehicleBlueprint;
  /** Per-part HP committed at the start of `wave`. */
  partHp: Record<string, number>;
  /** Parts destroyed in a prior wave, not yet bought back and re-placed. */
  missingParts: PlacedPart[];
  /** Cumulative kills committed before `wave`. */
  kills: number;
  /** Arena recipe shared by every wave in this run. */
  biomeId: BiomeId;
  /** Rule set this run is played under; fixed for its whole life. */
  modeId: GameModeId;
  /** Procedural arena seed shared by every wave in this run. */
  seed: number;
  /** Arcade run score committed before `wave`. */
  score: number;
  /** Run earnings already credited before `wave`. */
  bankedEarnings: number;
  /** Arena seconds played before `wave`, carried across garage trips. */
  elapsedSeconds: number;
}

export interface CheckpointRunState extends RunState {
  partHp: Record<string, number>;
  kills: number;
  score: number;
  biomeId: BiomeId;
  seed: number;
  elapsedSeconds: number;
}

/** Effective maximum HP for every placed part in a blueprint. */
export function fullPartHp(bp: VehicleBlueprint): Record<string, number> {
  return Object.fromEntries(
    bp.parts.map((part) => [part.id, getEffectiveDef(part).health]),
  );
}

/**
 * The immutable wave-start state for a brand-new run.
 *
 * `seed` is a parameter rather than always a fresh roll because the Daily Run
 * derives its arena from the calendar: two players on the same date have to get
 * the same map out of the same generator, or the board is comparing different
 * games. Every other mode leaves it out and takes the dice.
 */
export function createInitialRunCheckpoint(
  bp: VehicleBlueprint,
  biomeId: BiomeId,
  modeId: GameModeId = DEFAULT_GAME_MODE_ID,
  seed: number = randomSeed(),
): RunCheckpoint {
  return {
    wave: 1,
    blueprint: pruneBlueprintToSurvivors(
      bp,
      bp.parts.map((part) => part.id),
    ),
    partHp: fullPartHp(bp),
    missingParts: [],
    kills: 0,
    biomeId,
    modeId,
    seed,
    score: 0,
    bankedEarnings: 0,
    elapsedSeconds: 0,
  };
}

function partHpForBlueprint(
  bp: VehicleBlueprint,
  partHp: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    bp.parts.map((part) => [
      part.id,
      partHp[part.id] ?? getEffectiveDef(part).health,
    ]),
  );
}

/**
 * Merge parts destroyed in earlier, still-unaddressed waves with this wave's
 * fresh losses, then drop anything that is present again (already restored).
 */
function mergeMissingParts(
  carriedOver: readonly PlacedPart[],
  destroyedThisWave: readonly PlacedPart[],
  presentIds: ReadonlySet<string>,
): PlacedPart[] {
  const byId = new Map(carriedOver.map((part) => [part.id, part]));
  for (const part of destroyedThisWave) byId.set(part.id, part);
  for (const id of presentIds) byId.delete(id);
  return [...byId.values()];
}

/** Commit permanent wave damage and prepare the vehicle's next-wave state. */
export function createClearedWaveCheckpoint(input: {
  blueprint: VehicleBlueprint;
  nextWave: number;
  survivingPartIds: readonly string[];
  partHp: Readonly<Record<string, number>>;
  missingParts: readonly PlacedPart[];
  kills: number;
  biomeId: BiomeId;
  /**
   * Carried forward unchanged: a run cannot change rules mid-flight. Optional
   * because Campaign is the default and every pre-existing caller means it.
   */
  modeId?: GameModeId;
  seed: number;
  score: number;
  bankedEarnings: number;
  elapsedSeconds: number;
}): RunCheckpoint {
  const blueprint = pruneBlueprintToSurvivors(
    input.blueprint,
    input.survivingPartIds,
  );
  const survivors = new Set(input.survivingPartIds);
  const destroyedThisWave = input.blueprint.parts.filter(
    (part) => !survivors.has(part.id),
  );
  const presentIds = new Set(blueprint.parts.map((part) => part.id));
  return {
    wave: input.nextWave,
    blueprint,
    modeId: input.modeId ?? DEFAULT_GAME_MODE_ID,
    partHp: partHpForBlueprint(blueprint, input.partHp),
    missingParts: mergeMissingParts(
      input.missingParts,
      destroyedThisWave,
      presentIds,
    ),
    kills: input.kills,
    biomeId: input.biomeId,
    seed: input.seed,
    score: input.score,
    bankedEarnings: input.bankedEarnings,
    elapsedSeconds: input.elapsedSeconds,
  };
}

/** Include garage edits in the checkpoint while preserving carried damage. */
export function prepareCheckpointForGarageFight(
  checkpoint: RunCheckpoint,
  bp: VehicleBlueprint,
): RunCheckpoint {
  const blueprint = pruneBlueprintToSurvivors(
    bp,
    bp.parts.map((part) => part.id),
  );
  const checkpointParts = new Map(
    checkpoint.blueprint.parts.map((part) => [part.id, part]),
  );
  const presentIds = new Set(blueprint.parts.map((part) => part.id));
  return {
    ...checkpoint,
    blueprint,
    partHp: Object.fromEntries(
      blueprint.parts.map((part) => {
        const checkpointPart = checkpointParts.get(part.id);
        const newMaxHp = getEffectiveDef(part).health;
        if (!checkpointPart) return [part.id, newMaxHp];
        const oldMaxHp = getEffectiveDef(checkpointPart).health;
        const currentHp = checkpoint.partHp[part.id] ?? oldMaxHp;
        return [part.id, scaledHpOnUpgrade(currentHp, oldMaxHp, newMaxHp)];
      }),
    ),
    missingParts: checkpoint.missingParts.filter(
      (part) => !presentIds.has(part.id),
    ),
  };
}

/** Survival input derived only from the committed wave-start checkpoint. */
export function runStateFromCheckpoint(
  checkpoint: RunCheckpoint,
): CheckpointRunState {
  return {
    wave: checkpoint.wave,
    partHp: { ...checkpoint.partHp },
    kills: checkpoint.kills,
    biomeId: checkpoint.biomeId,
    modeId: checkpoint.modeId,
    seed: checkpoint.seed,
    score: checkpoint.score,
    elapsedSeconds: checkpoint.elapsedSeconds,
  };
}

/** Failed-wave recovery keeps committed parts but restores all of their HP. */
export function recoverRunFromCheckpoint(checkpoint: RunCheckpoint): {
  blueprint: VehicleBlueprint;
  partHp: Record<string, number>;
} {
  const blueprint = pruneBlueprintToSurvivors(
    checkpoint.blueprint,
    checkpoint.blueprint.parts.map((part) => part.id),
  );
  return { blueprint, partHp: fullPartHp(blueprint) };
}

/** Persistable schema derived only from a committed wave-start checkpoint. */
export function savedRunFromCheckpoint(
  checkpoint: RunCheckpoint,
  savedAt: number,
  phase: 'wave' | 'build' = 'wave',
  activeWave: number = checkpoint.wave,
): SavedRun {
  return {
    schemaVersion: 6,
    phase,
    activeWave,
    wave: checkpoint.wave,
    kills: checkpoint.kills,
    biomeId: checkpoint.biomeId,
    seed: checkpoint.seed,
    score: checkpoint.score,
    bankedEarnings: checkpoint.bankedEarnings,
    elapsedSeconds: checkpoint.elapsedSeconds,
    blueprint: checkpoint.blueprint,
    partHp: { ...checkpoint.partHp },
    missingParts: checkpoint.missingParts.map((part) => ({ ...part })),
    savedAt,
  };
}

/** Apply permanent wave progress and its catalog unlock to a profile. */
/**
 * Money handed out by a wave jump.
 *
 * Deliberately a grant rather than a simulation of what a real player would be
 * holding: a real wallet reflects what they spent on repairs and what they
 * chose not to buy, none of which a jump can know. A jump exists to try rigs
 * against a wave, so the wallet should not be the thing under test — checking
 * whether the economy affords that rig needs a real run.
 */
function devWalletForWave(wave: number): number {
  return 2000 + 1500 * wave;
}

export function recordWaveCleared(profile: PlayerProfile, wave: number): void {
  profile.highestWaveCleared = Math.max(profile.highestWaveCleared ?? 0, wave);
}

/** Apply the lifetime kill progress used by the EMP unlock gate. */
export function recordPhoneAddictKilled(profile: PlayerProfile): void {
  profile.phoneAddictsKilled = (profile.phoneAddictsKilled ?? 0) + 1;
}

/**
 * Bank a block a salvage crate handed the player mid-wave: one more in the
 * Inventory, and the catalog entry unlocked if it was not already, since a
 * block they cannot arm in the Garage would be no reward at all. Unknown
 * definition IDs are ignored rather than persisted into a profile the decoder
 * would strip on the next load.
 */
export function recordSalvagedPart(
  profile: PlayerProfile,
  defId: string,
): boolean {
  if (PART_CATALOG[defId] === undefined) return false;
  if (!profile.unlockedDefIds.includes(defId)) {
    profile.unlockedDefIds.push(defId);
  }
  profile.inventory ??= {};
  profile.inventory[defId] = (profile.inventory[defId] ?? 0) + 1;
  return true;
}

/**
 * Reset what a finished run costs: money, inventory, and the vehicle its
 * upgrades lived on. Permanently unlocked parts and lifetime progression
 * counters survive, so the catalog a player earned carries into the next run.
 */
export function resetProfileForNewRun(profile: PlayerProfile): void {
  const fresh = defaultProfile();
  profile.money = fresh.money;
  profile.inventory = { ...fresh.inventory };
  delete profile.currentBlueprintName;
}

/** Restore every persistent profile field owned by a fresh game. */
export function resetProfileForNewGame(profile: PlayerProfile): void {
  const fresh = defaultProfile();
  profile.schemaVersion = fresh.schemaVersion;
  profile.money = fresh.money;
  profile.unlockedDefIds = [...fresh.unlockedDefIds];
  profile.inventory = { ...fresh.inventory };
  // Curated slots would otherwise outlive the stock that justified them.
  delete profile.hotbarDefIds;
  delete profile.currentBlueprintName;
  delete profile.highestWaveCleared;
  delete profile.phoneAddictsKilled;
}

/**
 * Whether boot should hand the player a new game rather than the title screen.
 *
 * Only a player with nothing at all — no garage, no profile, no run in
 * progress — skips it. Both saves have to be checked: a run save alone means
 * someone who quit mid-run, and dropping them into a brand-new game would
 * erase the run they came back for.
 */
export function shouldSkipTitleAtBoot(
  hasStoredSave: boolean,
  hasStoredRun: boolean,
): boolean {
  return !hasStoredSave && !hasStoredRun;
}

export class App {
  private renderer!: THREE.WebGLRenderer;
  private editor: EditorMode | null = null;
  private chamber: ChamberMode | null = null;
  private survival: SurvivalMode | null = null;
  private title: TitleScreen | null = null;
  private bp: VehicleBlueprint = createEmptyBlueprint('starter-rig');
  private profile: PlayerProfile;
  private readonly saveExistedAtBoot: boolean;
  /** Survive editor <-> runtime-mode round trips: undo history and camera/layer. */
  private readonly history: CommandHistory;
  private savedView: EditorViewState | undefined;
  private activeRun: RunState | null = null;
  private checkpoint: RunCheckpoint | null = null;
  private inBuildPhase = false;
  private runMoneyEarned = 0;
  /** Map the next run starts on. Chosen on the title screen, kept in the Profile. */
  private preferredBiomeId: BiomeId;
  /**
   * Build the next run starts on. Like the map it is chosen on the title screen
   * and kept in the Profile, but unlike the map it also has to survive a run
   * ending: `resetProgressionForNewRun` hands back a fresh rig, and that rig
   * has to be the build the player is playing.
   */
  private preferredBuildId: BuildId;
  private profileDirty = false;
  private profileFlushTimer: number | undefined;
  /** Rules the run in flight is played under; see `enterSandboxMode`. */
  private activeModeId: GameModeId = DEFAULT_GAME_MODE_ID;
  /** The campaign profile, parked while a sandbox mode plays on a copy. */
  private sandboxProfileBackup: PlayerProfile | null = null;
  /** While true, nothing writes the profile to storage. */
  private profileSealed = false;
  /**
   * Whether this run's garage opens without a Store. True for Creative, and for
   * a Daily draft day. A property of one attempt, not of a saved player, which
   * is why it lives here rather than on the profile.
   */
  private storeHidden = false;
  private saveFailureNotified = false;
  private pendingEditorNotice: string | undefined;
  private pendingIsNewGame = false;
  /**
   * The wave about to be deployed is a brand-new player's very first, so
   * Survival runs the First Play coach over it. Cleared by the deployment that
   * consumes it, so it can never leak into a second wave or a resumed run.
   */
  private firstPlayWave = false;
  /** Pending coalesced re-fit; see `onViewportChange`. */
  private viewportFrame: number | undefined;
  /**
   * The pixel ratio and backing-store dimensions the canvas is currently built
   * at. `applyViewport` compares against these to avoid reallocating a drawing
   * buffer that would come back identical; zero means "not yet applied".
   */
  private appliedPixelRatio = 0;
  private appliedDeviceWidth = 0;
  private appliedDeviceHeight = 0;
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  private contextLost = false;
  /** Shown over the viewport for as long as the GL context is gone. */
  private readonly contextNotice = createContextNotice();

  constructor(private readonly root: HTMLElement) {
    // Before anything reads storage: a browser that already banked the First
    // Play loaner under an older build is carrying a rig it was never sold, and
    // `saveExistedAtBoot` a line down must not count that as a game worth
    // continuing.
    purgeFirstPlayLoaner();
    // Raw-key detection must happen before profile loading can synthesize an
    // in-memory default. Loading currently does not persist it, but this order
    // keeps title-screen availability independent of that implementation detail.
    this.saveExistedAtBoot = this.hasStoredSave();
    this.profile = profileStore.load();
    this.preferredBiomeId = this.profile.preferredBiomeId ?? DEFAULT_BIOME_ID;
    this.preferredBuildId = this.profile.buildId ?? DEFAULT_BUILD_ID;
    this.history = new CommandHistory((moneyDelta) =>
      this.changeMoney(moneyDelta, true),
    );
    window.addEventListener('pagehide', this.flushDirtyProfile);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Queue a re-fit for the next frame.
   *
   * Deliberately not the work itself. `visualViewport` fires `resize` on every
   * frame the mobile URL bar slides, on every soft-keyboard open and through a
   * pinch-zoom, so binding the resize directly to it ran the whole re-fit
   * dozens of times a second. Coalescing to one frame makes a burst of events
   * cost exactly one re-fit, and `applyViewport` then drops even that when
   * nothing actually moved.
   */
  private readonly onViewportChange = (): void => {
    if (this.viewportFrame !== undefined) return;
    this.viewportFrame = requestAnimationFrame(() => {
      this.viewportFrame = undefined;
      this.applyViewport();
    });
  };

  private readonly onOrientationChange = (): void => {
    requestAnimationFrame(this.onViewportChange);
  };

  /**
   * Re-fit the renderer and every live mode to the current viewport.
   *
   * The pixel-ratio ceiling is re-read here rather than only at boot because a
   * tablet gaining a mouse changes what `maxPixelRatio` reports, and because
   * mobile browsers can hand back a different `devicePixelRatio` after a
   * rotation.
   *
   * The early-out is the point of this function. `WebGLRenderer.setSize`
   * assigns `canvas.width`/`canvas.height` unconditionally, and assigning
   * either — even the identical value — destroys and reallocates the entire
   * drawing buffer. With `antialias: true` at a pixel ratio of 2 that is tens
   * of megabytes of multisampled colour and depth torn down and rebuilt per
   * call, which is one of the surest ways to make a mobile GPU drop the
   * context out from under the page. So the backing store is only touched when
   * its dimensions would genuinely differ.
   */
  private applyViewport(): void {
    // Reachable before `start()` has built the renderer: a rotation during boot
    // fires this off the listeners the constructor is not responsible for.
    if (!this.renderer) return;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    // A collapsed layout (a hidden container mid-transition) would otherwise
    // resize the buffer to nothing and force a second reallocation on the way
    // back out.
    if (width === 0 || height === 0) return;

    const ratio = Math.min(window.devicePixelRatio, maxPixelRatio());
    const deviceWidth = Math.floor(width * ratio);
    const deviceHeight = Math.floor(height * ratio);
    if (
      deviceWidth === this.appliedDeviceWidth &&
      deviceHeight === this.appliedDeviceHeight &&
      ratio === this.appliedPixelRatio
    ) {
      return;
    }

    // `setPixelRatio` reallocates on its own — it re-runs `setSize` at the
    // dimensions already stored — so it is only called when the ratio actually
    // moved. An ordinary resize therefore costs one reallocation rather than
    // the two the unconditional pair used to cost.
    if (ratio !== this.appliedPixelRatio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.appliedPixelRatio = ratio;
    this.appliedDeviceWidth = deviceWidth;
    this.appliedDeviceHeight = deviceHeight;

    this.editor?.resize(width, height);
    this.chamber?.resize(width, height);
    this.survival?.resize(width, height);
    this.title?.resize(width, height);
  }

  /**
   * The GPU handed the canvas back.
   *
   * Calling `preventDefault` is what makes this recoverable at all: without it
   * the browser is not permitted to attempt a restore, so a backgrounded tab on
   * Android — which routinely reclaims GPU resources — left a black canvas and
   * a frame loop drawing into a dead context for the rest of the session. That
   * was the single largest error on the portal.
   */
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.contextNotice.hidden = false;
  };

  /**
   * The context came back. Three rebuilds its GPU-side state lazily as objects
   * are drawn again, but the drawing buffer returns at its default size, so the
   * fit has to be re-applied before the first frame — and the cached dimensions
   * have to be cleared first or `applyViewport` would correctly decide there is
   * nothing to do.
   */
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.contextNotice.hidden = true;
    this.appliedPixelRatio = 0;
    this.appliedDeviceWidth = 0;
    this.appliedDeviceHeight = 0;
    this.applyViewport();
  };

  /**
   * Web Audio stays suspended until a gesture, and the title screen used to be
   * the guaranteed one: every route out of it went through a button. A
   * first-time player now boots straight into the Garage, so the unlock is
   * hung off the first gesture anywhere instead of off any one screen's
   * buttons. One shot — it removes itself.
   */
  private readonly onFirstGesture = (): void => {
    for (const type of FIRST_GESTURE_EVENTS) {
      window.removeEventListener(type, this.onFirstGesture, true);
    }
    unlockAudio();
  };

  /**
   * Build the renderer, wait for physics, then mount the first mode.
   *
   * `physicsReady` is handed in rather than started here so the wasm compile
   * overlaps the module fetches boot is already doing. Callers with nothing
   * in flight can omit it and this starts the handshake itself.
   */
  /**
   * Whether a wave is actually running, as opposed to a menu, the garage, a
   * pause, or a result card.
   *
   * The portal is told this already; the retention funnel needs the same fact
   * to separate time spent playing from time spent deciding, and a session
   * measured the portal's way is the one that can be compared against a
   * portal's own numbers. Mirrored here rather than read back out of
   * `platform.ts`, because a build with no portal reports nothing and would
   * leave the funnel with no clock at all.
   */
  private gameplayActive = false;

  /** Report gameplay state to both the portal and the funnel's clock. */
  private setGameplayActive(active: boolean): void {
    this.gameplayActive = active;
    setPlatformGameplayActive(active);
  }

  async start(physicsReady?: Promise<void>): Promise<void> {
    // Everything down to the frame loop is physics-free, so it happens before
    // the wait rather than after it: by the time the engine lands the canvas is
    // sized, listening, and ready to be drawn into.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // A phone's native 3x ratio is more fragments than the frame budget wants
    // and more detail than a moving 3D scene shows, so it is capped — but only
    // capped. Dropping to 1 on mobile, which is the usual portal advice, turns
    // this game's hard-edged voxel art and thin HUD strokes to mush.
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, maxPixelRatio()),
    );
    this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
    // Seed what `applyViewport` compares against, so the first resize event to
    // arrive after boot is correctly recognised as a no-op rather than
    // reallocating the buffer that was just built.
    this.appliedPixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio());
    this.appliedDeviceWidth = Math.floor(
      this.root.clientWidth * this.appliedPixelRatio,
    );
    this.appliedDeviceHeight = Math.floor(
      this.root.clientHeight * this.appliedPixelRatio,
    );
    this.renderer.domElement.className = 'viewport';
    this.root.appendChild(this.renderer.domElement);
    this.root.appendChild(this.contextNotice);
    // A lost context is survivable, but only if the loss is acknowledged — see
    // `onContextLost`. Registered on the canvas itself, which is where the
    // events are dispatched.
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.onContextLost,
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    window.addEventListener('resize', this.onViewportChange);
    // Mobile Safari resizes the *visual* viewport when the URL bar slides away
    // without always firing a window resize. Without this the canvas keeps the
    // old size and the followed vehicle drifts off the bottom of the screen.
    window.visualViewport?.addEventListener('resize', this.onViewportChange);
    // A phone rotating is a resize, but mobile Safari fires `orientationchange`
    // before the new viewport metrics have settled and does not always follow
    // with a `resize` — so the same work is queued a frame later rather than
    // read straight out of a stale layout.
    window.addEventListener('orientationchange', this.onOrientationChange);
    for (const type of FIRST_GESTURE_EVENTS) {
      window.addEventListener(type, this.onFirstGesture, true);
    }
    reportBootStage('rendererReady');

    // Modes build Rapier worlds in their constructors, so this is the point the
    // engine actually has to exist.
    await (physicsReady ?? beginPhysicsInit());
    reportBootStage('engineReady');

    const jumpTo = waveJumpTarget();
    if (jumpTo === null || !this.devWaveJump(jumpTo)) {
      // A first-time player has nothing to resume and no garage to protect, so
      // the title screen is a menu whose only real answer is "New Game" — and
      // the Garage behind it is a build editor they have no reason to trust
      // yet. `beginFirstRun` drops them straight into wave one instead, and the
      // Garage introduces itself afterwards. Everything the title offers —
      // maps, leaderboard, badges — is one Menu press away, and the map they
      // skip past is the one a new run defaults to anyway.
      if (this.isFirstBoot()) this.beginFirstRun();
      else this.showTitle(this.saveExistedAtBoot);
    }
    reportBootStage('modeReady');

    let lastFrameMs = performance.now();
    const loop = (): void => {
      requestAnimationFrame(loop);
      const nowMs = performance.now();
      // Fed from here rather than from a mode's own update, because the funnel
      // has to keep counting on the title and in the garage — a player sitting
      // on a screen doing nothing is precisely the case worth catching — and
      // only `App` sees every screen. `playing` is the same fact the portal is
      // told: a live wave, not a menu, a pause, or a result card.
      funnel.tick(nowMs - lastFrameMs, this.gameplayActive);
      lastFrameMs = nowMs;
      // Every mode's `update` ends in a draw, and drawing into a lost context
      // is at best wasted work and at worst a flood of GL errors. Holding the
      // whole update also freezes simulation for the duration, which is what a
      // player who backgrounded the tab wants to come back to.
      if (this.contextLost) return;
      this.title?.update();
      this.editor?.update();
      this.chamber?.update();
      this.survival?.update();
    };
    loop();

    // One loading screen, not two. A first boot used to drop the splash the
    // instant a mode existed and immediately raise the arena's own full-bleed
    // scrim behind it — the same wait, counted twice, in front of the player
    // who has the least patience for it. Holding the splash over the arena
    // load keeps it to a single bar that fills once and then hands over to a
    // level that is standing. Started after `loop`, because the gate that
    // times the arena load out runs on the frame loop.
    await this.holdBootSplashForArena();
  }

  /**
   * Keep the boot splash up, and its bar moving, until the first arena is
   * playable.
   *
   * Only ever the first-boot arena: every other route out of boot lands on the
   * title screen, which is ready the moment it is mounted. Awaited without a
   * timeout of its own because `SurvivalMode.whenPlayable` already settles on
   * its own gate, on a timeout, and on disposal.
   */
  private async holdBootSplashForArena(): Promise<void> {
    const survival = this.survival;
    if (survival === null) return;
    // Only a first boot gets here, and this is the longest wait of the lot:
    // everything after `modeReady` is the arena being built behind a bar. The
    // gap between the two stages is every new player who never saw a zombie —
    // which is why it is reported from inside the branch that actually waits
    // rather than after it, where a title-screen boot would report an arena
    // load that never happened.
    const playable = survival.whenPlayable();
    let live = true;
    void playable.then(() => {
      live = false;
    });
    const tick = (): void => {
      if (!live) return;
      reportBootProgress(
        BOOT_ARENA_SPAN[0] +
          survival.arenaLoadFraction() *
            (BOOT_ARENA_SPAN[1] - BOOT_ARENA_SPAN[0]),
        'Rolling out',
      );
      requestAnimationFrame(tick);
    };
    tick();
    await playable;
    funnel.bootStage('arenaReady');
  }

  /**
   * True when this browser has never played. Read through `saveExistedAtBoot`
   * so a profile this session writes cannot retroactively change what boot
   * decided.
   */
  private isFirstBoot(): boolean {
    return shouldSkipTitleAtBoot(this.saveExistedAtBoot, runSaveStore.has());
  }

  /** True when a resumable run save exists. */
  hasStoredRun(): boolean {
    return runSaveStore.has();
  }

  /**
   * Persist the in-progress run and return to the title screen.
   * Called from the survival pause overlay; live mid-wave state is discarded.
   */
  saveAndQuitRun(): void {
    if (this.checkpoint === null) return;
    if (!this.writeRunSave('wave')) return;

    // A banked run is not a lost one, but it is a session that ended here, and
    // the wave it ended on is the number worth having.
    funnel.garage('save-and-quit');
    funnel.endRun('abandon');

    this.flushProfile();
    this.survival?.dispose();
    this.survival = null;
    this.clearSessionState();
    this.showTitle();
  }

  /**
   * The Build Phase twin of `saveAndQuitRun`. The Garage between waves hides
   * the Menu button and `returnToTitle` refuses to run there, so without this
   * the wave a player stopped on could only ever be banked from the arena.
   */
  saveAndQuitFromGarage(): void {
    if (this.checkpoint === null || this.editor === null) return;
    this.bp = this.editor.blueprint();
    this.editor.persistGarage();
    this.flushProfile();
    if (!this.writeRunSave('build')) return;
    funnel.garage('save-and-quit');
    funnel.endRun('abandon');
    this.editor.dispose();
    // `update()` has no disposed guard, so a retained editor would keep
    // rendering its emptied scene over the title screen every frame.
    this.editor = null;
    this.clearSessionState();
    this.showTitle();
  }

  /** Load the saved run and drop straight into survival at its wave. */
  resumeSavedRun(): boolean {
    const savedRun = runSaveStore.load();
    if (savedRun === null) return false;

    this.disposeTitle();
    this.clearSessionState();
    this.bp = savedRun.blueprint;
    this.runMoneyEarned = savedRun.bankedEarnings;
    this.checkpoint = {
      wave: savedRun.wave,
      blueprint: savedRun.blueprint,
      partHp: { ...savedRun.partHp },
      missingParts: savedRun.missingParts.map((part) => ({ ...part })),
      kills: savedRun.kills,
      biomeId: savedRun.biomeId,
      // A save on disk is always a campaign run: every other mode is sealed
      // against persistence (see `persistsProgress`), so none of them can have
      // written this record and the schema needs no mode field.
      modeId: 'campaign',
      seed: savedRun.seed,
      score: savedRun.score,
      bankedEarnings: savedRun.bankedEarnings,
      elapsedSeconds: savedRun.elapsedSeconds,
    };
    // The resumed run keeps the map on its checkpoint; the title-screen pick
    // stays untouched so it still describes the player's next new run.
    this.activeRun = { wave: savedRun.activeWave };
    this.inBuildPhase = savedRun.phase === 'build';
    if (this.inBuildPhase) {
      const loaded = this.loadCurrentBlueprint();
      this.bp =
        loaded.kind === 'loaded' ? loaded.blueprint : savedRun.blueprint;
      this.openEditor();
    } else {
      this.enterSurvival(this.bp, runStateFromCheckpoint(this.checkpoint));
    }
    return true;
  }

  /**
   * Entry point for a `?build=` share link: open the garage, then hand the code
   * to the editor's import flow so the player still chooses where it lands.
   */
  async importBuildCode(code: string): Promise<void> {
    this.openEditor();
    await this.editor?.importShareCode(code);
  }

  private openEditor(): void {
    // Before the editor is built, not after: its first analysis pass reports
    // whether the rig is deployable, and that fact belongs inside the garage
    // visit it describes rather than ahead of it.
    funnel.enterScreen('garage');
    this.disposeTitle();
    this.chamber?.dispose();
    this.chamber = null;
    this.survival?.dispose();
    this.survival = null;
    // Reopening on top of a live garage (the new-game build pick does exactly
    // that) used to orphan the old UI root: nothing held a reference to it any
    // more, so the next mode change disposed the new editor and left the old
    // panels floating over the arena.
    this.editor?.dispose();
    this.editor = new EditorMode(
      this.root,
      this.renderer,
      this.bp,
      (bp) => this.enterChamber(bp),
      (bp) => void this.startOrResumeRun(bp),
      {
        history: this.history,
        view: this.savedView,
        profile: this.profile,
        persistProfile: () => this.saveProfileOrThrow(),
        onMenu: () => this.returnToTitle(),
        onSaveAndQuit: () => this.saveAndQuitFromGarage(),
        onSfx: (cue) => playSfx(EDITOR_SFX[cue]),
        runContext:
          this.activeRun && this.inBuildPhase ? this.activeRun : undefined,
        runRepair:
          this.activeRun && this.inBuildPhase && this.checkpoint
            ? {
                partHp: () => ({ ...this.checkpoint?.partHp }),
                repairPart: (id) => this.repairPart(id),
                repairAll: () => this.repairAll(),
                missingParts: () => this.checkpointMissingParts(),
              }
            : undefined,
        purchaseRules: {
          infiniteInventory: getGameMode(this.activeModeId).infiniteInventory,
          hideStore: this.storeHidden,
        },
        notice: this.pendingEditorNotice,
        isNewGame: this.pendingIsNewGame,
        onChooseBuild: (buildId) => this.applyChosenBuild(buildId),
      },
    );
    this.pendingEditorNotice = undefined;
    this.pendingIsNewGame = false;
    this.editor.resize(this.root.clientWidth, this.root.clientHeight);
    startGarageMusic();
    // Not gameplay. The Garage is where a run is planned rather than played —
    // a store, an inventory, and a parts grid — and portals class a menu
    // between levels as a gameplay break however much time is spent in it.
    // Reporting it as play would also mean gameplay never stopped at a wave
    // end, which is the first thing a platform integration review checks.
    this.setGameplayActive(false);
  }

  private showTitle(hasSave = this.hasStoredSave()): void {
    if (this.activeRun && this.inBuildPhase) return;
    funnel.enterScreen('title');
    this.setGameplayActive(false);
    stopGarageMusic();
    this.disposeTitle();
    this.title = new TitleScreen(
      this.root,
      this.renderer,
      hasSave,
      {
        onNewGame: () => this.beginNewGame(),
        onContinue: () => this.beginContinueGame(),
        onResumeRun: () => this.resumeSavedRun(),
        onBiomeSelected: (biomeId) => this.selectPreferredBiome(biomeId),
        onDailyRun: () => this.beginDailyRun(),
        onEndlessRun: () => this.beginEndlessRun(),
        onCreativeRun: () => this.beginCreativeRun(),
      },
      runSaveStore.load(),
      this.preferredBiomeId,
      dailyStore.load(),
    );
  }

  /** Remember the title-screen map pick for the next run and future sessions. */
  private selectPreferredBiome(biomeId: BiomeId): void {
    this.preferredBiomeId = biomeId;
    this.profile.preferredBiomeId = biomeId;
    this.markProfileDirty();
  }

  /**
   * Commit the rig the player picked in the garage's first-run prompt.
   *
   * The choice replaces the whole blueprint rather than editing the one on
   * screen, so the garage is rebuilt around it. That is also why the pick is
   * only offered on a brand-new game: there is nothing here worth preserving
   * yet, and swapping a rig the player had already started modifying would
   * throw their work away.
   */
  private applyChosenBuild(buildId: BuildId): void {
    this.preferredBuildId = buildId;
    this.profile.buildId = buildId;
    // Everything the rig is made of has to stay buyable, or the first tread a
    // zombie tears off is a hole nothing can fill.
    this.grantBuildUnlocks();
    this.markProfileDirty();
    this.bp = buildStarterBlueprint(buildId);
    this.history.clear();
    this.rebaseCheckpointOnChosenBuild();
    // Reopened rather than refreshed: the editor caches meshes, selection and
    // overlays off the blueprint it was constructed with, and every one of
    // those is stale the moment the rig underneath changes.
    //
    // No welcome banner: the rig the player just picked arrives with its weapon
    // already fitted and its ability already bound, and a paragraph explaining
    // that lands over the build grid on the one screen where they want to
    // start building.
    this.openEditor();
  }

  /**
   * Put the chosen Build under the run in flight, at full health.
   *
   * Only the First Play route ever reaches this with a live checkpoint: the
   * picker opens in the Garage between the tutorial wave and wave two, and the
   * checkpoint sitting behind it still describes the demo rig — its damage, and
   * anything a zombie tore off it, priced as blocks the player owes for. None
   * of that survives the swap. They are being handed a different vehicle, so it
   * arrives whole and owing nothing, and `missingParts` is emptied rather than
   * filtered because the ids on the new rig collide with the demo's.
   */
  private rebaseCheckpointOnChosenBuild(): void {
    if (this.checkpoint === null) return;
    this.checkpoint = {
      ...this.checkpoint,
      blueprint: this.bp,
      partHp: fullPartHp(this.bp),
      missingParts: [],
    };
    this.persistRunCheckpoint(this.inBuildPhase ? 'build' : 'wave');
  }

  /**
   * Make sure every block on the player's starting rig is one the Store will
   * sell them again. A build handed out on tank treads has to leave treads
   * buyable, or the first belt a zombie tears off is unreplaceable.
   */
  private grantBuildUnlocks(): void {
    const unlocked = new Set(this.profile.unlockedDefIds);
    for (const defId of buildStarterUnlocks(this.preferredBuildId)) {
      unlocked.add(defId);
    }
    this.profile.unlockedDefIds = [...unlocked];
  }

  private returnToTitle(): void {
    if (!this.editor || (this.activeRun && this.inBuildPhase)) return;
    // A Creative garage is a scratch pad on a throwaway profile; persisting it
    // would write the sandbox rig over the campaign's saved blueprint.
    if (this.sandboxProfileBackup === null) {
      this.bp = this.editor.blueprint();
      this.editor.persistGarage();
    }
    this.editor.dispose();
    this.editor = null;
    this.leaveSandboxMode();
    this.showTitle();
  }

  /**
   * Wipe progress and put the default rig in the bay. Shared by both entry
   * points below, which differ only in where they take the player next.
   */
  private resetToStarterRig(): void {
    this.disposeTitle();
    this.clearStoredSave();
    resetProfileForNewGame(this.profile);
    this.resetSessionState();
    // Unlocks are granted for the default rig up front so the truck the player
    // is handed is fully repairable from wave one. `applyChosenBuild` grants
    // the picked rig's unlocks on top when they choose in the garage — the
    // overlap costs one unused unlock, against being handed a rig with a wheel
    // the Store refuses to sell them.
    this.preferredBuildId = DEFAULT_BUILD_ID;
    this.profile.buildId = DEFAULT_BUILD_ID;
    this.grantBuildUnlocks();
    this.bp = buildStarterBlueprint(DEFAULT_BUILD_ID);
    this.pendingIsNewGame = true;
  }

  /**
   * A brand-new player's first seconds: driving, not building.
   *
   * Booting used to land on the Garage — a full parts editor, under a rig
   * picker, under a welcome dialog — and ask for a purchase and a grid
   * placement before it would let anyone near a zombie. That is a lot of
   * reading in front of a game whose actual loop is "drive a truck at a crowd",
   * and it was the first thing every new player met.
   *
   * So the order is inverted for them: wave one starts immediately, on a rig
   * that is not one of the three Builds at all. `firstPlayRig` is a demo — six
   * engines, a Heavy Cannon, two blasters, a blade and a shield — because a
   * first impression made on a starter truck with one gun is a first impression
   * of a slower, quieter game than this one. The First Play coach rides along
   * and teaches the three inputs over it, a card at a time, with the world
   * stopped for each.
   *
   * The rig is handed back at the end of that wave: the clear goes straight to
   * the Garage with the picker up (`pendingIsNewGame`), and whichever Build
   * they choose replaces it. So nothing about it has to be balanced, and none
   * of what it carries is unlocked or granted — it is never theirs.
   */
  private beginFirstRun(): void {
    // Named apart from `campaign` on purpose: the tutorial wave is a different
    // funnel from a run the player chose, and averaging the two hides which of
    // them is losing people.
    funnel.startMode('first-play');
    this.resetToStarterRig();
    this.startRun(
      buildFirstPlayBlueprint(),
      this.preferredBiomeId,
      DEFAULT_GAME_MODE_ID,
      undefined,
      true,
    );
  }

  /**
   * "New Game" from the title screen.
   *
   * Deliberately still the Garage-first route. This player has already played —
   * they reached a title screen and chose to start over — so the rig picker is
   * a decision they can make, and skipping them past it to re-run a wave they
   * have already seen would be taking that choice away rather than sparing them
   * anything. Only `beginFirstRun` above skips ahead.
   */
  private beginNewGame(): void {
    funnel.startMode('campaign');
    this.leaveSandboxMode();
    this.resetToStarterRig();
    this.openEditor();
  }

  /**
   * Enter a mode that must not touch the campaign save.
   *
   * Daily, Endless and Creative all run on a throwaway profile: the Daily has
   * to hand everyone the same starting wallet or its board is meaningless,
   * Creative hands out a trillion dollars, and none of the three should be able
   * to spend, unlock or wipe anything the player earned in their campaign.
   *
   * The campaign profile is committed to disk first and kept in memory as a
   * backup, then persistence is sealed for as long as the sandbox is live. Its
   * mutations happen on a copy that is simply dropped on the way out — nothing
   * downstream has to know it is playing in a sandbox.
   */
  private enterSandboxMode(modeId: GameModeId): void {
    this.leaveSandboxMode();
    this.flushDirtyProfile();
    this.sandboxProfileBackup = JSON.parse(
      JSON.stringify(this.profile),
    ) as PlayerProfile;
    this.profileSealed = true;
    this.activeModeId = modeId;
    funnel.startMode(modeId);

    const mode = getGameMode(modeId);
    // A fresh default profile, so every Daily attempt starts from the same
    // wallet and the same shelf whatever the player's campaign looks like.
    this.profile = defaultProfile();
    this.profile.buildId = DEFAULT_BUILD_ID;
    this.preferredBuildId = DEFAULT_BUILD_ID;
    if (mode.allPartsUnlocked) {
      this.profile.unlockedDefIds = Object.keys(PART_CATALOG);
    }

    // The Daily overrides the mode's flat wallet with the day's own roll: a
    // budget day sets a wallet, a draft day sets none and hands over a fixed
    // crate of blocks instead.
    const loadout = modeId === 'daily' ? dailyLoadout(dayIdFor()) : null;
    this.profile.money = loadout?.money ?? mode.startingMoney;

    // Every part at a count nothing decrements. `PART_CATALOG` rather than the
    // store's shelf list, so a Creative build can reach blocks the store never
    // sells — the signature blocks included.
    this.profile.inventory = mode.infiniteInventory
      ? Object.fromEntries(
          Object.keys(PART_CATALOG).map((defId) => [defId, INFINITE_STOCK]),
        )
      : { ...(loadout?.kit ?? {}) };
    // Undefined rather than empty: the garage seeds a fresh bar from whatever
    // is in the inventory, which is exactly what puts a draft kit on the bar.
    delete this.profile.hotbarDefIds;

    // A draft day has nothing to sell — the kit is the whole allowance — so the
    // Store goes with it, the same way Creative's does.
    this.storeHidden = mode.hideStore || loadout?.kind === 'crate';

    this.bp =
      mode.startingRig === 'beginner'
        ? buildBeginnerBlueprint()
        : buildStarterBlueprint(DEFAULT_BUILD_ID);
    this.clearSessionState();
  }

  /**
   * Put the campaign profile back and let it persist again. Safe to call when
   * no sandbox is live, which is why every exit path can call it blindly.
   */
  private leaveSandboxMode(): void {
    const backup = this.sandboxProfileBackup;
    this.sandboxProfileBackup = null;
    this.profileSealed = false;
    this.activeModeId = DEFAULT_GAME_MODE_ID;
    this.storeHidden = false;
    if (backup === null) return;

    this.profile = backup;
    this.preferredBiomeId = backup.preferredBiomeId ?? DEFAULT_BIOME_ID;
    this.preferredBuildId = backup.buildId ?? DEFAULT_BUILD_ID;
    this.bp = buildStarterBlueprint(this.preferredBuildId);
    this.clearSessionState();
    // Written back rather than merely restored in memory: `profileStore` caches
    // the object it last saw, and the sandbox copy is the one it is holding.
    this.profileDirty = true;
    this.flushProfile();
  }

  /**
   * Today's Daily Run: one attempt, an arena and a seed the calendar picked,
   * and a starter rig identical to everyone else's.
   */
  private beginDailyRun(): void {
    const dayId = dayIdFor();
    if (!canPlayDaily(dailyStore.load())) return;
    this.enterSandboxMode('daily');
    this.disposeTitle();
    this.preferredBiomeId = dailyBiome(dayId);
    // Opens in the Garage, not the arena: the whole of a Daily is what you do
    // with the day's wallet or the day's draft, and that decision has to be
    // made before the first zombie, not after it.
    const loadout = dailyLoadout(dayId);
    this.pendingEditorNotice =
      loadout.kind === 'crate'
        ? 'Daily draft — this kit is everything you get. Build and drive out.'
        : `Daily budget — $${loadout.money.toLocaleString()} and the whole catalog.`;
    this.openEditor();
  }

  /** Endless: the beginner chassis, $2,000, and a horde that never stops. */
  private beginEndlessRun(): void {
    this.enterSandboxMode('endless');
    this.disposeTitle();
    this.pendingEditorNotice =
      'Endless — $2,000 to spend, one build, and no garage once you deploy.';
    this.openEditor();
  }

  /**
   * Creative opens in the Garage rather than the arena, because building is the
   * point of it — the endless horde is there to test what you built against.
   */
  private beginCreativeRun(): void {
    this.enterSandboxMode('creative');
    this.disposeTitle();
    this.pendingEditorNotice =
      'Creative Mode — every part unlocked, unlimited cash, endless waves.';
    this.openEditor();
  }

  /**
   * The other way out of the first wave: straight into Creative.
   *
   * The tutorial wave is a campaign run, so leaving it this way has to throw
   * that run away rather than leave a wave-one checkpoint on disk for the next
   * "Continue" to resume on a loaner rig the player never chose. The money the
   * wave paid is already banked on the campaign profile and stays there —
   * `enterSandboxMode` flushes it to disk before sealing it away — so the
   * campaign is waiting, intact, whenever they come back to the title.
   *
   * The rig picker is also dropped: Creative hands out the beginner chassis and
   * the whole catalog, which makes a "choose your Build" dialog a choice about
   * nothing.
   */
  private beginCreativeFromFirstPlay(): void {
    // The other door out of the same celebration, and just as much a finished
    // tutorial as the Survival one. What is abandoned is the campaign run the
    // wave belonged to, which `beginCreativeRun` files under Creative instead.
    funnel.firstPlayExit('creative');
    funnel.endRun('complete');
    runSaveStore.clear();
    this.pendingIsNewGame = false;
    this.beginCreativeRun();
  }

  private beginContinueGame(): void {
    funnel.startMode('campaign');
    this.disposeTitle();
    this.resetSessionState();
    const loaded = this.loadCurrentBlueprint();
    if (loaded.kind === 'loaded') {
      this.bp = loaded.blueprint;
    } else {
      this.bp = buildStarterBlueprint(this.preferredBuildId);
      if (loaded.kind === 'failed') {
        this.pendingEditorNotice = `Saved vehicle could not be loaded — it has been preserved as ${loaded.name}`;
      }
    }
    this.openEditor();
  }

  private resetSessionState(): void {
    runSaveStore.clear();
    this.clearSessionState();
  }

  private clearSessionState(): void {
    this.history.clear();
    this.savedView = undefined;
    this.activeRun = null;
    this.checkpoint = null;
    this.inBuildPhase = false;
    this.runMoneyEarned = 0;
  }

  private disposeTitle(): void {
    this.title?.dispose();
    this.title = null;
  }

  private hasStoredSave(): boolean {
    try {
      return (
        localStorage.getItem(PROFILE_STORAGE_KEY) !== null ||
        localStorage.getItem(BLUEPRINT_STORAGE_KEY) !== null
      );
    } catch {
      return false;
    }
  }

  private clearStoredSave(): void {
    for (const key of [PROFILE_STORAGE_KEY, BLUEPRINT_STORAGE_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Keep the fresh in-memory game usable if persistence is unavailable.
      }
    }
  }

  /** Drop saved vehicle designs without touching persistent profile progress. */
  private clearStoredBlueprints(): void {
    try {
      localStorage.removeItem(BLUEPRINT_STORAGE_KEY);
    } catch {
      // Keep the fresh in-memory game usable if persistence is unavailable.
    }
  }

  private enterChamber(bp: VehicleBlueprint): void {
    stopGarageMusic();
    this.bp = bp;
    this.savedView = this.editor?.viewState();
    this.editor?.dispose();
    this.editor = null;
    this.chamber = new ChamberMode(this.root, this.renderer, bp, () =>
      this.openEditor(),
    );
    this.chamber.resize(this.root.clientWidth, this.root.clientHeight);
    funnel.enterScreen('chamber');
    this.setGameplayActive(true);
  }

  /**
   * Open straight into the Garage with a run primed at `wave` (`?dev=1&wave=N`).
   *
   * Landing in the Garage rather than the arena is deliberate: which rig a
   * player would plausibly have at this depth is a judgement call, and the
   * point of the jump is to try several against the same wave. Parts and money
   * are granted to match the depth so the rig under test is one that could
   * actually have been built by then.
   *
   * Returns false when there is nothing to do, so boot falls back to the title.
   */
  devWaveJump(wave: number): boolean {
    // Wave 1 is where a normal new run already starts; jumping there would only
    // skip the title for no benefit and hand out a wallet nobody earned.
    if (!isDevMode() || !Number.isInteger(wave) || wave < 2) return false;

    recordWaveCleared(this.profile, wave - 1);
    this.changeMoney(devWalletForWave(wave), true);
    this.markProfileDirty();

    const loaded = this.loadCurrentBlueprint();
    if (loaded.kind === 'loaded') this.bp = loaded.blueprint;
    this.checkpoint = {
      ...createInitialRunCheckpoint(this.bp, this.preferredBiomeId),
      wave,
    };
    this.runMoneyEarned = 0;
    // The Garage banner reads the next wave off `activeRun.wave + 1`, matching
    // how a Build Phase between cleared waves is described.
    this.activeRun = { wave: wave - 1 };
    this.inBuildPhase = true;
    this.disposeTitle();
    this.openEditor();
    return true;
  }

  /**
   * The Garage's deploy button: the one transition from a menu into a live
   * wave, and so the game's natural midroll slot. The ad runs with the Garage
   * still on screen and the wave is not built until it is over — the player
   * never watches an ad on top of a world that is already simulating.
   */
  private async startOrResumeRun(bp: VehicleBlueprint): Promise<void> {
    await this.breakBeforeGameplay();
    // The break is awaited, so the Garage may have been torn down underneath
    // it — a save-and-quit or a return to the title during the ad. Deploying
    // into a wave the player has already walked away from would be a bug.
    if (this.editor === null) return;
    if (this.checkpoint !== null) {
      this.resumeRun(bp);
    } else {
      this.startRun(bp, this.preferredBiomeId, this.activeModeId);
    }
  }

  private startRun(
    bp: VehicleBlueprint,
    biomeId: BiomeId,
    modeId: GameModeId = DEFAULT_GAME_MODE_ID,
    seed?: number,
    firstPlay = false,
  ): void {
    runSaveStore.clear();
    this.activeModeId = modeId;
    this.runMoneyEarned = 0;
    this.firstPlayWave = firstPlay;
    // A fixed-seed mode takes its arena from the calendar however it got here —
    // including the Garage's Fight button, which knows nothing about dailies.
    const runSeed =
      seed ??
      (getGameMode(modeId).fixedSeed ? dailySeed(dayIdFor()) : randomSeed());
    this.checkpoint = createInitialRunCheckpoint(bp, biomeId, modeId, runSeed);
    this.activeRun = { wave: this.checkpoint.wave };
    this.inBuildPhase = false;
    this.persistRunCheckpoint('wave');
    this.enterSurvival(
      this.checkpoint.blueprint,
      runStateFromCheckpoint(this.checkpoint),
    );
  }

  private resumeRun(bp: VehicleBlueprint): void {
    if (this.checkpoint === null) {
      this.startRun(bp, this.preferredBiomeId);
      return;
    }
    this.checkpoint = prepareCheckpointForGarageFight(this.checkpoint, bp);
    this.activeRun = { wave: this.checkpoint.wave };
    this.inBuildPhase = false;
    this.persistRunCheckpoint('wave');
    this.enterSurvival(
      this.checkpoint.blueprint,
      runStateFromCheckpoint(this.checkpoint),
    );
  }

  private enterSurvival(bp: VehicleBlueprint, run: RunState): void {
    funnel.enterScreen('survival');
    this.setGameplayActive(true);
    stopGarageMusic();
    this.editor?.persistGarage();
    this.bp = bp;
    this.savedView = this.editor?.viewState();
    this.editor?.dispose();
    this.editor = null;
    this.chamber?.dispose();
    this.chamber = null;
    this.survival?.dispose();
    // Consumed here rather than read: the tutorial belongs to one deployment,
    // and a run that somehow reached a second wave must not open a second one.
    const firstPlay = this.firstPlayWave;
    this.firstPlayWave = false;
    this.survival = new SurvivalMode(
      this.root,
      this.renderer,
      bp,
      firstPlay ? { ...run, firstPlay: true } : run,
      {
        profileMoney: () => this.profile.money,
        runEarnings: () => this.runMoneyEarned,
        onRepairAll: (cost) => this.repairRunInPlace(cost),
        missingPartsQuote: () => this.missingPartsQuote(),
        onFullRepairRebuild: (
          cost,
          state,
          survivingPartIds,
          partHp,
          kills,
          score,
        ) =>
          this.repairRebuildAndRedeploy(
            cost,
            state,
            survivingPartIds,
            partHp,
            kills,
            score,
          ),
        onReward: (amount) => this.creditRunReward(amount),
        onExit: () => this.abandonRun(),
        onWaveAdvance: (state, survivingPartIds, partHp, kills, score) => {
          this.commitClearedWaveCheckpoint(
            state.wave,
            survivingPartIds,
            partHp,
            kills,
            score,
            state.elapsedSeconds ?? 0,
          );
          this.activeRun = { wave: state.wave };
          this.persistRunCheckpoint('wave');
        },
        onBuildPhase: (state, survivingPartIds, partHp, kills, score) => {
          // Taking the Survival door out of the tutorial celebration. The
          // tutorial is finished, not walked out of, and the run it started
          // carries on from wave two as an ordinary campaign run — so the
          // funnel hands over here too, rather than filing sixty waves of
          // campaign play under `first-play`.
          if (firstPlay) {
            funnel.endRun('complete');
            funnel.startMode('campaign');
          }
          this.enterBuildPhase(state, survivingPartIds, partHp, kills, score);
        },
        onFirstPlayCreative: () => this.beginCreativeFromFirstPlay(),
        onWaveCheckpoint: (state, survivingPartIds, partHp, kills, score) => {
          this.commitClearedWaveCheckpoint(
            state.wave,
            survivingPartIds,
            partHp,
            kills,
            score,
            state.elapsedSeconds ?? 0,
          );
          this.persistRunCheckpoint('wave');
        },
        onGameOver: (state, pendingMoneyDiscarded, score, kills) =>
          this.concludeRun(state, pendingMoneyDiscarded, score, kills),
        onGameOverContinue: () => this.continueFromGameOver(),
        onGameOverMenu: () => this.leaveFinishedRun(),
        onResetWave: (state) => this.resetSurvivalWave(state),
        onReturnToGarage: (state) => this.returnToGarageMidWave(state),
        onCheatInfiniteMoney: () => this.grantInfiniteMoney(),
        onPhoneAddictKilled: () => {
          recordPhoneAddictKilled(this.profile);
          this.markProfileDirty();
        },
        onPartSalvaged: (defId) => {
          if (recordSalvagedPart(this.profile, defId)) this.markProfileDirty();
        },
        onWaveCleared: (wave) => {
          recordWaveCleared(this.profile, wave);
          this.markProfileDirty();
        },
        onSaveAndQuit: () => this.saveAndQuitRun(),
        onGameplayActiveChanged: (active) => this.setGameplayActive(active),
        onResumeFromPause: () => this.breakBeforeGameplay(),
      },
    );
    this.survival.resize(this.root.clientWidth, this.root.clientHeight);
  }

  private commitClearedWaveCheckpoint(
    nextWave: number,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
    elapsedSeconds: number,
  ): void {
    if (this.checkpoint === null) return;
    this.checkpoint = createClearedWaveCheckpoint({
      blueprint: this.bp,
      nextWave,
      survivingPartIds,
      partHp,
      missingParts: this.checkpoint.missingParts,
      kills,
      biomeId: this.checkpoint.biomeId,
      seed: this.checkpoint.seed,
      score,
      bankedEarnings: this.runMoneyEarned,
      elapsedSeconds,
    });
    this.bp = this.checkpoint.blueprint;
    this.history.clear();
  }

  private enterBuildPhase(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void {
    this.flushProfile();
    this.commitClearedWaveCheckpoint(
      run.wave + 1,
      survivingPartIds,
      partHp,
      kills,
      score,
      run.elapsedSeconds ?? 0,
    );
    this.activeRun = { wave: run.wave };
    this.inBuildPhase = true;
    this.openEditor();
    // Persist permanent wave damage immediately; the history was intentionally
    // cleared because its pre-wave commands can reference parts that are gone.
    this.editor?.persistGarage();
    this.persistRunCheckpoint('build');
  }

  /**
   * Hold a transition open while the portal fills it with an interstitial.
   *
   * Direction is the whole rule Poki tests against: an ad belongs on the way
   * **into** gameplay — leaving a pause, leaving the Garage for the next wave —
   * and never on the way out of it into a menu. So every caller is a screen the
   * player is deliberately leaving to go and play, and the ad runs with that
   * screen still up; gameplay is not reported started until it resolves.
   *
   * Resolves immediately where there are no ads, which collapses the caller
   * back into the plain synchronous transition it was before.
   */
  private async breakBeforeGameplay(): Promise<void> {
    if (!platformHasAds()) return;
    // Nothing here reports gameplay state. The caller is already on a menu, so
    // the stop has long since fired, and firing anything during the ad itself
    // is exactly what the portal forbids.
    await requestPlatformCommercialBreak();
  }

  /**
   * Record a finished run and wipe the garage back to a fresh start. Survival
   * stays on screen showing the result until the player picks a way out of the
   * game-over card, so the reset is never a surprise.
   */
  private concludeRun(
    run: RunState,
    _pendingMoneyDiscarded: number,
    score: number,
    kills: number,
  ): RunOutcome {
    // Closed here rather than on the card's buttons: this is the one point
    // both doors out of a game over pass through, and a run whose ending was
    // only recorded by the door the player happened to press would go missing
    // for every player who closed the tab while reading their score.
    funnel.enterScreen('game-over');
    funnel.endRun('fail');
    const mode = getGameMode(this.activeModeId);
    const at = Date.now();
    if (mode.id === 'daily') {
      // Filed before the board so a daily attempt is spent even if it scored
      // nothing — the one-run-a-day rule is the mode, not a reward for doing
      // well, and a wipe on wave one still has to burn the attempt.
      dailyStore.record({
        dayId: dayIdFor(at),
        score,
        wave: run.wave,
        kills,
        at,
      });
    }
    // A Creative run is practice on unlimited money; ranking it would make
    // every board meaningless. It still gets a game-over card of its own.
    if (!mode.scored) {
      this.resetProgressionForNewRun();
      return {
        score,
        wave: run.wave,
        kills,
        isPersonalBest: false,
        rank: null,
        entries: leaderboardStore.load(),
      };
    }
    const recorded = leaderboardStore.record({
      score,
      wave: run.wave,
      kills,
      at,
      durationSeconds: Math.max(0, Math.round(run.elapsedSeconds ?? 0)),
      biomeId: this.checkpoint?.biomeId ?? this.preferredBiomeId,
    });
    // Best effort. The local board is what the game actually displays, so a
    // failed or absent portal submission must not change anything here.
    void submitPlatformScore(score);
    // A personal best is the clearest "the player is enjoying this" the game
    // has. Portals that collect the signal use it to place the game; the rest
    // no-op.
    if (recorded.isPersonalBest) void reportPlatformHappyTime(1);

    this.resetProgressionForNewRun();
    return {
      score,
      wave: run.wave,
      kills,
      isPersonalBest: recorded.isPersonalBest,
      rank: recorded.rank,
      entries: recorded.entries,
    };
  }

  /**
   * The other exit from the game-over card. The garage has already been reset
   * by `concludeRun`, so there is nothing left to save or carry — drop the
   * arena and go back to the title screen.
   */
  private leaveFinishedRun(): void {
    this.survival?.dispose();
    this.survival = null;
    this.leaveSandboxMode();
    this.showTitle();
  }

  /**
   * "Continue" on the game-over card. A campaign run drops the player back into
   * their garage; a sandbox run has no garage to go back to — its was a throw-
   * away — so it returns to the title, where the mode can be started again.
   */
  private continueFromGameOver(): void {
    if (this.sandboxProfileBackup !== null) {
      this.leaveFinishedRun();
      return;
    }
    this.openEditor();
  }

  /**
   * A finished run costs the garage: money, vehicle, parts, and the upgrades
   * on them all return to the starter state. Unlocked catalog entries and
   * lifetime progression survive, so each run starts from the same equipment
   * but the player keeps what they have permanently earned.
   */
  private resetProgressionForNewRun(): void {
    this.clearStoredBlueprints();
    resetProfileForNewRun(this.profile);
    this.resetSessionState();
    this.bp = buildStarterBlueprint(this.preferredBuildId);
    // The profile key is deliberately kept (unlocks survive a run), so the
    // wiped money and inventory must be written back explicitly — a flush
    // alone is skipped while the profile is not marked dirty.
    this.profileDirty = true;
    this.flushProfile();
  }

  /** Leave a run without finishing it: no score recorded, no reset. */
  private abandonRun(): void {
    funnel.endRun('abandon');
    runSaveStore.clear();
    this.flushProfile();
    if (this.checkpoint !== null) {
      this.bp = recoverRunFromCheckpoint(this.checkpoint).blueprint;
    }
    this.history.clear();
    this.activeRun = null;
    this.checkpoint = null;
    this.inBuildPhase = false;
    this.openEditor();
  }

  private resetSurvivalWave(run: RunState): void {
    if (this.checkpoint !== null) {
      this.bp = this.checkpoint.blueprint;
      this.activeRun = { wave: this.checkpoint.wave };
      this.inBuildPhase = false;
      this.enterSurvival(this.bp, runStateFromCheckpoint(this.checkpoint));
      this.persistRunCheckpoint('wave');
      return;
    }
    this.activeRun = { wave: run.wave };
    this.inBuildPhase = false;
    this.enterSurvival(this.bp, this.activeRun);
    this.persistRunCheckpoint('wave');
  }

  /**
   * Abandon the live wave and open the Garage on this wave's checkpoint. The
   * wave counter does not advance — deploying again refights the same wave —
   * so this rewinds like `resetSurvivalWave` but lands in the editor.
   */
  private returnToGarageMidWave(run: RunState): void {
    this.flushProfile();
    if (this.checkpoint !== null) {
      // A sandbox bench trip re-bases the checkpoint on where the run actually
      // is, so stepping into the garage and back out does not rewind the wave
      // or heal the rig. Every other mode keeps the rewind: leaving mid-wave
      // there forfeits the wave, and the checkpoint is what it forfeits to.
      if (getGameMode(this.activeModeId).midRunGarage) {
        this.checkpoint = {
          ...this.checkpoint,
          wave: run.wave,
          partHp: { ...this.checkpoint.partHp, ...run.partHp },
          elapsedSeconds: run.elapsedSeconds ?? this.checkpoint.elapsedSeconds,
        };
      }
      this.bp = this.checkpoint.blueprint;
      this.activeRun = { wave: this.checkpoint.wave };
    } else {
      this.activeRun = { wave: run.wave };
    }
    this.inBuildPhase = true;
    // The pre-wave commands can reference parts destroyed in the abandoned
    // wave, so the undo stack cannot survive the trip back.
    this.history.clear();
    this.survival?.dispose();
    this.survival = null;
    this.openEditor();
    this.persistRunCheckpoint('build');
  }

  private grantInfiniteMoney(): void {
    const amount = Number.MAX_SAFE_INTEGER - this.profile.money;
    if (amount <= 0) return;
    this.changeMoney(amount, true);
    this.editor?.refreshProfile();
  }

  private checkpointRepairParts(): {
    id: string;
    baseCost: number;
    currentHp: number;
    maxHp: number;
  }[] {
    if (this.checkpoint === null) return [];
    const checkpointParts = new Map(
      this.checkpoint.blueprint.parts.map((part) => [part.id, part]),
    );
    const currentBlueprint = this.editor?.blueprint() ?? this.bp;
    return currentBlueprint.parts.flatMap((part) => {
      const checkpointPart = checkpointParts.get(part.id);
      if (!checkpointPart) return [];
      const oldMaxHp = getEffectiveDef(checkpointPart).health;
      const storedHp = this.checkpoint?.partHp[part.id] ?? oldMaxHp;
      if (storedHp <= 0) return [];
      const maxHp = getEffectiveDef(part).health;
      return [
        {
          id: part.id,
          baseCost: getPartDef(part.defId).cost,
          currentHp: scaledHpOnUpgrade(storedHp, oldMaxHp, maxHp),
          maxHp,
        },
      ];
    });
  }

  /**
   * Parts destroyed in an earlier wave that are still absent from the live
   * blueprint. Derived rather than mutated: once "Rebuild Car" re-places one
   * through the editor's command system, it drops out here on its own.
   */
  private checkpointMissingParts(): PlacedPart[] {
    if (this.checkpoint === null) return [];
    const currentBlueprint = this.editor?.blueprint() ?? this.bp;
    const presentIds = new Set(currentBlueprint.parts.map((part) => part.id));
    return this.checkpoint.missingParts.filter(
      (part) => !presentIds.has(part.id),
    );
  }

  private repairPart(id: string): boolean {
    if (!this.activeRun || !this.inBuildPhase || this.checkpoint === null) {
      return false;
    }
    const part = this.checkpointRepairParts().find(
      (candidate) => candidate.id === id,
    );
    if (!part || part.currentHp >= part.maxHp) return false;
    const cost = partRepairCost(part.baseCost, part.currentHp, part.maxHp);
    if (!canAfford(this.profile.money, cost)) return false;

    try {
      this.changeMoney(-cost, true);
    } catch {
      return false;
    }
    this.checkpoint.partHp[id] = part.maxHp;
    this.editor?.refreshProfile();
    return true;
  }

  private repairAll(): boolean {
    if (!this.activeRun || !this.inBuildPhase || this.checkpoint === null) {
      return false;
    }
    const parts = this.checkpointRepairParts();
    const damaged = parts.filter((part) => part.currentHp < part.maxHp);
    if (damaged.length === 0) return false;
    const plan = repairPlan(parts);
    if (!canAfford(this.profile.money, plan.totalCost)) return false;

    try {
      this.changeMoney(-plan.totalCost, true);
    } catch {
      return false;
    }
    for (const part of damaged) {
      this.checkpoint.partHp[part.id] = part.maxHp;
    }
    this.editor?.refreshProfile();
    return true;
  }

  /**
   * The wave-clear card's full repair when the rig has all its blocks and only
   * needs healing. Unlike `repairAll` this runs mid-run rather than in a build
   * phase, so it only charges the wallet and re-bases the checkpoint;
   * SurvivalMode heals the live vehicle it is about to carry into the next
   * wave. A rig with holes in it goes through `repairRebuildAndRedeploy`
   * instead, because a live vehicle cannot regrow a part.
   */
  private repairRunInPlace(cost: number): boolean {
    if (!this.activeRun || this.checkpoint === null) return false;
    if (!Number.isSafeInteger(cost) || cost <= 0) return false;
    if (!canAfford(this.profile.money, cost)) return false;

    try {
      this.changeMoney(-cost, true);
    } catch {
      return false;
    }
    // The checkpoint is the authority when a run is resumed, so it has to
    // agree with the vehicle that was just repaired. Parts already destroyed
    // stay destroyed — a repair does not resurrect them.
    for (const part of this.checkpoint.blueprint.parts) {
      if ((this.checkpoint.partHp[part.id] ?? 0) > 0) {
        this.checkpoint.partHp[part.id] = getEffectiveDef(part).health;
      }
    }
    return true;
  }

  /**
   * What the wave-clear card has to add to its repair bill for blocks lost in
   * an earlier wave and never bought back.
   *
   * Priced against the wave-start checkpoint, which is the only blueprint that
   * exists here — so a block whose mount died during the wave now is still
   * counted as restorable. The player pays the price they were quoted either
   * way; the rebuild that follows re-plans against the committed rig and
   * restores whatever is actually reachable.
   */
  private missingPartsQuote(): { cost: number; count: number } {
    if (this.checkpoint === null) return { cost: 0, count: 0 };
    const plan = planRebuild(
      this.checkpoint.blueprint,
      getPartDef,
      this.checkpoint.missingParts,
    );
    return { cost: plan.totalCost, count: plan.parts.length };
  }

  /**
   * The wave-clear card's full repair when the rig has holes in it: charge,
   * commit the cleared wave, bolt every torn-off block back on at full HP, and
   * redeploy into the next wave.
   *
   * The redeploy is the point. "Continue Now" keeps the live vehicle, and a
   * live vehicle cannot regrow a part whose collider was removed the moment it
   * died — so a rebuild has to reassemble from the blueprint, exactly as
   * coming back out of the Garage does.
   */
  private repairRebuildAndRedeploy(
    cost: number,
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void {
    if (!this.activeRun || this.checkpoint === null) return;
    if (!Number.isSafeInteger(cost) || cost <= 0) return;
    if (!canAfford(this.profile.money, cost)) return;
    try {
      this.changeMoney(-cost, true);
    } catch {
      return;
    }

    this.commitClearedWaveCheckpoint(
      run.wave + 1,
      survivingPartIds,
      partHp,
      kills,
      score,
      run.elapsedSeconds ?? 0,
    );
    const checkpoint = this.checkpoint;
    if (checkpoint === null) return;

    const plan = planRebuild(
      checkpoint.blueprint,
      getPartDef,
      checkpoint.missingParts,
    );
    const restoredIds = new Set(plan.parts.map((part) => part.id));
    checkpoint.blueprint = {
      ...checkpoint.blueprint,
      parts: [...checkpoint.blueprint.parts, ...plan.parts],
    };
    checkpoint.missingParts = checkpoint.missingParts.filter(
      (part) => !restoredIds.has(part.id),
    );
    checkpoint.partHp = fullPartHp(checkpoint.blueprint);

    this.bp = checkpoint.blueprint;
    this.activeRun = { wave: checkpoint.wave };
    this.inBuildPhase = false;
    this.enterSurvival(this.bp, runStateFromCheckpoint(checkpoint));
    this.persistRunCheckpoint('wave');
  }

  private creditRunReward(amount: number): number {
    const credited = Math.min(
      amount,
      Number.MAX_SAFE_INTEGER - this.profile.money,
    );
    if (credited <= 0) return 0;
    this.changeMoney(credited, false);
    this.runMoneyEarned += credited;
    return credited;
  }

  private changeMoney(moneyDelta: number, persist: boolean): void {
    if (!Number.isSafeInteger(moneyDelta)) {
      throw new Error('Money change must be a safe integer');
    }
    // Creative's wallet does not move. Letting spends land would work — the
    // balance is unspendable by any real build — but the readout would tick
    // downward all session, which is not what "unlimited" looks like.
    if (getGameMode(this.activeModeId).infiniteMoney) {
      this.profile.money = CREATIVE_WALLET;
      return;
    }
    const next = this.profile.money + moneyDelta;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error('Insufficient funds');
    }
    this.profile.money = next;
    if (persist) {
      try {
        this.saveProfileOrThrow();
      } catch (error) {
        this.profile.money -= moneyDelta;
        throw error;
      }
    } else {
      this.markProfileDirty();
    }
  }

  private loadCurrentBlueprint():
    | { kind: 'missing' }
    | { kind: 'loaded'; blueprint: VehicleBlueprint }
    | { kind: 'failed'; name: string } {
    const name = this.profile.currentBlueprintName;
    if (!name) return { kind: 'missing' };
    try {
      const slots = JSON.parse(
        localStorage.getItem(BLUEPRINT_STORAGE_KEY) ?? '{}',
      ) as Record<string, unknown>;
      const json = slots[name];
      if (typeof json !== 'string') return { kind: 'missing' };
      return { kind: 'loaded', blueprint: deserializeBlueprint(json) };
    } catch {
      return { kind: 'failed', name };
    }
  }

  private markProfileDirty(): void {
    this.profileDirty = true;
    if (this.profileFlushTimer !== undefined) return;
    this.profileFlushTimer = window.setTimeout(() => {
      this.profileFlushTimer = undefined;
      this.flushProfile();
    }, 2_000);
  }

  private readonly flushDirtyProfile = (): void => {
    if (this.profileFlushTimer !== undefined) {
      window.clearTimeout(this.profileFlushTimer);
      this.profileFlushTimer = undefined;
    }
    this.flushProfile();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.flushDirtyProfile();
  };

  private flushProfile(): void {
    // The seal is checked before the dirty flag so a sandbox mutation stays
    // marked dirty and is simply never written — `leaveSandboxMode` clears it.
    if (this.profileSealed || !this.profileDirty) return;
    try {
      profileStore.save(this.profile);
      this.profileDirty = false;
    } catch {
      this.notifySaveFailure();
    }
  }

  private saveProfileOrThrow(): void {
    // The Garage saves through this on every purchase. In a sandbox mode the
    // write is skipped rather than refused: the caller only needs to know the
    // buy succeeded, and in Creative it always does.
    if (this.profileSealed) return;
    try {
      profileStore.save(this.profile);
      this.profileDirty = false;
    } catch (error) {
      this.notifySaveFailure();
      throw error;
    }
  }

  private notifySaveFailure(): void {
    if (this.saveFailureNotified) return;
    this.saveFailureNotified = true;
    const notice = 'Progress could not be saved';
    if (this.editor) this.editor.showNotice(notice);
    else this.pendingEditorNotice = notice;
  }

  private persistRunCheckpoint(phase: 'wave' | 'build'): void {
    if (this.checkpoint === null) return;
    // A sandbox run leaves no autosaved checkpoint. Without this a Daily or
    // Endless run would write a resumable checkpoint that the title screen then
    // offers as "Resume Run", and picking it up would restore a sandbox run as
    // a campaign one — the save format has no mode field precisely because this
    // cannot happen.
    if (!getGameMode(this.checkpoint.modeId).persistsProgress) return;
    this.writeRunSave(phase);
  }

  /**
   * The single writer for the resumable run save.
   *
   * Returns false only when a write was attempted and failed, so a caller on
   * its way out of the run can stop and tell the player rather than dropping
   * the wave they just banked. A run that has deliberately nothing to save is
   * not a failure.
   */
  private writeRunSave(phase: 'wave' | 'build'): boolean {
    if (this.checkpoint === null) return true;
    // The First Play wave leaves nothing resumable behind. Its rig is a loaner
    // handed back the moment the wave ends, so a checkpoint describing it would
    // offer the title screen a "Resume Run" that restores a vehicle the player
    // was never sold — and the checkpoint the Build picker sits in front of
    // still describes it. `rebaseCheckpointOnChosenBuild` writes over the top
    // once a Build is picked, and that is the first checkpoint that is theirs.
    //
    // Here rather than in `persistRunCheckpoint` above because both Save & Quit
    // buttons bypass that method, and the Garage's is on screen behind the
    // picker.
    if (isFirstPlayBlueprint(this.checkpoint.blueprint)) {
      runSaveStore.clear();
      return true;
    }
    try {
      runSaveStore.save(
        savedRunFromCheckpoint(
          this.checkpoint,
          Date.now(),
          phase,
          this.activeRun?.wave ?? this.checkpoint.wave,
        ),
      );
    } catch {
      this.notifySaveFailure();
      return false;
    }
    return true;
  }

  debugSeam(): Record<string, unknown> {
    return {
      orient: {
        yaw90: orientationFromSteps(0, 1, 0),
        yaw180: orientationFromSteps(0, 2, 0),
        rollX90: orientationFromSteps(1, 0, 0),
      },
      composeOrient: (a: number, b: number) => composeOrientations(a, b),
      mode: () =>
        this.title
          ? 'title'
          : this.survival
            ? 'survival'
            : this.chamber
              ? 'chamber'
              : 'editor',
      // Skips the map chooser and starts on the remembered map.
      newGame: () => this.title?.startNewGame() ?? false,
      continueGame: () => this.title?.continueGame() ?? false,
      hasStoredRun: () => this.hasStoredRun(),
      saveAndQuitRun: () => this.saveAndQuitRun(),
      saveAndQuitFromGarage: () => this.saveAndQuitFromGarage(),
      resumeSavedRun: () => this.resumeSavedRun(),
      clearRunSave: () => runSaveStore.clear(),
      getBlueprintJson: () =>
        serializeBlueprint(this.editor?.blueprint() ?? this.bp),
      loadBlueprintJson: (json: string) =>
        this.editor?.replaceBlueprint(deserializeBlueprint(json)),
      place: (defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}) =>
        this.editor?.debugPlace(defId, pos, orient, config),
      startTutorial: () => this.editor?.startTutorial(),
      tutorialState: () => this.editor?.debugTutorialState(),
      tutorialNext: () => this.editor?.debugTutorialNext(),
      configureAt: (pos: Vec3i, config: PartConfig) =>
        this.editor?.debugConfigure(pos, config),
      undo: () => this.editor?.debugUndo(),
      redo: () => this.editor?.debugRedo(),
      validate: () =>
        validateBlueprint(this.editor?.blueprint() ?? this.bp, getPartDef),
      analyze: () =>
        analyzeVehicle(this.editor?.blueprint() ?? this.bp, getPartDef),
      enterTest: () => {
        const bp = this.editor?.blueprint();
        if (!bp) return false;
        const v = validateBlueprint(bp, getPartDef);
        if (v.errors.length > 0) return false;
        this.enterChamber(bp);
        return true;
      },
      enterSurvival: () => {
        const bp = this.editor?.blueprint();
        if (!bp) return false;
        const v = validateBlueprint(bp, getPartDef);
        if (v.errors.length > 0) return false;
        void this.startOrResumeRun(bp);
        return true;
      },
      backToEditor: () => {
        if (this.survival && this.activeRun) this.abandonRun();
        else if (!this.editor && !this.title) this.openEditor();
      },
      setControls: (c: Partial<VehicleControls>) => {
        this.chamber?.debugSetControls(c);
        this.survival?.debugSetControls(c);
      },
      stepSim: (steps: number) => {
        this.chamber?.debugStepSim(steps);
        this.survival?.debugStepSim(steps);
      },
      setSimPaused: (paused: boolean) => {
        this.chamber?.debugSetSimPaused(paused);
        this.survival?.debugSetSimPaused(paused);
      },
      // Every retention checkpoint this session has reported, so the funnel
      // can be verified by playing rather than by waiting on a dashboard.
      funnelLog: () => funnel.debugLog(),
      telemetry: () => this.chamber?.debugTelemetry(),
      survivalTelemetry: () => this.survival?.debugTelemetry() ?? null,
      profile: () => ({
        money: this.profile.money,
        unlocks: [...this.profile.unlockedDefIds],
        highestWaveCleared: this.profile.highestWaveCleared ?? 0,
        phoneAddictsKilled: this.profile.phoneAddictsKilled ?? 0,
      }),
      setProgress: (
        highestWaveCleared: number,
        phoneAddictsKilled: number,
      ): void => {
        if (
          !Number.isSafeInteger(highestWaveCleared) ||
          highestWaveCleared < 0 ||
          !Number.isSafeInteger(phoneAddictsKilled) ||
          phoneAddictsKilled < 0
        ) {
          return;
        }
        // Go through recordWaveCleared so the seam grants exactly the unlocks a
        // real clear would. Setting the counter alone would leave the profile in
        // a state the game can never actually produce.
        this.profile.highestWaveCleared = 0;
        this.profile.phoneAddictsKilled = phoneAddictsKilled;
        recordWaveCleared(this.profile, highestWaveCleared);
        this.markProfileDirty();
        this.editor?.refreshProfile();
      },
      grantMoney: (amount: number) => {
        if (!Number.isSafeInteger(amount) || amount < 0) return false;
        try {
          this.changeMoney(amount, true);
          this.editor?.refreshProfile();
          return true;
        } catch {
          return false;
        }
      },
      buyUpgrade: (partId: string) =>
        this.editor?.debugBuyUpgrade(partId) ?? false,
      sellPart: (partId: string) => this.editor?.debugSellPart(partId) ?? false,
      repairPart: (partId: string) => this.repairPart(partId),
      repairAll: () => this.repairAll(),
      checkpointPartHp: () =>
        this.checkpoint ? { ...this.checkpoint.partHp } : null,
      checkpointMissingParts: () => this.checkpointMissingParts(),
      unlockPart: (defId: string) =>
        this.editor?.debugUnlockPart(defId) ?? false,
      selectPart: (partId: string) =>
        this.editor?.debugSelectPart(partId) ?? false,
      runState: () =>
        this.activeRun
          ? { wave: this.activeRun.wave, inBuildPhase: this.inBuildPhase }
          : null,
      zombiePositions: () => this.survival?.debugZombiePositions() ?? [],
      debugStartWave: (wave: number) => {
        if (!this.survival) return;
        const sanitizedWave = Math.max(
          1,
          Math.floor(Number.isFinite(wave) ? wave : 1),
        );
        this.activeRun = { wave: sanitizedWave };
        this.survival.debugStartWave(sanitizedWave);
      },
      debugKillAllZombies: () => this.survival?.debugKillAllZombies(),
      forceWaveComplete: () => this.survival?.debugForceWaveComplete(),
      forceGameOver: () => this.survival?.debugDestroyVehicle(),
      damageVehicle: (fraction: number) =>
        this.survival?.debugDamageVehicle(fraction),
      setScenario: (s: ScenarioName) => this.chamber?.debugSetScenario(s),
      resetVehicle: () => this.chamber?.reset(),
      survivalCameraZoom: (zoom: number) =>
        this.survival?.debugSetCameraZoom(zoom),
      // Trailer-capture only: cinematic control over the garage/editor camera.
      editorSetCameraPose: (pose: DebugCameraPose | null) =>
        this.editor?.debugSetCameraPose(pose),
      editorGetCameraPose: () => this.editor?.debugGetCameraPose() ?? null,
      editorSetOverlays: (visible: boolean) =>
        this.editor?.debugSetOverlaysVisible(visible),
      editorRender: () => this.editor?.debugRender(),
      loadStarterBuild: (id: string) =>
        this.editor?.replaceBlueprint(
          buildStarterBlueprint(isBuildId(id) ? id : DEFAULT_BUILD_ID),
        ),
    };
  }
}

/**
 * A small, valid, drivable starter rig so first boot isn't a blank grid.
 *
 * The layouts themselves live in `core/builds.ts` — they are pure blueprint
 * data, and the title screen needs them for its picker backdrop as much as the
 * app does for a new run. This stays as the app-side entry point because
 * `TitleScreen` and the unit tests already import it by name.
 */
export function buildStarterBlueprint(
  buildId: BuildId = DEFAULT_BUILD_ID,
): VehicleBlueprint {
  return buildStarterRig(buildId);
}

/**
 * The overlay shown while the GL context is gone.
 *
 * A restore is not instant and is not guaranteed to be automatic — a tab that
 * has been backgrounded for a while may not get its context back until it is
 * looked at again — so the player is told what happened rather than left in
 * front of a frozen picture wondering whether the game crashed. Built once and
 * kept hidden; the handlers only toggle `hidden`.
 */
function createContextNotice(): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'context-lost-notice';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  const panel = document.createElement('div');
  panel.className = 'context-lost-notice__panel';
  const title = document.createElement('strong');
  title.textContent = 'Graphics paused';
  const body = document.createElement('p');
  body.textContent =
    'The browser reclaimed this game’s graphics while it was in the background. It will pick up where it left off in a moment.';
  panel.append(title, body);
  notice.appendChild(panel);
  return notice;
}
