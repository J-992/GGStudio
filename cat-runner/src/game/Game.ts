import * as THREE from 'three';
import { GameState, GameStateMachine, type FailReason } from './GameState';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { SaveManager } from './SaveManager';
import { SettingsManager, type GameSettings } from './SettingsManager';
import {
  notifyGameFailed,
  notifyGameStarted,
  notifySoundChanged,
} from './IntegrationHooks';
import { Poki } from './PokiSDK';
import { PhysicsWorld, initRapier } from '../physics/PhysicsWorld';
import {
  PlayerController,
  PlayerState,
  consumeEdges,
  latchEdges,
  type RunInput,
} from '../physics/PlayerController';
import type { Lane } from '../levels/chunkTemplate';
import { PHYSICS, capsuleFeetOffset } from '../physics/PhysicsConfig';
import { FollowCamera, viewportFraming } from '../camera/FollowCamera';
import { AssetRegistry } from '../assets/AssetRegistry';
import { disposeProceduralCache } from '../assets/ProceduralProps';
import { disposeBuildingWindowCache } from '../levels/procedural/BuildingWindows';
import { disposeBuildingAssets } from '../levels/procedural/Buildings';
import { disposeClotheslineAssets, setClotheslineModel } from '../levels/procedural/ClotheslineHazard';
import { disposeVentPipeAssets } from '../levels/procedural/VentPipeHazard';
import { Cat, setFishModel } from '../entities/Cat';
import { setFishCoinTexture, disposeFishCoinAssets } from '../entities/Collectible';
import { ChunkBuilder, type TrackAhead } from '../levels/procedural/ChunkBuilder';
import { ROOF_TIER_HEIGHT } from '../levels/procedural/ChunkTypes';
import { TRACK_Y, CHUNK_LENGTH } from '../levels/TrackConfig';
import { MAX_LIVES, NINE_LIVES_BONUS } from '../levels/procedural/PowerUpConfig';
import { speedMultiplierForElapsed } from '../levels/procedural/DifficultyCurve';
import {
  TUTORIAL_LEVEL_CHECKPOINTS,
  TUTORIAL_LEVEL_CHUNKS,
  TUTORIAL_LEVEL_FINISH_ARC,
} from '../levels/procedural/TutorialLevel';
import {
  setShieldModel,
  setHeartModel,
  setMagnetModel,
  setCatnipPickupModel,
  setEnergyDrinkModel,
} from '../levels/procedural/PowerUpModels';
import {
  POWERUP_COLOR,
  powerUpMaterials,
  unitOctahedronGeometry,
} from '../levels/procedural/PlaceholderAssets';
import { PowerUpManager } from './PowerUpManager';
import { TutorialDirector, type TutorialView } from './Tutorial';
import { OBSTACLE_MODELS } from '../levels';
import { MEGAKIT_PANELS } from '../assets/BuildingFacade';
import { ParticlePool } from '../effects/ParticlePool';
import { CatnipGroundTrail } from '../effects/CatnipGroundTrail';
import { UIManager, type HudState, type RunSummary } from '../ui/UIManager';
import { CatPreview } from '../ui/CatPreview';
import { runGuarded } from './frameGuard';

/**
 * Top-level orchestrator.
 *
 * Owns the renderer, the fixed-step simulation, the state machine and the
 * lifecycle of everything below it. The structure to keep in mind:
 *
 *   frame()               - render rate, variable dt: visuals, camera, HUD
 *     physics.update()    - drives fixedStep() at exactly 1/60, N times
 *       fixedStep()       - player, chunk streaming, fall recovery
 *
 * Nothing gameplay-relevant happens at render rate, which is what makes the
 * game behave identically at 30, 60 and 144 fps.
 */

/** Slow-motion factor applied briefly on failure. */
const FAIL_SLOWMO_SCALE = 0.25;
const FAIL_SLOWMO_DURATION = 0.4;
/** Largest real delta the loop will accept, to survive tab stalls. */
const MAX_FRAME_DELTA = 0.1;

/**
 * Global pace of the simulation, as a fraction of real time. 0.8 runs the whole
 * game 20% slower than it used to.
 *
 * Deliberately a *time* scale rather than a cut to `PHYSICS.runSpeed`, which is
 * the obvious way to slow a runner down and the wrong one. `runSpeed` and
 * `jumpImpulse` are a matched pair - 11 u/s against gravity -18 is what makes
 * the measured flat-to-flat jump 9.53 units, and every gap in the game is
 * compressed to fit inside that (`GAP_COMPRESSION` in `src/levels/index.ts`).
 * Taking 20% off the speed alone takes 20% off the jump too, and every gap
 * authored against the old reach becomes unclearable. Scaling the delta instead
 * leaves every distance, arc and clearance in the game exactly as tuned and
 * simply plays them out over more seconds: obstacles arrive 20% slower, the
 * player has 25% longer to read them, and nothing that was possible stops being
 * possible.
 *
 * Applied to the simulation only. The camera and the fail-screen timers keep
 * running on the real delta - a smoother that lags real time is just a slower
 * smoother, not a slower game.
 *
 * Composes with the transient scales rather than replacing them: the tutorial's
 * slow-down and the death beat both write `this.timeScale`, and are still
 * expressed relative to normal speed.
 */
const GAMEPLAY_TIME_SCALE = 0.8;

/**
 * Lives per attempt. Spent on obstacle hits, missed corners and falls.
 *
 * Nine Lives can add to this mid-run, but only up to `MAX_LIVES` - see there
 * for why the ceiling sits one above this floor.
 */
const LIVES_PER_RUN = 3;
/** Seconds between green-ember puffs near an uncollected energy drink, and
 *  how many particles each puff spends - see `updateEndlessCollectibles()`.
 *  Low rate/count on purpose: a mobile-friendly ambient cue, not a flourish. */
const ENERGY_DRINK_EMBER_INTERVAL = 0.5;
const ENERGY_DRINK_EMBER_COUNT = 2;
/**
 * How long a life loss buys you.
 *
 * This is a real window to get out of trouble, not just a visual: contacts do
 * nothing while it runs, so the player can be dumped back onto the roof in front
 * of the obstacle that just hit them without instantly losing a second life.
 */
const INVULN_DURATION = 2;
/** How far back along the track a fall recovery drops the runner. */
const RECOVERY_SETBACK = 6;

/**
 * Degrees of extra field of view while Catnip Rush is up.
 *
 * A dedicated kick rather than leaning on `FollowCamera`'s speed-derived
 * expansion, because that one cannot see this: it scales
 * `(speed - fovExpansionSpeed) / (PHYSICS.runSpeed - fovExpansionSpeed)`, and
 * Catnip Rush's effect *is* a multiplier on `PHYSICS.runSpeed` (see
 * `PowerUpManager`). Numerator and denominator move together, the ratio stays
 * pinned at 1, and the fastest twelve seconds in the game were being framed
 * with exactly the same lens as ordinary cruising. That is most of the reason
 * the rush read as "the same run, slightly quicker".
 */
const CATNIP_FOV_BOOST = 11;

/** Particles thrown off each hazard Catnip Rush demolishes. */
const SMASH_PARTICLE_COUNT = 22;
/** How far the smash hue advances per hazard, in turns of the colour wheel.
 *  Irrational-ish on purpose so consecutive smashes never repeat a colour. */
const SMASH_HUE_STEP = 0.17;
/**
 * How far ahead the tutorial level looks for something to teach, in arc
 * units. Comfortably past `Tutorial.LESSON_LEAD` (26): the director wants
 * the hazard's arc to be *stable* by the time it starts the lesson, and a
 * range that only just covered the lead would have the clothesline blink in
 * and out of the scan as the runner crosses a chunk boundary.
 */
const TUTORIAL_SCAN_RANGE = 45;

// --- Attract screen --------------------------------------------------------

/**
 * Where the menu's cat sits, as arc length along the route dealt behind it.
 *
 * Under `DECK_A_LENGTH` (11.75) deliberately. The first chunk the director
 * deals is *not* guaranteed to be a plain straight - a 'jump' chunk can land
 * there, and its gap opens at `GAP_START_Z` - but deck A is the one span every
 * chunk type keeps, which is also why a run can spawn the player at arc 0 at
 * all. The lane is not assumed either: `safeLaneNear` picks one an obstacle
 * chunk has not filled, so the cat never ends up sat inside a crate.
 */
const ATTRACT_ARC = 9.5;
/**
 * Camera offsets from the cat, in the route's own frame: back along the route,
 * out to one side, and up.
 *
 * *Behind* the cat - a lower arc - so what fills the frame past it is the
 * rooftop run stretching away, which is the entire point of putting the game
 * itself behind the menu rather than a flat colour. The camera needs no deck
 * under it, but at this setback it has one anyway.
 */
const ATTRACT_CAM_BACK = 3.2;
/**
 * Sideways offset, kept small on purpose.
 *
 * It buys the three-quarter angle, but every metre of it also swings the route
 * away from the middle of the frame - the camera aims at the cat, so offsetting
 * sideways rotates the whole view off the route's axis. At 2.4 the rooftops ran
 * out of the top corner instead of receding behind the cat, which is the one
 * thing the shot exists to show. 1.15 against a 3.2 setback is about 20 degrees
 * of angle and leaves the vanishing point comfortably inside the frame.
 */
const ATTRACT_CAM_SIDE = 1.15;
/** Above the capsule's centre, so about 1.6 above the deck - a shade over the
 *  cat's own standing height. High enough to look down on it a little, low
 *  enough that the horizon stays in frame rather than being pushed off the
 *  top by a downward tilt. */
const ATTRACT_CAM_UP = 1.1;
/**
 * Height above the cat's paws the menu camera aims at.
 *
 * Low - below the chest - because aiming high pushes the subject *down* the
 * frame, and the bottom of this frame is where the Play/Shop/Settings column
 * sits. At 0.72 (the chest) the cat's own paws sat behind the Play button.
 */
const ATTRACT_LOOK_UP = 0.42;
/** Tighter than `DEFAULT_CAMERA.baseFov` (67, chosen to keep a fast runner and
 *  the track ahead of it in frame at once). Nothing here is moving, and 67
 *  degrees across a subject four metres away stretches the nearest thing to
 *  the lens - which, with the cat turned three-quarter, is its own face. */
const ATTRACT_FOV = 46;
/** How far the cat is turned off facing the lens dead-on. */
const ATTRACT_CAT_TURN = 0.45;
/** A slow camera drift, so the menu is a scene rather than a still. Cycles per
 *  second, then how far it carries the camera sideways and vertically. */
const ATTRACT_DRIFT_HZ = 0.06;
const ATTRACT_DRIFT_SIDE = 0.55;
const ATTRACT_DRIFT_UP = 0.18;
/**
 * How the shot adapts to a short, wide viewport - a landscape phone.
 *
 * The menu's clear band is whatever is left between the title lockup and the
 * button column, and on a 812x375 screen that is about 80 pixels rather than
 * the ~270 a desktop window leaves. Framed identically, the cat lands half
 * behind the Play button. So the shot pulls back (a smaller cat) and aims
 * lower (which lifts the cat *up* the frame, since the aim point is what sits
 * at screen centre) in proportion to how squeezed the viewport is.
 *
 * The ramp starts just past 16:9 so an ordinary desktop window is untouched.
 */
const ATTRACT_SQUEEZE_FROM = 1.8;
const ATTRACT_SQUEEZE_TO = 2.25;
/** Fraction added to the setback, and taken off the aim height, at full squeeze. */
const ATTRACT_SQUEEZE_BACK = 0.6;
const ATTRACT_SQUEEZE_LOOK = 0.25;

/** Height above the cat's paws the power-up glow floats at. */
const POWERUP_GLOW_HEIGHT = 1.6;
const POWERUP_GLOW_SPIN_RATE = 2.4;
/** Seconds between sparkle particles while a power-up is active. */
const POWERUP_SPARKLE_INTERVAL = 0.18;

const _catPos = new THREE.Vector3();
const _catRot = new THREE.Quaternion();
const _catVel = new THREE.Vector3();
/**
 * `_catPos` is the physics capsule's centre, which is half a capsule above the
 * cat's paws. The camera frames the *visible* cat, so it gets its own target at
 * the feet - otherwise every camera height in FollowCamera is quietly measured
 * from the wrong origin.
 */
const _camTarget = new THREE.Vector3();
/** Scratch for the smash burst's rainbow hue - see `onHazardSmashed`. */
const _smashColor = new THREE.Color();
const _forward = new THREE.Vector3();
const _catnipTrailPos = new THREE.Vector3();
const _listenerFwd = new THREE.Vector3();
const _listenerUp = new THREE.Vector3(0, 1, 0);
const _upAxis = new THREE.Vector3(0, 1, 0);
const _attractDir = new THREE.Vector3();
const _attractRight = new THREE.Vector3();
const _attractCam = new THREE.Vector3();
const _attractLook = new THREE.Vector3();
const _recovery = new THREE.Vector3();
const _recoveryDir = new THREE.Vector3();
const _recoveryRight = new THREE.Vector3();

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private canvas!: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private followCamera!: FollowCamera;

  /**
   * Drawing-buffer size last actually applied, in CSS pixels.
   *
   * Kept so {@link measureViewport} can be called from anywhere, as often as
   * anything likes, and cost nothing when the viewport has not moved -
   * `setSize` reallocates the backbuffer, which is not something to do on a
   * `visualViewport` event that fires on every scroll.
   */
  private viewportWidth = 0;
  private viewportHeight = 0;

  private physics!: PhysicsWorld;
  private player!: PlayerController;
  private particles!: ParticlePool;
  private catnipTrail!: CatnipGroundTrail;

  private registry = new AssetRegistry();
  private cat!: Cat;
  private catPreview: CatPreview | null = null;

  /** Non-null while a run is active. See `startEndless()`. */
  private endless: ChunkBuilder | null = null;
  /**
   * The menu's live scene - a real route, real lighting, and the cat sat on it
   * eating its fish. Non-null exactly while the attract screen owns the frame:
   * the main menu and everything reachable from it without starting a run.
   *
   * Kept as its own field rather than reusing `endless` because nothing about
   * it is a run: no physics steps, no player, no HUD, no score. See
   * `startAttract()`.
   */
  private attract: ChunkBuilder | null = null;
  /** Seconds the attract screen has been up, driving its camera drift. */
  private attractTime = 0;
  /** Timers/state for the endless track's power-ups. Owned here (not by
   *  `ChunkBuilder`) because most of what a power-up does touches state this
   *  class already owns - lives, run speed, score - see `PowerUpManager`'s
   *  own doc comment. */
  private powerUps = new PowerUpManager();
  /** Endless-mode score: one point per fish, doubled while Golden Fish
   *  Bonus is active. The campaign has no equivalent - `fishCollected`
   *  alone already served it, since every fish was worth the same. */
  private endlessScore = 0;
  /** Floating glow above the cat while any power-up is active. One mesh,
   *  material swapped to match whichever type is active. */
  private powerUpGlow!: THREE.Mesh;
  private powerUpSparkleTimer = 0;

  readonly states = new GameStateMachine();
  private input!: InputManager;
  private audio = new AudioManager();
  private save = new SaveManager();
  private settings = new SettingsManager();
  private ui!: UIManager;

  // --- Run state ---
  /**
   * Metres run this attempt - arc length along the generated route, which is
   * what "distance" has to mean once the track turns corners: raw world Z
   * stops counting the moment the route stops running down it.
   *
   * Held as the *furthest* arc reached, not the current one. Falling off the
   * rooftops is survivable (`recoverFromFall` re-places the cat some way back
   * up the route), and a distance counter that ticked backwards on a recovery
   * would read as the game taking away progress the player had already made.
   */
  private runDistance = 0;
  /** The endless difficulty ramp's own memory of the last base speed it
   *  applied - see `updateDifficultySpeed()`. Reset alongside `runDistance`. */
  private currentSpeedBase = PHYSICS.baseRunSpeed;
  /** Ordinary score fish picked up this attempt. Reset by resetRunState. */
  private fishCollected = 0;
  /** Counts down to the next green-ember puff near an uncollected energy
   *  drink - see `updateEndlessCollectibles()`. Reset by resetRunState so a
   *  fresh run doesn't inherit a mid-countdown timer. */
  private energyDrinkEmberTimer = 0;
  /**
   * What the last finished run scored, captured at the moment it ended.
   *
   * Snapshotted rather than read back off `save` when the overlay draws:
   * `recordRun` banks fish into a *wallet*, so by the time anything renders,
   * `save.data.fish` is the running total and no longer answers "how many did
   * I just get". `isNewBest` has the same problem in sharper form - the record
   * has already been overwritten with this run's own distance, so comparing
   * afterwards can only ever say "equal".
   */
  private lastRunSummary: RunSummary = {
    distance: 0,
    fish: 0,
    bestDistance: 0,
    isNewBest: false,
  };
  private failReason: FailReason = 'fell';
  /** A run has been asked for and is waiting on an interstitial. See `enterRun()`. */
  private runPending = false;
  private slowMoTimer = 0;
  private timeScale = 1;
  private elapsed = 0;

  // --- Lives ---
  private lives = LIVES_PER_RUN;
  /** Campaign always displays `LIVES_PER_RUN` directly; endless mode's own
   *  pip row grows when Nine Lives is collected, so it needs its own total. */
  private livesTotal = LIVES_PER_RUN;
  private invulnTimer = 0;

  /** Rotates the smash burst's colour, so a row of crates goes off as a
   *  rainbow rather than as the same green puff three times. */
  private smashHue = 0;

  // --- Tutorial ---
  /**
   * True only while the runner is still inside the first-run tutorial
   * prefix at the start of an endless run - see `startEndless()`. Gates the
   * handful of places ordinary endless behaviour would otherwise be wrong
   * for it: `loseLife()`/`fallToDeath()` (always a free checkpoint respawn
   * while this is true, never a spent life or a failed run) and the cue
   * scanning in `updateTutorialLevel()`. Nothing else about the run differs -
   * it is the same `ChunkBuilder`, the same lives/score bookkeeping, the
   * same speed ramp - which is the whole point: the tutorial is a temporary
   * mode within one run, not a separate one.
   */
  private tutorialActive = false;
  /**
   * Non-null only while `tutorialActive` - a fresh instance every run that
   * includes the prefix (see `startEndless()`), never persisted, so a replay
   * from the main menu's Tutorial button teaches everything again. See
   * `Tutorial.ts`.
   */
  private tutorialLevel: TutorialDirector | null = null;
  private readonly tutorialAhead: TrackAhead = {
    gapArc: Infinity,
    jumpArc: Infinity,
    duckArc: Infinity,
    obstacleArc: Infinity,
    blocked: [false, false, false],
    padArc: Infinity,
  };
  private readonly tutorialView: TutorialView = {
    arc: 0,
    obstacleArc: Infinity,
    blocked: [false, false, false],
    jumpArc: Infinity,
    gapArc: Infinity,
    duckArc: Infinity,
    padArc: Infinity,
    turnArc: Infinity,
    turnDir: 0,
    lane: 0,
    ducked: false,
    laneChanged: false,
    jumped: false,
    turned: false,
    suspended: false,
  };
  // --- Frame bookkeeping ---
  private lastFrameTime = 0;
  private rafHandle = 0;
  private running = false;
  private fpsSamples: number[] = [];
  private debugVisible = false;
  private contextLost = false;

  // Reused per-frame objects.
  private driveInput: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };
  private hudState: HudState = {
    fishCollected: 0,
    distance: 0,
    chasePressure: 0,
    tutorialText: null,
    tutorialCue: null,
    lives: LIVES_PER_RUN,
    livesTotal: LIVES_PER_RUN,
    invulnerable: false,
    turnWarning: false,
    turnProximity: 0,
    turnDirection: 0,
    pursuitStage: 0,
    powerUps: [],
  };

  private unsubscribes: Array<() => void> = [];

  // ==========================================================================
  // Boot
  // ==========================================================================

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.setupRenderer(canvas);

    // An ad must play over a silent, frozen game. Suspending the audio context
    // covers the looping slide/wind beds as well as one-shots, but they are
    // zeroed explicitly too: a loop whose gain was ramped up before the break
    // would otherwise come back at full volume on the other side.
    Poki.onAdStart = () => {
      this.audio.setSlideIntensity(0);
      this.audio.setWindIntensity(0);
      this.audio.suspend();
      this.stop();
    };
    Poki.onAdEnd = () => {
      this.audio.resume();
      // Without this the first frame after the break sees the whole ad as one
      // delta. `MAX_FRAME_DELTA` would clamp it, but a clamped 250 ms step is
      // still a visible lurch.
      this.lastFrameTime = performance.now();
      this.start();
    };

    this.input = new InputManager(document.body, canvas);
    this.ui = new UIManager(this.states, this.save, this.settings, this.audio, this.input, {
      onPlay: () => this.enterRun(),
      onResume: () => this.resume(),
      onRestart: () => this.enterRun(),
      onReturnToMenu: () => this.returnToMenu(),
      onTutorial: () => this.startEndless({ forceTutorial: true }),
      onOpenShop: () => this.states.transition(GameState.Shop),
      onOpenSettings: () => this.openSettings(),
      onCloseSettings: () => this.closeSettings(),
      onBuySkin: (id) => {
        // The purchase is the shop's own business - Game's only stake in it is
        // the sound, which has to distinguish "bought it" from the generic
        // click every button in the UI already makes. A refused purchase (not
        // affordable, already owned) returns false and stays silent, so the
        // absence of the sound is itself the feedback.
        if (this.save.unlockSkin(id)) this.audio.play('fishCollect', { rate: 0.9 });
      },
      onSelectSkin: (id) => {
        this.save.selectSkin(id);
        // Deliberately not awaited: the menu updates immediately and the coat
        // arrives when the map does, which on a repeat pick is the same frame.
        void this.cat?.setSkin(id);
        void this.catPreview?.setSkin(id);
      },
      onPreviewSkin: (id) => {
        // Only the shop's own cat. Pointedly *not* `this.cat`, which is the
        // runner the player owns: browsing the roster must not dress the
        // gameplay cat in a coat that has not been bought.
        void this.catPreview?.setSkin(id);
      },
      onToggleSound: () => this.toggleSound(),
      onResetProgress: () => {
        this.save.reset();
        this.ui.refresh();
      },
    });

    this.ui.setLoadingProgress(0.02, 'Waking the cat...');

    await initRapier();
    this.ui.setLoadingProgress(0.25, 'Building the rooftops...');

    this.physics = new PhysicsWorld();
    this.followCamera = new FollowCamera(this.viewportWidth / this.viewportHeight, this.physics);
    this.particles = new ParticlePool(this.scene);
    this.catnipTrail = new CatnipGroundTrail(this.scene);

    await this.loadAssets();

    this.cat = new Cat(this.registry);
    await this.cat.load(this.save.data.selectedSkin);
    this.scene.add(this.cat.root);

    this.setupCatPreview();

    // Endless-only in practice (nothing ever activates a power-up in the
    // campaign), but created here rather than lazily in `startEndless()` -
    // one mesh, always in the scene, just invisible until needed.
    this.powerUpGlow = new THREE.Mesh(unitOctahedronGeometry, powerUpMaterials.shield);
    this.powerUpGlow.scale.setScalar(0.45);
    this.powerUpGlow.visible = false;
    this.scene.add(this.powerUpGlow);

    this.createPlayer();
    this.registerStateHandlers();
    this.bindInput();
    this.bindSettings();
    this.bindWindowEvents();

    this.ui.setLoadingProgress(1, 'Ready');

    // Conversion-to-play is measured against this call, so it goes in the
    // moment the loading screen is done - before the menu is up, and well
    // before anyone presses Play.
    Poki.loadingFinished();

    this.states.force(GameState.MainMenu);
    this.start();

    // First launch ever, and only then - see `SaveData.tutorialCompleted`.
    // `startEndless()` transitions straight on to `Intro`/`Playing` and,
    // since `tutorialCompleted` is still false, folds the tutorial prefix
    // into that same call - see its own doc comment. State transitions are
    // synchronous while rendering always waits for the next animation frame,
    // so the main menu is never actually painted on a fresh install.
    if (!this.save.data.tutorialCompleted) this.startEndless();
  }

  private setupRenderer(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // MSAA is a context-creation flag - it cannot be toggled later, so it
      // is decided once here against the same detected tier everything else
      // reads. On a mobile tiler multisampling is paid in memory bandwidth
      // on every tile resolve, which is the scarcest thing on that hardware
      // and buys the least on a flat-shaded, high-contrast art style at a
      // run's speed. Desktop ('high') keeps it.
      antialias: this.settings.get('graphicsQuality') === 'high',
      powerPreference: 'high-performance',
      // The game never reads pixels back, and skipping the alpha buffer is a
      // free win on mobile tilers.
      alpha: false,
      stencil: false,
    });

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Before anything is loaded, deliberately: see `bindViewportSizing`.
    this.bindViewportSizing();

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /**
   * Keeps the drawing buffer the same size as the canvas element, from the
   * first frame to the last.
   *
   * This used to be one `window.resize` listener, added by
   * `bindWindowEvents()` - which runs at the *end* of `init()`, on the far
   * side of Rapier's WASM and every model, texture and sound the game owns.
   * On a phone that is several seconds during which the viewport is at its
   * most volatile and nothing was listening: the URL bar collapses on the
   * first scroll, an orientation lock settles, and - the case this was
   * reported for - a Poki build's iframe is handed its real size some time
   * after the document inside it starts running. Every one of those arrived
   * while the listener did not exist yet, and none of them fire again on
   * their own. The canvas therefore kept whatever `window.innerWidth/Height`
   * happened to say during boot, forever; when that was zero (an iframe not
   * yet laid out), the backbuffer was 0x0 and the page painted the canvas's
   * own CSS backdrop - a full screen of orange with the game running,
   * invisible, behind it - until something else happened to fire a resize.
   *
   * So three things changed. The listeners go in here, before the load rather
   * than after it. `ResizeObserver` joins them, because it is the only one of
   * the four that reports the element's *own* box - it fires on that first
   * real layout whether or not the window ever resized, which is exactly the
   * iframe case. And the size is read from the canvas rather than from
   * `window`, for the same reason.
   */
  private bindViewportSizing(): void {
    this.measureViewport();

    const onResize = () => this.measureViewport();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.measureViewport());
    observer?.observe(this.canvas);

    this.unsubscribes.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      observer?.disconnect();
    });
  }

  /**
   * Re-reads the canvas's box and resizes everything that depends on it.
   *
   * The canvas is `position: fixed; inset: 0`, so its box *is* the viewport -
   * and unlike `window.innerWidth/Height` it is still right inside an iframe
   * whose own size arrived late. `window` is kept only as the fallback for a
   * measurement of zero, which is a canvas that has not been laid out yet
   * rather than a viewport that is genuinely empty.
   *
   * Cheap to call redundantly: an unchanged size returns before touching the
   * renderer.
   */
  private measureViewport(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    if (width === this.viewportWidth && height === this.viewportHeight) return;

    this.viewportWidth = width;
    this.viewportHeight = height;

    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.setSize(width, height);
    // Both of these are built partway through `init()`, long after the first
    // measurement - a resize that lands before they exist is simply picked up
    // by their own constructors.
    if (this.followCamera) this.followCamera.setAspect(width / height);
    this.catPreview?.resize();
  }

  /**
   * Caps device pixel ratio. Uncapped DPR on a modern phone means rendering
   * 3x more pixels than the panel can show, which is the single easiest way to
   * lose the frame budget.
   */
  private targetPixelRatio(): number {
    const quality = this.settings.get('graphicsQuality');
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const cap = quality === 'low' ? 1 : quality === 'medium' ? 1.25 : isMobile ? 1.5 : 2;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  /**
   * Shadow-map resolution is the largest single GPU cost `graphicsQuality`
   * doesn't already gate (unlike particles/shadow-enable/DPR). Collapses
   * low+medium into one cheaper tier - a 4x reduction in shadow texels -
   * rather than three distinct sizes, since that's the single biggest lever
   * available without a separate visual-QA pass per tier.
   */
  private shadowMapSizeForQuality(): number {
    return this.settings.get('graphicsQuality') === 'high' ? 1024 : 512;
  }

  private async loadAssets(): Promise<void> {
    this.registry.onProgress = (p) => {
      // Asset loading occupies the 25%-95% band of the loading bar.
      this.ui.setLoadingProgress(0.25 + p.fraction * 0.7, `Loading ${p.currentItem}`);
    };

    await Promise.all([
      this.registry.loadCat(),
      this.registry.loadProps('megakit', MEGAKIT_PANELS),
      this.registry.loadObstacleModels(OBSTACLE_MODELS),
      this.registry.loadBuilding(),
      this.registry.loadItemModels(),
      // Non-fatal like every other optional asset here: a failed fetch just
      // leaves Collectible's flat fallback tint in place rather than
      // rejecting the whole boot sequence.
      this.registry.loadFishCoinTexture().then(setFishCoinTexture).catch(() => {}),
      // Catnip Rush's world pickup. Same non-fatal contract - PowerUpModels
      // falls back to the procedural sneaker if it never arrives.
      this.registry.loadEnergyDrinkModel().catch(() => {}),
    ]);

    this.registry.onProgress = null;

    // Swaps the procedural fallbacks in Cat.ts/PowerUpModels.ts for the
    // provided models, wherever the load actually succeeded - both modules
    // keep working off their own procedural builders if a given key never
    // arrives (a failed fetch, a missing source archive in this checkout).
    const fishModel = this.registry.getModel('item/fish');
    if (fishModel) setFishModel(fishModel);
    const shieldModel = this.registry.getModel('item/shield');
    if (shieldModel) setShieldModel(shieldModel);
    const heartModel = this.registry.getModel('item/heart');
    if (heartModel) setHeartModel(heartModel);
    const magnetModel = this.registry.getModel('item/magnet');
    if (magnetModel) setMagnetModel(magnetModel);
    // The cat's own equipped Catnip Rush shoes still come from here, and
    // only from here - the world pickup is `item/energyDrink` below.
    const catnipModel = this.registry.getModel('item/catnipRush');
    if (catnipModel) setCatnipPickupModel(catnipModel);
    // `children.length` rather than a bare null check: a failed glTF load
    // caches an empty Group under the key (see `loadEnergyDrinkModel`), and
    // installing that would leave an invisible pickup instead of falling
    // back to the procedural one.
    const energyDrinkModel = this.registry.getModel('item/energyDrink');
    if (energyDrinkModel?.children.length) setEnergyDrinkModel(energyDrinkModel);
    const clotheslineModel = this.registry.getModel('obstacle/clothesline1');
    if (clotheslineModel) setClotheslineModel(clotheslineModel);
  }

  private createPlayer(): void {
    this.player = new PlayerController(this.physics, {
      onJump: () => {
        this.audio.play('jump');
        this.cat.onJump();
      },
      onLand: (impact, hard) => {
        this.audio.play(hard ? 'landHard' : 'land', { gain: hard ? 0.75 : 0.45 });
        this.cat.onLand(impact);
        this.followCamera.addLandingShake(impact);

        // A clean landing at speed is rewarded with paw prints - a small,
        // cheap piece of feedback for doing it right.
        if (!hard && this.player.horizontalSpeed > 6) {
          _forward.set(Math.sin(this.player.getYaw()), 0, Math.cos(this.player.getYaw()));
          this.particles.pawPrints(_catPos, _forward);
        }
      },
      onCollision: (speed) => {
        // Unreachable while Catnip Rush is up - phasing takes obstacles out
        // of the capsule's collision filter entirely - but guarded anyway,
        // because the one thing that must not happen is a stray contact
        // spending the player's Shield during an effect that already makes
        // them immune to the hit it would have absorbed.
        if (this.powerUps.isActive('catnipRush')) return;

        this.audio.play('collision');
        this.followCamera.addCollisionShake(speed);
        this.particles.burst(_catPos, 8, 0xd8c9a8);

        // A Shield charge absorbs the hit outright - no life spent, just a
        // distinct "that would have cost you" cue so it's clearly a shield
        // doing something, not a hit that silently didn't count.
        //
        // Bug fix: this used to skip straight to `return` here, never
        // calling `loseLife()` - which is the only place that grants
        // `invulnTimer`. The obstacle that was just absorbed is still
        // physically blocking the runner (shield doesn't remove it), so
        // `detectBlocked()` reliably fires `onBlocked()` a fraction of a
        // second later while still wedged against it - and without an
        // invulnerability window active, that unconditional follow-up
        // `loseLife()` call went through for real, silently cancelling the
        // shield's protection. Granting the same window a normal hit's
        // `loseLife()` would have makes that follow-up a free recovery
        // instead, exactly like it already is for an unshielded hit.
        if (this.powerUps.consumeShield()) {
          this.audio.play('collision', { rate: 1.4, gain: 0.5 });
          this.particles.burst(_catPos, 16, 0x6f8fff, 6);
          this.invulnTimer = INVULN_DURATION;
          this.cat.setInvulnerable(true);
          return;
        }

        // Running into an obstacle head-on at a fixed speed is never a glancing
        // mistake - the runner had a lane to be in and wasn't in it. It is still
        // on the roof afterwards though, so it keeps running from where it is.
        this.audio.play('catMeow');
        this.loseLife('crashed');
      },
      // Sound only. The tuck itself follows `player.isDucking`, which the cat
      // reads every frame - see the rising-edge note in Cat.updateAnimation.
      onDuck: () => this.audio.play('slideDuck'),
      onTurn: () => this.audio.play('land', { rate: 1.3, gain: 0.4 }),
      onLaneChange: (_direction, duration) => {
        this.cat.onLaneHop(duration);
        this.audio.play('land', { rate: 1.7, gain: 0.22 });
      },
      onBlocked: () => {
        // Wedged against geometry it cannot climb. This one *must* recover: the
        // runner is still wedged the instant the life is spent, so leaving it
        // there would just burn the remaining lives one grace period apart.
        this.loseLife('crashed', true);
      },
      onSlide: () => {
        // Dust is emitted in the render loop, which knows the real frame delta.
      },
    });
  }

  /**
   * Wires the Shop screen's live cat preview: constructed once against
   * the shared `AssetRegistry` (reusing the already-loaded rig/textures), and
   * started/stopped as the state machine enters/leaves `GameState.Shop`
   * so its `requestAnimationFrame` loop never runs behind a hidden screen.
   */
  private setupCatPreview(): void {
    const canvas = document.getElementById('cat-preview-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;

    this.catPreview = new CatPreview(this.registry, canvas);

    this.unsubscribes.push(
      this.states.onChange((to, from) => {
        if (to === GameState.Shop) {
          void this.catPreview?.load(this.save.data.selectedSkin).then(() => {
            this.catPreview?.start();
          });
        } else if (from === GameState.Shop) {
          this.catPreview?.stop();
        }
      }),
    );
  }

  // ==========================================================================
  // Wiring
  // ==========================================================================

  private registerStateHandlers(): void {
    // Poki's gameplay session is exactly `GameState.Playing` - not Intro, which
    // is a pre-run beat, and not Failed, which is a results screen. Driving it
    // from the state machine rather than from call sites means pause, death,
    // the shop, a hidden tab and the settings page all report correctly
    // without any of them knowing Poki exists. `Poki.gameplayStart/Stop` only
    // send a change, so the repeated Stop across MainMenu/Shop/Settings costs
    // nothing and cannot produce a duplicate event.
    this.unsubscribes.push(
      this.states.onChange((to) => {
        if (to === GameState.Playing) Poki.gameplayStart();
        else Poki.gameplayStop();
      }),
    );

    this.states.register(GameState.Playing, {
      onEnter: () => {
        this.audio.startMusic();
        this.resetInput();
      },
      onExit: (to) => {
        if (to !== GameState.Paused) this.audio.setSlideIntensity(0);
        this.audio.setWindIntensity(0);
      },
    });

    this.states.register(GameState.Paused, {
      onEnter: () => {
        this.audio.setSlideIntensity(0);
        this.audio.setWindIntensity(0);
        this.resetInput();
      },
    });

    this.states.register(GameState.Failed, {
      onEnter: () => {
        this.slowMoTimer = FAIL_SLOWMO_DURATION;
        this.audio.setSlideIntensity(0);
        this.audio.setWindIntensity(0);
        this.audio.play('fail');
        this.ui.showFailure(this.failReason, this.lastRunSummary);
        notifyGameFailed(this.failReason);
      },
      onExit: () => {
        this.timeScale = 1;
        this.slowMoTimer = 0;
      },
    });

    this.states.register(GameState.MainMenu, {
      onEnter: (from) => {
        this.audio.stopMusic();
        // A finished run has to be torn down. A trip to the shop or settings
        // does not: the attract scene stayed live behind both of those (they
        // are pages over the menu, not replacements for it), and tearing it
        // down here would deal a whole new route - a visible hitch, and a
        // different rooftop - every time the player closed one of them.
        // `startAttract()` is a no-op when a scene is already up.
        if (from !== GameState.Shop && from !== GameState.Settings) this.teardownRun();
        this.startAttract();
      },
    });
  }

  private bindInput(): void {
    this.unsubscribes.push(
      this.input.on('restart', () => {
        if (this.states.state === GameState.Playing || this.states.state === GameState.Failed) {
          this.enterRun();
        }
      }),
      this.input.on('pause', () => this.togglePause()),
      this.input.on('mute', () => this.toggleSound()),
      this.input.on('confirm', () => {
        if (this.states.state === GameState.Failed) this.enterRun();
      }),
    );

    // Poki rejects a build with debug code in it, and `import.meta.env.DEV` is
    // a literal `false` in a production bundle - so this branch, the panel it
    // toggles and `buildDebugText` are all dropped from the shipped build
    // rather than merely being unreachable in it.
    if (import.meta.env.DEV) {
      this.unsubscribes.push(this.input.on('debug', () => this.toggleDebug()));
    }
  }

  private bindSettings(): void {
    const apply = (s: GameSettings) => {
      this.audio.masterVolume = s.masterVolume;
      this.audio.musicVolume = s.musicVolume;
      this.audio.effectsVolume = s.effectsVolume;
      this.audio.muted = s.muted;

      this.followCamera.reducedMotion = s.reducedCameraMotion;
      this.followCamera.shake.intensityScale = s.reducedScreenShake ? 0.25 : 1;

      this.particles.enabled = s.graphicsQuality !== 'low';
      this.catnipTrail.enabled = s.graphicsQuality !== 'low';
      this.renderer.shadowMap.enabled = s.graphicsQuality !== 'low';
      this.renderer.setPixelRatio(this.targetPixelRatio());
    };

    apply(this.settings.settings);
    this.unsubscribes.push(this.settings.onChange((s) => apply(s)));
  }

  private bindWindowEvents(): void {
    // Resize deliberately isn't here - it is bound in `setupRenderer()`,
    // before the assets load rather than after. See `bindViewportSizing`.
    const onVisibility = () => {
      if (document.hidden) {
        this.audio.suspend();
        // Pause the simulation outright; a hidden tab gets no rAF anyway, and
        // this stops a huge delta being applied on return.
        if (this.states.state === GameState.Playing) this.states.transition(GameState.Paused);
      } else {
        this.audio.resume();
        this.lastFrameTime = performance.now();
      }
    };

    const onBlur = () => {
      if (!this.settings.get('pauseOnFocusLoss')) return;
      if (this.states.state === GameState.Playing) this.states.transition(GameState.Paused);
      this.resetInput();
    };

    const onUnload = () => this.save.flush();

    // Audio contexts cannot start before a gesture; the first one unlocks it.
    const onFirstGesture = () => {
      void this.audio.unlock().then(() => {
        const s = this.settings.settings;
        this.audio.masterVolume = s.masterVolume;
        this.audio.musicVolume = s.musicVolume;
        this.audio.effectsVolume = s.effectsVolume;
        this.audio.muted = s.muted;
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    window.addEventListener('keydown', onFirstGesture, { once: true });

    this.unsubscribes.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onUnload);
    });
  }

  // ==========================================================================
  // Run lifecycle
  // ==========================================================================

  /**
   * Starts (or restarts) the procedural endless run - the game's only mode.
   *
   * `PlayerController` (lane switch, jump, slide, turns), `FollowCamera`, and
   * the HUD's turn-warning indicator are all reused as-is; `ChunkBuilder` owns
   * everything about the track itself, streaming chunks and wiring the
   * player's path internally.
   *
   * On a fresh install (`!save.data.tutorialCompleted`), or whenever
   * `forceTutorial` is asked for (the main menu's Tutorial button), the run
   * opens with the hand-authored first-run prefix from
   * `src/levels/procedural/TutorialLevel.ts` - `ChunkBuilder`'s own
   * `fixedChunks` option, not a chunk of it decided by `ChunkDirector` - and
   * then falls straight through into the same procedural generation an
   * ordinary run uses, in the same `ChunkBuilder` instance, with no reset,
   * teleport or scene change at the seam. `tutorialActive`/`tutorialLevel`
   * (see their own doc comments) are what makes the prefix teach via cues
   * and respawn-on-failure instead of behaving like ordinary hazards; once
   * `updateTutorialLevel()` reaches the end of it, `completeTutorial()`
   * quietly turns both off and the run just continues.
   */
  startEndless(options: { forceTutorial?: boolean } = {}): void {
    this.teardownRun();

    const includeTutorial = options.forceTutorial || !this.save.data.tutorialCompleted;
    this.tutorialActive = includeTutorial;
    this.tutorialLevel = includeTutorial ? new TutorialDirector() : null;

    this.followCamera.setFarPlane(400);

    // A fresh seed every run, so the chunk sequence (turns, obstacles, fish,
    // power-ups, and section order) varies instead of replaying the same
    // fixed default - including whatever procedural generation picks up
    // with once a tutorial prefix, if any, runs out. Logged so a specific
    // run can be manually re-seeded (hardcode `seed:` below) if a bug needs
    // reproducing.
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    console.info(`[endless] run seed: 0x${seed.toString(16)}`);

    this.endless = new ChunkBuilder(this.scene, this.physics, this.player, {
      seed,
      shadowMapSize: this.shadowMapSizeForQuality(),
      fixedChunks: includeTutorial ? TUTORIAL_LEVEL_CHUNKS : undefined,
      // Every real run opens straight-then-single-obstacle regardless of
      // seed, so it never starts with a clothesline or a pipe in the
      // runner's face - see `ChunkDirector`'s `forceStartSequence`. Only
      // needed when there's no tutorial prefix: the prefix's own opening
      // buffer chunks already do this job, more thoroughly. The attract
      // screen deliberately doesn't ask for this either way: it is a
      // background decoration, not a run.
      forceStartSequence: !includeTutorial,
      onHazardSmashed: (position) => this.onHazardSmashed(position),
    });
    this.endless.start();
    this.player.spawn(new THREE.Vector3(0, TRACK_Y + capsuleFeetOffset(), 0), 0);

    this.resetRunState();
    // Speed ramps exactly like the rest of an endless run through the
    // tutorial prefix too - `runFrame()` calls `updateDifficultySpeed()`
    // unconditionally. Deliberately not held at a gentler pace: the prefix
    // is meant to teach the game at the speed it's actually played at, and
    // the ramp's own opening floor (`SPEED_RAMP_START_MULTIPLIER`) is
    // exactly the speed every run already opens at regardless.

    this.followCamera.reset();
    this.player.getPosition(_catPos);
    this.followCamera.snapTo(this.cameraTarget(), 0);

    this.states.transition(GameState.Intro);
    this.states.transition(GameState.Playing);

    notifyGameStarted();
  }

  private teardownEndless(): void {
    if (!this.endless) return;
    this.endless.dispose();
    this.endless = null;
    this.player.setPath(null);
    // Catnip Rush mutates PHYSICS.runSpeed directly (see PowerUpManager) -
    // leaving mid-run and starting a campaign level while it's active would
    // otherwise carry the speed boost into a level tuned for the base speed.
    this.powerUps.reset();
    // Catnip Rush's ghost mode is refreshed from the live timer every frame
    // (see `readDriveInput`), but nothing drives that once the run is gone -
    // so it is cleared here rather than left to the next run's `player.reset()`.
    this.player.setPhasing(false);
    if (this.powerUpGlow) this.powerUpGlow.visible = false;
    // A later `startEndless()` must never inherit a stale tutorial director.
    this.tutorialLevel = null;
    this.tutorialActive = false;
  }

  private resetRunState(): void {
    this.runDistance = 0;
    // A fresh run must never inherit the previous one's ramped-up speed -
    // `powerUps.reset()` below only undoes a live Catnip multiplier, not
    // this. See `updateDifficultySpeed()`.
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed;
    this.currentSpeedBase = PHYSICS.baseRunSpeed;
    this.fishCollected = 0;
    this.energyDrinkEmberTimer = 0;
    this.elapsed = 0;
    this.timeScale = 1;
    this.slowMoTimer = 0;

    this.lives = LIVES_PER_RUN;
    this.livesTotal = LIVES_PER_RUN;
    this.invulnTimer = 0;
    this.endlessScore = 0;
    this.powerUps.reset();
    // Drops a prompt the last run died in the middle of, and with it the time
    // scale that prompt was holding - `this.timeScale = 1` above only covers
    // the frame, not the director that would write it again. Null in
    // endless mode - a no-op there.
    this.tutorialLevel?.reset();

    this.cat.reset();
    this.cat.setInvulnerable(false);
  }

  private teardownRun(): void {
    this.teardownEndless();
    this.stopAttract();
    this.particles.clear();
    this.catnipTrail.clear();
  }

  // ==========================================================================
  // Attract screen
  // ==========================================================================

  /**
   * Builds the scene the menu sits in front of.
   *
   * The main menu used to be an opaque panel over a scene that had been torn
   * down - no track, no lights, nothing to look at, which is why it needed the
   * panel. This deals a real route instead (same `ChunkBuilder`, same
   * generator, a fresh seed each time, so the view is different every visit)
   * and poses the cat on it eating the fish it always carries. The menu is
   * then a transparent overlay: press Play and the thing already on screen is
   * the thing you start running through.
   *
   * Nothing here simulates. `GameState.MainMenu` is not in `SIMULATING`, so no
   * physics step ever runs; the cat is placed by hand each frame, the camera is
   * posed directly rather than through `FollowCamera`'s spring, and the whole
   * scene costs one `ChunkBuilder.update()` (streaming + shadow focus) plus a
   * skinned mesh. The player capsule is left wherever it was - it drives
   * nothing while this is up.
   *
   * Guarded, and quietly: this runs from `GameState.MainMenu`'s `onEnter`,
   * which `handleFrameError` forces as its recovery path. A throw in here would
   * escape that handler and take out the recovery too, so a failure leaves
   * `attract` null and the menu simply draws over whatever is behind it.
   */
  private startAttract(): void {
    if (this.attract) return;

    try {
      // A fresh seed per visit, for the same reason a run gets one - the menu
      // should not be the same rooftop every single time the game is opened.
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      const attract = new ChunkBuilder(this.scene, this.physics, this.player, {
        seed,
        shadowMapSize: this.shadowMapSizeForQuality(),
        // The one thing about this scene that is not left to the seed. The
        // shot looks down a few metres of deck from behind the cat, and an
        // obstacle or a clothesline dealt into that gap fills the frame and
        // hides the cat completely. Chunk 1 onward is dealt normally, so
        // everything past the cat is still different every visit.
        openingType: 'straight',
      });
      attract.start();
      this.attract = attract;
    } catch (error) {
      console.error('[attract] could not build the menu scene', error);
      this.stopAttract();
      return;
    }

    this.attractTime = 0;
    this.followCamera.setFarPlane(400);
    this.followCamera.camera.fov = ATTRACT_FOV;
    this.followCamera.camera.updateProjectionMatrix();

    this.cat.reset();
    this.cat.setVisible(true);
    this.cat.setInvulnerable(false);
    this.cat.setActivePowerUps([]);
    // After `reset()`, which clears it - see the field's own comment.
    this.cat.showcaseClip = 'eat';

    // Pose everything once here rather than waiting for the next frame, so the
    // menu's first rendered frame is already the finished shot instead of the
    // cat at the last run's position with the camera still pointing at it.
    this.updateAttract(0);
  }

  private stopAttract(): void {
    if (!this.attract) return;
    this.attract.dispose();
    this.attract = null;
    // `ChunkBuilder.start()` handed the player the attract route. Nothing was
    // driving on it, but leaving a disposed route wired to the controller is
    // exactly the kind of thing that survives until something does.
    this.player.setPath(null);
    this.cat.showcaseClip = null;
  }

  /**
   * Poses the menu's cat and camera for one frame.
   *
   * Both are placed in the route's own frame (`getPositionAt`/`getDirectionAt`
   * plus the same left/right basis `recoverEndlessFall` builds) rather than in
   * world coordinates, so the shot composes identically whichever way the
   * opening chunk happens to run.
   */
  private updateAttract(dt: number): void {
    const attract = this.attract;
    const path = attract?.path;
    if (!attract || !path) return;

    this.attractTime += dt;

    const lane = attract.safeLaneNear(ATTRACT_ARC, 0);
    const roofY = ROOF_TIER_HEIGHT[attract.roofTierNear(ATTRACT_ARC)];

    path.getPositionAt(ATTRACT_ARC, _catPos);
    path.getDirectionAt(ATTRACT_ARC, _attractDir);
    _attractRight.set(-_attractDir.z, 0, _attractDir.x);
    _catPos.addScaledVector(_attractRight, lane * PHYSICS.laneSpacing);
    // `_catPos` means the capsule's centre everywhere else in this file, which
    // is half a capsule above the paws - the same convention `startEndless()`
    // spawns on, and what `Cat.update()` expects to be handed.
    _catPos.y = TRACK_Y + roofY + capsuleFeetOffset();

    const camera = this.followCamera.camera;
    // 0 on a desktop window, 1 on a landscape phone - see ATTRACT_SQUEEZE_FROM.
    const squeeze = THREE.MathUtils.clamp(
      (camera.aspect - ATTRACT_SQUEEZE_FROM) / (ATTRACT_SQUEEZE_TO - ATTRACT_SQUEEZE_FROM),
      0,
      1,
    );

    // The other end of the same axis: a portrait phone is as much narrower
    // than 16:9 as a landscape one is wider, and this shot is framed on the
    // cat's *width* - turned three-quarter, filling the clear band between
    // the title and the buttons. At a fixed vertical FOV that band is only 22
    // degrees across in portrait and the cat is cropped at both ears. So the
    // horizontal field is held here too - but through `viewportFraming`,
    // which widens the lens as well as pulling back. The run camera pulls
    // back only (see `FollowCamera.framing`), because widening moves the cat
    // in frame and the run shot's composition is load-bearing. This one's is
    // not: nothing is being played, and the cat is placed by hand a few lines
    // down, so the wider lens is free coverage rather than a lost shot.
    //
    // Reapplied every frame, not once in `startAttract()`, because rotating
    // the device while the menu is up runs `setAspect` - which owns the run
    // camera's FOV and would otherwise leave the menu wearing it.
    const framing = viewportFraming(ATTRACT_FOV, camera.aspect);
    if (camera.fov !== framing.fov) {
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }
    const back = framing.rigScale;

    const drift = Math.sin(this.attractTime * ATTRACT_DRIFT_HZ * Math.PI * 2);
    _attractCam
      .copy(_catPos)
      .addScaledVector(
        _attractDir,
        -ATTRACT_CAM_BACK * (1 + squeeze * ATTRACT_SQUEEZE_BACK) * back,
      )
      .addScaledVector(_attractRight, (ATTRACT_CAM_SIDE + drift * ATTRACT_DRIFT_SIDE) * back);
    _attractCam.y += (ATTRACT_CAM_UP + drift * ATTRACT_DRIFT_UP) * back;

    // Derived from where the camera actually ended up rather than hardcoded,
    // so the drift above cannot slide the cat's gaze off the lens. The turn is
    // then added on top: dead-on is a mugshot, three-quarter is a character.
    _forward.copy(_attractCam).sub(_catPos).setY(0).normalize();
    _catRot.setFromAxisAngle(_upAxis, Math.atan2(_forward.x, _forward.z) + ATTRACT_CAT_TURN);
    _catVel.set(0, 0, 0);

    this.cat.update(dt, {
      position: _catPos,
      rotation: _catRot,
      velocity: _catVel,
      horizontalSpeed: 0,
      lateralSlip: 0,
      steer: 0,
      grounded: true,
      ducking: false,
      // Not `Dead`/`Stumbling`: those drive the off-balance wobble in
      // `Cat.updateAttitude`. A cat eating its dinner is upright and fine.
      state: PlayerState.Running,
    });

    // Streams chunks and re-centres the shadow frustum around the shot, so the
    // cat is lit and shadowed the same way it is mid-run.
    attract.update(_catPos);
    // Spins/bobs the background fish so the menu doesn't read as frozen -
    // see `ChunkBuilder.updateIdleFishVisuals`'s own doc comment for why
    // this isn't just `updateFishVisuals()`.
    attract.updateIdleFishVisuals(dt);

    camera.position.copy(_attractCam);
    _attractLook.copy(_catPos);
    _attractLook.y += ATTRACT_LOOK_UP - squeeze * ATTRACT_SQUEEZE_LOOK - capsuleFeetOffset();
    camera.lookAt(_attractLook);
    camera.updateMatrixWorld();

    camera.getWorldDirection(_listenerFwd);
    this.audio.setListener(camera.position, _listenerFwd, _listenerUp);
  }

  // ==========================================================================
  // Navigation
  // ==========================================================================

  private togglePause(): void {
    const state = this.states.state;
    if (state === GameState.Playing) {
      this.states.transition(GameState.Paused);
    } else if (state === GameState.Paused) {
      this.resume();
    }
  }

  private resume(): void {
    this.states.transition(GameState.Playing);
    this.lastFrameTime = performance.now();
  }

  private settingsReturnState = GameState.MainMenu;

  private openSettings(): void {
    this.settingsReturnState =
      this.states.state === GameState.Paused ? GameState.Paused : GameState.MainMenu;
    this.states.transition(GameState.Settings);
  }

  private closeSettings(): void {
    this.states.transition(this.settingsReturnState);
  }

  private returnToMenu(): void {
    this.states.transition(GameState.MainMenu);
    this.ui.refresh();
  }

  private toggleSound(): void {
    const muted = !this.settings.get('muted');
    this.settings.set('muted', muted);
    notifySoundChanged(!muted);
  }

  private toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.ui.setDebugVisible(this.debugVisible);
  }

  // ==========================================================================
  // Loop
  // ==========================================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private frame = (now: number): void => {
    this.rafHandle = requestAnimationFrame(this.frame);
    if (this.contextLost) return;

    runGuarded(
      () => this.runFrame(now),
      (error) => this.handleFrameError(error),
    );
  };

  private runFrame(now: number): void {
    // Clamped at both ends. The ceiling is the long-standing one (a tab
    // restored after a minute must not be handed a minute-long step); the
    // floor is because `now` is a rAF timestamp, which is the moment the
    // frame *began*, while `lastFrameTime` is sometimes stamped from a
    // `performance.now()` taken slightly later - `resume()` and the ad-break
    // handler both do it. That ordering can hand this a small negative
    // delta, and a negative delta is not merely a wasted frame: every
    // exponential smoother downstream computes `1 - exp(-rate * dt)`, which
    // goes negative, which turns a lerp toward a target into a lerp away
    // from it. The camera's FOV is the one that shows it - it diverges
    // rather than recovering.
    const rawDelta = Math.max(
      0,
      Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_DELTA),
    );
    this.lastFrameTime = now;

    this.trackFps(rawDelta);
    this.input.update();

    const state = this.states.state;

    // The attract screen owns the frame outright while it is up. It short-
    // circuits the whole run path below - there is no simulation to step, no
    // player to read, no HUD to write - which is also what keeps the menu
    // cheap enough to leave running the entire time the game is not being
    // played. See `startAttract()`.
    if (this.attract) {
      this.updateAttract(rawDelta);
      if (import.meta.env.DEV && this.debugVisible) this.ui.setDebugText(this.buildDebugText());
      this.renderer.render(this.scene, this.followCamera.camera);
      return;
    }

    if (state === GameState.Failed) this.updateFailure(rawDelta);

    let simDelta = 0;
    if (this.states.isSimulating) {
      // Input, then the tutorial cue check - the tutorial's release
      // condition is a *press* (`TutorialView.ducked` etc), so it has to
      // read the input this frame rather than last one. It no longer alters
      // `this.timeScale` at all (see `updateTutorialLevel()`'s own doc
      // comment), so unlike before, ordering here no longer affects the
      // delta the next line computes.
      this.readDriveInput();
      this.updateTutorialLevel();

      const dt = rawDelta * this.timeScale * GAMEPLAY_TIME_SCALE;
      simDelta = dt;
      this.elapsed += dt;

      this.physics.update(dt, (fixedDt) => this.fixedStep(fixedDt));
      // Render rate, deliberately: streaming a chunk builds Rapier bodies,
      // and ChunkBuilder.update()'s own doc comment is explicit that must
      // never happen while `physics.update()` is mid-step above.
      if (this.endless) this.endless.update(_catPos);
      if (state === GameState.Playing) {
        this.updateDistance();
        // Ramps through the tutorial prefix exactly like the rest of an
        // endless run - see `startEndless()`'s own note on why holding a
        // fixed speed isn't needed.
        this.updateDifficultySpeed();
      }
      this.updateVisuals(dt);
    }

    this.followCamera.update(
      this.cameraTarget(),
      this.player?.getYaw() ?? 0,
      _catVel,
      rawDelta,
    );

    // Particles billboard to the camera and fade against its position, so they
    // run *after* the camera has been moved for this frame. Updating them with
    // last frame's camera leaves a quad on the lens un-faded for a whole frame.
    if (simDelta > 0) this.particles.update(simDelta, this.followCamera.camera);

    this.updateHud();

    if (import.meta.env.DEV && this.debugVisible) this.ui.setDebugText(this.buildDebugText());

    this.renderer.render(this.scene, this.followCamera.camera);
  }

  /**
   * Last line of defence for a throw anywhere in `runFrame()` - see
   * `runGuarded`'s doc comment for why this exists. Logs the real error (so
   * the bug is diagnosable instead of invisible), tears down the broken run,
   * and forces a return to the main menu with a fully reset state - the
   * player can hit Play again immediately instead of staring at a frozen,
   * unresponsive game.
   */
  private handleFrameError(error: unknown): void {
    console.error('[game] frame() threw - recovering to the main menu', error);
    try {
      this.teardownRun();
    } catch (teardownError) {
      console.error('[game] teardownRun() also threw during recovery', teardownError);
    }
    this.states.force(GameState.MainMenu);
    this.ui.refresh();
  }

  /**
   * X/Z track the cat exactly, for lane changes and turns to read as
   * immediate. Y deliberately does NOT come from the cat's own position -
   * `_catPos.y` rises and falls with every jump (up to ~1.73 units, see
   * `PhysicsConfig.jumpImpulse`/`gravity`) and pops with every step-up lip
   * crossing (`PlayerController.tryStepUp`, up to `maxStepUp`), and a
   * camera that tracks that 1:1 chases every jump and randomly jolts at
   * seams. `player.lastGroundY` is the world Y of the surface the cat is
   * actually standing on: it updates live while grounded (so real slopes
   * still track) but freezes the instant the cat leaves the ground, so it
   * holds steady for a jump's entire airborne duration. Anchoring the
   * camera here instead means jumps move the cat within the frame rather
   * than moving the frame - see `FollowCamera`'s `heightDamping`.
   *
   * The height itself comes from {@link cameraHeightTarget}, which keeps
   * that behaviour for ordinary jumps but anticipates a rooftop tier change
   * rather than waiting out the whole arc at the old height.
   */
  private cameraTarget(): THREE.Vector3 {
    return _camTarget.set(_catPos.x, this.cameraHeightTarget(), _catPos.z);
  }

  /**
   * The height {@link cameraTarget} anchors to.
   *
   * Grounded, this is just `lastGroundY` - the surface under the cat's feet,
   * exactly as before. Airborne, `lastGroundY` is frozen at the deck the cat
   * *left*, which is right for an ordinary jump (see `cameraTarget`'s own
   * doc comment) and wrong for a rooftop tier change: on a `'jump'` chunk
   * that steps up (trampoline) or down (an ordinary walk-off), the camera's
   * height would not move at all until the cat had already landed on the new
   * deck - the "sees the new terrain too late" report.
   *
   * `ChunkBuilder.roofTierNear()` answers with the tier of whichever live
   * chunk covers the arc, and a tier-changing `'jump'` chunk's own
   * `roofTier` is its *destination* (far) tier - `previousRoofTier` is the
   * take-off side. So from the instant of launch this already reads the
   * height the cat is heading for, and for a same-tier jump it returns the
   * tier the cat left from, which is exactly what `lastGroundY` was already
   * holding: zero change for every ordinary jump.
   *
   * Nothing here snaps. `FollowCamera.update()` smooths this axis
   * exponentially (`heightDamping`), so a step in the target at lift-off is
   * chased over the arc's hang time rather than popped.
   */
  private cameraHeightTarget(): number {
    if (this.player.grounded || !this.endless?.path) return this.player.lastGroundY;
    const arc = this.endless.path.projectDistance(_catPos);
    return TRACK_Y + ROOF_TIER_HEIGHT[this.endless.roofTierNear(arc)];
  }

  /**
   * Folds this frame's input snapshot into the pending drive input.
   *
   * **Latched, not overwritten** - and that distinction is the whole reason
   * this comment exists. `physics.update()` drains a fixed-step accumulator,
   * so a rendered frame drives *zero* steps whenever it arrives faster than
   * `PHYSICS.fixedTimeStep` (16.67 ms). On a 144 Hz display a frame is 6.9 ms,
   * so roughly three frames in five run no step at all.
   *
   * This method used to assign `drive.*` straight across. A press that landed
   * on a zero-step frame was therefore written into `driveInput`, never
   * consumed by `consumeEdges` (which only runs inside a fixed step), and then
   * *destroyed* by the next frame's assignment of an all-zero snapshot. Above
   * 60 Hz that silently swallowed a large fraction of every lane change, jump
   * and slide - the input didn't arrive late, it never arrived at all, which
   * is what "input lag, especially swapping lanes" actually was.
   *
   * Accumulating instead means a press survives however many zero-step frames
   * it takes for the accumulator to fill. `consumeEdges` remains the only
   * thing that clears `laneStep`/`turn`/`jump`, so each press is still
   * applied exactly once. `slide` is the one exception - a level, not a
   * pulse (see `RunInput.slide`) - which is why `latchEdges` overwrites it
   * instead of OR-ing it in below. `latchEdges` carries the full reasoning
   * and the arithmetic.
   */
  /**
   * Drops every source's held/latched input *and* the cross-frame drive latch
   * `readDriveInput` maintains. Both halves matter: `input.clear()` alone
   * leaves a press that was banked into `driveInput` but never reached a fixed
   * step (see `readDriveInput`) sitting there through a pause, to fire on the
   * frame the run resumes.
   */
  private resetInput(): void {
    this.input.clear();
    this.driveInput.laneStep = 0;
    this.driveInput.turn = 0;
    this.driveInput.jump = false;
    this.driveInput.slide = false;
  }

  private readDriveInput(): void {
    // Catnip Rush's invincibility half. Refreshed from the live timer rather
    // than on the pickup/expiry edges: it is idempotent, and driving it off
    // the timer means an effect that ends during a pause, a teardown or an ad
    // break can never leave the runner a ghost.
    //
    // The player keeps the wheel throughout. An earlier pass had the rush
    // drive for them - a Bullet Bill that took the corners itself - and it
    // was the wrong trade: the power-up is meant to be the best twelve
    // seconds of the run, and handing the controls back to the game is the
    // one thing guaranteed to make them the least interesting.
    this.player.setPhasing(!!this.endless && this.powerUps.isActive('catnipRush'));

    latchEdges(this.driveInput, this.input.drive);

    // Control is surrendered entirely once the run has failed. Note the runner
    // keeps moving forward - that is not input, it is the whole premise.
    if (this.states.state !== GameState.Playing) {
      this.driveInput.laneStep = 0;
      this.driveInput.turn = 0;
      this.driveInput.jump = false;
      this.driveInput.slide = false;
    }
  }

  /**
   * Drives the first-run tutorial prefix's cues - a no-op once
   * `tutorialActive` is false, so ordinary endless play (and the rest of a
   * run, once the prefix ends) never shows any of this.
   *
   * Deliberately does not touch `this.timeScale` or game speed at all - the
   * prefix runs at exactly the same pace, with exactly the same physics, as
   * the rest of the run (see `startEndless()`'s speed handling). Teaching
   * happens entirely through the cue/arrow (`TutorialDirector`,
   * `UIManager.updateTutorialCue`) and the checkpoint respawn on failure -
   * never by slowing the world down.
   *
   * Every hazard's arc is known in advance (`TutorialLevel.ts`'s fixed
   * chunk sequence), but this still scans live via `ChunkBuilder.hazardsAhead`
   * rather than reading the precomputed table directly - it's the same
   * `TrackAhead` shape `TutorialDirector` already consumes, and scanning
   * means a checkpoint respawn needs no special-case handoff back into this
   * method, the next hazard is just whatever the scan finds ahead next.
   */
  private updateTutorialLevel(): void {
    if (!this.tutorialActive || !this.endless || !this.tutorialLevel) return;
    const tutorial = this.tutorialLevel;

    if (this.states.state !== GameState.Playing) {
      tutorial.reset();
      return;
    }

    const path = this.endless.path;
    if (!path) return;

    const view = this.tutorialView;
    view.arc = path.projectDistance(_catPos);

    if (view.arc >= TUTORIAL_LEVEL_FINISH_ARC) {
      this.completeTutorial();
      return;
    }

    view.lane = this.player.lane as Lane;
    // `laneStep`/`jump` are latched edges `fixedStep` consumes a few lines
    // later, so reading them here (after `readDriveInput`, before
    // `physics.update`) is the one window where they mean "asked to do this
    // thing this frame". `slide` is different - it's already a live level
    // (see `RunInput.slide`), true for as long as the lesson's own arc window
    // sees it held, not just its first frame - which still correctly
    // satisfies `TutorialDirector.advance()`'s "did they duck" check.
    view.ducked = this.driveInput.slide;
    view.laneChanged = this.driveInput.laneStep !== 0;
    view.jumped = this.driveInput.jump;
    // Not an edge - see `TutorialView.turned`'s own doc comment.
    view.turned = this.player.turnBuffered !== 0;
    // Nothing suspends teaching in the tutorial level - there are no
    // power-ups in it at all (every hand-authored chunk sets `powerUp: null`).
    view.suspended = false;

    this.endless.hazardsAhead(view.arc, TUTORIAL_SCAN_RANGE, this.tutorialAhead);
    view.obstacleArc = this.tutorialAhead.obstacleArc;
    view.blocked = this.tutorialAhead.blocked;
    view.jumpArc = this.tutorialAhead.jumpArc;
    view.gapArc = this.tutorialAhead.gapArc;
    view.duckArc = this.tutorialAhead.duckArc;
    view.padArc = this.tutorialAhead.padArc;
    // Synthetic - `turnDistance` is a live distance, not a scanned arc, so
    // it's converted here to keep every lesson in `Tutorial.ts` arc-based.
    view.turnArc = Number.isFinite(this.player.turnDistance)
      ? view.arc + this.player.turnDistance
      : Infinity;
    view.turnDir = this.player.pendingTurn;

    tutorial.update(view);
  }

  /** Everything that must be frame-rate independent lives here. */
  private fixedStep(dt: number): void {
    this.player.step(dt, this.driveInput);
    // One press is one press. readDriveInput() runs once per rendered frame but
    // physics.update() may call this several times off that single read, and
    // laneStep is additive - below 60 fps a single tap moved two lanes.
    consumeEdges(this.driveInput);
    this.player.getPosition(_catPos);

    // Bug fix: this used to sit after the `this.endless` branch's own
    // `return`, so it never ran in endless mode - once a hit set
    // `invulnTimer`, it stayed positive forever, `updateVisuals()` kept
    // calling `cat.setInvulnerable(true)` every render frame regardless of
    // mode, and the damage flash cycled indefinitely instead of stopping
    // after `INVULN_DURATION`. Hoisted above both branches so it always runs
    // once per fixed step, campaign or endless.
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    if (!this.endless) return;

    this.endless.step(dt);
    if (!this.player.grounded && this.player.fallDepth > PHYSICS.fallThreshold) {
      this.fallToDeath();
    }
  }

  /**
   * A hazard Catnip Rush just went through, at the moment it stops existing.
   *
   * `ChunkBuilder.smashPhased()` does the removal; everything here is the
   * part the player can see and hear, and it is the whole reason the removal
   * happens at all. Phasing on its own is silent and invisible - the crate
   * simply slides through the cat - which reads as a collider that has come
   * loose rather than as a power that makes the cat unstoppable.
   *
   * Loud on purpose: a burst in a rotating rainbow hue to tie it to the
   * trail, the collision sample pitched up so it lands as a crunch rather
   * than the "you just lost a life" thud it plays at normally, and a small
   * jolt. Deliberately not `addCollisionShake`, which is tuned to sell a
   * mistake and would throw the frame around for something the player is
   * being rewarded for.
   */
  private onHazardSmashed(position: THREE.Vector3): void {
    this.smashHue = (this.smashHue + SMASH_HUE_STEP) % 1;
    _smashColor.setHSL(this.smashHue, 0.95, 0.58);

    this.particles.burst(position, SMASH_PARTICLE_COUNT, _smashColor.getHex(), 7);
    this.audio.play('collision', { rate: 1.7, gain: 0.45 });
    this.followCamera.addJolt(0.45);
  }

  /**
   * Leaving the roof ends the run. Full stop.
   *
   * This used to spend a life and then call `recoverEndlessFall()`, which set
   * the cat down on the deck eighteen units back up the route and carried on.
   * On paper that is a generous checkpoint; on screen it was the bug that got
   * reported. The player watches the cat drop into a gap, and then - with no
   * animation, no landing, and nothing to hit - it is suddenly back on a roof
   * it had already left, moving again. Read from the outside that is not a
   * checkpoint, it is the fall failing to happen: a bounce off thin air
   * followed by an unexplained teleport.
   *
   * The honest version of the same moment is that a missed jump is a missed
   * jump. It is also the only failure in the game the player can see coming
   * for a full second and still not avoid, which makes it the *worst* one to
   * hand a free continue to: the gap is telegraphed, the jump is one input,
   * and the recovery meant getting it wrong three times in a row cost exactly
   * as much as getting it wrong once.
   *
   * Two things survive from the old path, both for the same reason - they are
   * about the runner being somewhere it cannot run from, not about the price:
   *
   *   - Catnip Rush still recovers, free, with a rainbow burst that says so.
   *     The power-up's promise is that it cannot be lost, and a rush that
   *     ended in a death would be the least memorable twelve seconds in the
   *     game rather than the best.
   *   - The post-hit invulnerability window does *not*. It protects a life
   *     from an obstacle it has already paid for; a fall is not an obstacle,
   *     and a runner in free-fall under a flashing sprite is still a runner
   *     with no roof under it.
   */
  private fallToDeath(): void {
    if (this.states.state !== GameState.Playing) return;

    if (this.powerUps.isActive('catnipRush')) {
      this.recoverEndlessFall();
      // Said out loud, or the rescue is the same unexplained teleport this
      // method exists to have got rid of. During the rush it is the power-up
      // catching the cat, and it should look like it.
      this.particles.burst(_catPos, 26, POWERUP_COLOR.catnipRush, 8);
      this.audio.play('powerUp', { rate: 1.35, gain: 0.6 });
      return;
    }

    // The one deliberate exception to "a missed jump is a missed jump" above:
    // inside the tutorial prefix, a fall is exactly a missed *lesson*, not a
    // missed run - see `respawnAtTutorialCheckpoint`.
    if (this.tutorialActive) {
      this.respawnAtTutorialCheckpoint();
      return;
    }

    this.cat.onHurt();
    this.audio.play('landHard', { rate: 0.7, gain: 0.8 });
    // `fail()` zeroes the pips itself, so the HUD's last frame reads as a
    // death rather than as a run that stopped with lives in hand.
    this.fail('fell');
  }

  /**
   * Spends a life, or ends the run if that was the last one.
   *
   * The two survivable mistakes funnel through here: clipping an obstacle and
   * wedging against something unclimbable. Leaving the roof does not - a fall
   * ends the run outright, and has its own path (see {@link fallToDeath}),
   * which is also why a missed corner needs no case of its own: failing to
   * turn carries the runner off the edge, and that is a fall.
   *
   * `recover` is separate from the reason on purpose. It asks "is the runner
   * still somewhere it can run from?", which is not the same question as "what
   * hit it": a clipped crate leaves it upright and moving, while a wedge
   * leaves it pinned against geometry it cannot climb, where spending the
   * remaining lives one grace period apart is the only other outcome.
   */
  private loseLife(reason: FailReason = 'fell', recover = false): void {
    if (this.states.state !== GameState.Playing) return;

    // Catnip Rush is untouchable, not merely fast. `PlayerController`'s
    // phasing already removes every obstacle the runner could clip, so what
    // is left to reach here is a wedge - and a runner who cannot be hurt
    // being billed for getting stuck is the one way the effect could still
    // cost a life. Recovery still happens (free, exactly as under
    // invulnerability): the runner has to be put back on a roof either way.
    if (this.powerUps.isActive('catnipRush')) {
      if (recover) this.recoverEndlessFall();
      return;
    }

    if (this.invulnTimer > 0) {
      // Invulnerability protects the life, not the geometry. A runner that has
      // already left the roof still has to be put back on it, or it spends the
      // rest of the window falling - straight through the kill plane, with the
      // camera chasing it into empty space - and only recovers once the flash
      // ends. Free of charge, since the life was already paid for.
      if (recover) this.recoverEndlessFall();
      return;
    }

    // Same exception as `fallToDeath`'s: inside the tutorial prefix, this
    // hit is a lesson to redo, not a life to spend.
    if (this.tutorialActive) {
      this.respawnAtTutorialCheckpoint();
      return;
    }

    this.lives--;
    this.cat.onHurt();

    if (this.lives <= 0) {
      this.lives = 0;
      this.fail(reason);
      return;
    }

    this.invulnTimer = INVULN_DURATION;
    this.cat.setInvulnerable(true);
    this.audio.play('landHard', { rate: 0.8, gain: 0.7 });
    this.followCamera.addCollisionShake(PHYSICS.runSpeed);
    this.particles.burst(_catPos, 14, 0xffd27a);

    if (recover) this.recoverEndlessFall();
  }

  /**
   * Puts the runner back on the track after a fall or a wedge, a flat setback
   * along the route from wherever it already was - no per-segment safe-ground
   * tracking, just a fixed distance back along the endless path. A generated
   * jump chunk's gap is short enough that this clears it in practice.
   *
   * The landing lane is chosen, not assumed: `ChunkBuilder.safeLaneNear()`
   * checks whether the runner's own lane is blocked by an obstacle near the
   * recovery point and, if so, picks the nearest lane that isn't - so a
   * recovery never drops the runner right back in front of the obstacle that
   * (indirectly) caused the fall. Chunk generation guarantees at least one
   * lane is always clear at any given Z (see `ChunkGenerators.generateObstacle`).
   *
   * The landing height is looked up the same way, via `roofTierNear()`:
   * the rooftop-traversal system decks chunks at one of three tiers, and
   * this used to hardcode the ground-level height regardless, which could
   * drop the runner mid-air above (or embedded below) a raised deck -
   * exactly the "respawns in a gap" failure the roof-tier system didn't
   * exist yet to cause when this recovery was first written.
   */
  private recoverEndlessFall(): void {
    const endless = this.endless;
    const path = endless?.path;
    if (!path) return;

    const arc = Math.max(0, path.projectDistance(_catPos) - RECOVERY_SETBACK * 3);
    const safeLane = endless.safeLaneNear(arc, this.player.lane as Lane);
    const roofY = ROOF_TIER_HEIGHT[endless.roofTierNear(arc)];

    path.getPositionAt(arc, _recovery);
    path.getDirectionAt(arc, _recoveryDir);
    _recoveryRight.set(-_recoveryDir.z, 0, _recoveryDir.x);
    _recovery.addScaledVector(_recoveryRight, safeLane * PHYSICS.laneSpacing);
    _recovery.y = TRACK_Y + roofY + capsuleFeetOffset();

    this.player.recoverTo(_recovery);
    // recoverTo() -> lockToPath() always resets lane to 0 and re-derives
    // `lateral` from the position just set - which already encodes the
    // chosen lane's offset - so overriding `lane` afterward is the only
    // correction needed.
    this.player.lane = safeLane;
    this.player.getPosition(_catPos);
    this.followCamera.snapTo(this.cameraTarget(), this.player.getYaw());
  }

  /**
   * Puts the runner back just before the tutorial hazard it failed, without
   * spending a life, ending the run, or reseeding the track - the whole
   * reason `tutorialActive` redirects here instead of the ordinary
   * `fail()`/life-spending paths, see that field's own doc comment.
   *
   * Structurally the same placement `recoverEndlessFall()` does - same
   * `getPositionAt`/`safeLaneNear`/`roofTierNear` - but targets a *remembered*
   * checkpoint arc (`TUTORIAL_LEVEL_CHECKPOINTS`, precomputed from the
   * prefix's own hand-authored chunk sequence) rather than a fixed setback
   * from wherever the runner happens to be now, since a fall in particular
   * has usually already carried it past the hazard by the time this runs.
   *
   * The checkpoint chosen is the last one at or just behind the current arc -
   * i.e. whichever hazard was the one just failed. This always resolves to
   * *some* checkpoint, even for a cause that isn't cleanly attributable to
   * one lesson: worst case it's the nearest hazard behind the runner, which
   * is still forward progress with no penalty.
   *
   * Fish already picked up this attempt are left untouched - they're already
   * ordinary in-run fish (`fishCollected`), nothing special banks them, and
   * this path never touches that counter. `tutorialLevel.reset()` at the end
   * drops the in-flight prompt but keeps `learned`, so the same cue
   * naturally re-arms once the runner is back within its lesson's own
   * `LESSON_LEAD` of the hazard again - except on the Combined Challenge's
   * restaged hazards, where the lesson is already learned from earlier in
   * the same run and so stays silent, by the same "never re-arm a learned
   * lesson" rule.
   */
  private respawnAtTutorialCheckpoint(): void {
    const endless = this.endless;
    const path = endless?.path;
    if (!path || !this.tutorialLevel) return;

    const currentArc = path.projectDistance(_catPos);
    const checkpoint =
      TUTORIAL_LEVEL_CHECKPOINTS.filter((c) => c.hazardArc <= currentArc + CHUNK_LENGTH).at(-1) ??
      TUTORIAL_LEVEL_CHECKPOINTS[0];
    const arc = Math.max(0, checkpoint.respawnArc);

    const safeLane = endless.safeLaneNear(arc, this.player.lane as Lane);
    const roofY = ROOF_TIER_HEIGHT[endless.roofTierNear(arc)];

    path.getPositionAt(arc, _recovery);
    path.getDirectionAt(arc, _recoveryDir);
    _recoveryRight.set(-_recoveryDir.z, 0, _recoveryDir.x);
    _recovery.addScaledVector(_recoveryRight, safeLane * PHYSICS.laneSpacing);
    _recovery.y = TRACK_Y + roofY + capsuleFeetOffset();

    this.player.recoverTo(_recovery);
    // recoverTo() -> lockToPath() always resets lane to 0 and re-derives
    // `lateral` from the position just set - see `recoverEndlessFall()`'s own
    // note on the same line.
    this.player.lane = safeLane;
    this.player.getPosition(_catPos);
    this.followCamera.snapTo(this.cameraTarget(), this.player.getYaw());

    this.tutorialLevel.reset();
  }

  /**
   * The tutorial prefix's own finish line - reached once, from
   * `updateTutorialLevel()`, when `view.arc` passes `TUTORIAL_LEVEL_FINISH_ARC`.
   *
   * Deliberately invisible: no state transition, no sound, no overlay, no
   * separate save-bank call - the whole point is that the run just keeps
   * going, exactly as it would have anyway, and the player has no reason to
   * notice the seam. Fish collected during the prefix were never held
   * separately (see `respawnAtTutorialCheckpoint()`'s own note) - they're
   * already `fishCollected`, counting toward this run's eventual
   * `recordRun()` like any other endless fish. All this does is stop
   * scanning for tutorial cues and remember, for every future run, that it
   * doesn't need to happen again.
   */
  private completeTutorial(): void {
    if (!this.tutorialActive) return;

    this.tutorialActive = false;
    this.save.setTutorialCompleted();
    this.tutorialLevel = null;
  }

  /**
   * Advances the run's distance to wherever the cat has got to.
   *
   * Reads `_catPos` as the fixed step last left it, which is deliberately the
   * same value `ChunkBuilder.update()` was just handed a line above - the
   * number on the HUD and the point the track streams around are then the same
   * point, rather than one frame apart.
   */
  private updateDistance(): void {
    const path = this.endless?.path;
    if (!path) return;
    this.runDistance = Math.max(this.runDistance, path.projectDistance(_catPos));
  }

  /**
   * The endless difficulty ramp's speed half - see `DifficultyCurve.ts`'s own
   * comment for why the other half (obstacle frequency/density/combinations)
   * needed no new code here, and for why this is keyed to `this.elapsed`
   * (real gameplay seconds) rather than `this.runDistance` - the ramp has to
   * recover a deliberately slow start regardless of how little ground a
   * player still moving at reduced speed has covered.
   *
   * Applies the new target as a *ratio* against whatever `PHYSICS.runSpeed`
   * currently is, rather than assigning it outright. That is what lets this
   * run every frame with no regard for whether `PowerUpManager` currently has
   * a Catnip Rush multiplier baked into the same field: scaling by
   * `newBase / oldBase` preserves any factor already riding on top of the
   * base exactly (`(base * catnip) * (newBase / base) == newBase * catnip`),
   * where overwriting `runSpeed` outright would silently erase it. Neither
   * side has to know about the other.
   */
  private updateDifficultySpeed(): void {
    const target = PHYSICS.baseRunSpeed * speedMultiplierForElapsed(this.elapsed);
    if (target === this.currentSpeedBase) return;
    // `currentSpeedBase` should never legitimately be non-positive -
    // `speedMultiplierForDistance` is clamped to >= 1 - but this is the one
    // shared, mutable field every frame divides by, so a corrupted value
    // (a stray external write, a NaN route distance from an off-track
    // teleport) must not turn into a non-finite `PHYSICS.runSpeed` that
    // then reaches `AudioParam.setTargetAtTime` in `setWindIntensity()` and
    // throws, taking the whole frame loop down with it. Re-seed from the
    // known-good base rather than dividing by whatever the bad value was.
    if (!Number.isFinite(this.currentSpeedBase) || this.currentSpeedBase <= 0) {
      PHYSICS.runSpeed = target;
    } else {
      PHYSICS.runSpeed *= target / this.currentSpeedBase;
    }
    this.currentSpeedBase = target;
  }

  private fail(reason: FailReason): void {
    if (this.states.state !== GameState.Playing) return;
    // Belt-and-suspenders: the `tutorialActive` guards in `loseLife()`/
    // `fallToDeath()` already redirect every failure away from this method
    // before it's ever reached, so the tutorial prefix never fails by
    // construction, not merely by omission here too.
    if (this.tutorialActive) return;
    this.failReason = reason;
    this.lives = 0;
    this.player.kill();

    // Banked here, on the one path into Failed, rather than in the state's own
    // onEnter: `showFailure` needs the summary and onEnter is what calls it, so
    // doing it there would depend on the ordering of two lines inside one
    // handler. The fish banked are `endlessScore`, not `fishCollected` - the
    // Golden Fish Bonus doubles what a pickup is worth, and a bonus that paid
    // out in score but not in currency would be worth nothing once score is
    // no longer the thing being chased.
    this.lastRunSummary = {
      distance: this.runDistance,
      fish: this.endlessScore,
      ...this.save.recordRun(this.runDistance, this.endlessScore),
    };

    this.states.transition(GameState.Failed);
  }

  /**
   * The failure beat: a short stretch of slow motion, and then nothing.
   *
   * The fail screen holds. It does not restart itself, and it does not restart
   * on a stray press. Both of those used to happen - a 2.6 s timer, plus "any
   * input past a 0.35 s grace" - on the theory that the "one more go" loop
   * should never stall waiting for a decision. But a run ends with the player's
   * hands still on the controls, so in practice the press that ended one run
   * started the next: a fresh run was already underway before the player had
   * read what killed them, or seen the distance and the fish it was worth. On
   * touch it is worse still, because the swipe that missed the jump is itself
   * an input.
   *
   * Restarting is now only ever something the player asks for - the Retry
   * button, R, or Enter; see `bindInput` and `UIManager`'s `btn-fail-retry`.
   */
  private updateFailure(dt: number): void {
    if (this.slowMoTimer <= 0) return;

    this.slowMoTimer -= dt;
    this.timeScale = this.slowMoTimer > 0 ? FAIL_SLOWMO_SCALE : 1;
  }

  /**
   * The single door into a run - Play, the pause menu's Restart and the fail
   * screen's Retry all come through here.
   *
   * `Poki.startRun` is what makes that worth having: it ends the previous
   * gameplay session, shows an interstitial if one is due (never before the
   * session's first run), and only then calls back to actually start. Because
   * every entry shares the door, an ad can never land mid-run, and no path
   * into gameplay can skip one.
   *
   * `runPending` covers the gap between asking and starting. Without it a
   * second ask - a double-tapped Retry, or R held down - landing before the
   * callback does (which it will, a microtask later, whenever an interstitial
   * is *not* due) starts two runs.
   */
  private enterRun(): void {
    if (this.runPending) return;
    this.runPending = true;
    Poki.startRun(() => {
      this.runPending = false;
      // `startEndless()` is idempotent about tearing down whatever run was
      // already active, so a fresh call is a full restart either way.
      this.startEndless();
    });
  }

  // ==========================================================================
  // Presentation
  // ==========================================================================

  private updateVisuals(dt: number): void {
    // Interpolated, not raw. This is render-rate code, and the fixed step
    // advances in 60 Hz jumps drained from an accumulator - so reading the raw
    // body transform here made the cat lurch and stall against the damped
    // camera every frame that happened to drive a different number of steps.
    // `fixedStep` still reads the raw transform, which is correct there.
    this.player.sampleRenderTransform(_catPos, _catRot);
    this.player.getVelocity(_catVel);

    // The cat leans into its lane change. There is no steer axis any more, so
    // the lean comes from how far it still has to travel to reach its lane.
    const laneError =
      (this.player.lane * PHYSICS.laneSpacing - this.player.lateral) / PHYSICS.laneSpacing;

    this.cat.setInvulnerable(this.invulnTimer > 0);
    this.cat.setActivePowerUps(
      this.powerUps
        .activeTypes()
        .map((type) => ({ type, remainingFrac: this.powerUps.remainingFrac(type) })),
    );
    this.cat.update(dt, {
      position: _catPos,
      rotation: _catRot,
      velocity: _catVel,
      horizontalSpeed: this.player.horizontalSpeed,
      lateralSlip: this.player.isSliding ? this.player.slipSpeed : 0,
      steer: THREE.MathUtils.clamp(laneError, -1, 1),
      grounded: this.player.grounded,
      ducking: this.player.isDucking,
      state: this.player.state,
    });

    if (this.endless) this.updateEndlessCollectibles(dt);

    // Slide dust and its sound both key off the same slip measurement.
    if (this.player.isSliding && this.player.grounded) {
      _forward.copy(_catVel).setY(0).normalize();
      this.particles.slideDust(_catPos, _forward, Math.min(1, this.player.slipSpeed / 8));
      this.audio.setSlideIntensity(Math.min(1, this.player.slipSpeed / 9));
    } else {
      this.audio.setSlideIntensity(0);
    }

    // Threshold sits at cruise speed itself, not below it: at 7 the wind bed
    // was already a third of the way up during ordinary running - which is
    // the entire run, since the runner is always at or near `runSpeed` - so it
    // read as a constant hiss under the game rather than a gust that arrives
    // when the runner is genuinely moving faster than usual.
    const windIntensity = Math.max(
      0,
      (this.player.horizontalSpeed - PHYSICS.runSpeed) / (PHYSICS.runSpeed * 0.3),
    );
    // `setTargetAtTime` throws on a non-finite AudioParam value, which takes
    // the whole frame loop down with it - a defensive last line, not the
    // fix itself, which is keeping `PHYSICS.runSpeed` finite at the source
    // (see `updateDifficultySpeed()`).
    this.audio.setWindIntensity(Number.isFinite(windIntensity) ? windIntensity : 0);

    // Catnip Rush's "you are going faster" half. See CATNIP_FOV_BOOST for why
    // the camera's own speed-derived expansion cannot supply this. Written
    // every frame rather than on the effect's edges: `FollowCamera` eases
    // `currentFov` toward whatever it is handed, so setting and clearing the
    // number is the whole animation, and an effect that ends during a pause
    // or an ad break cannot leave the lens stuck open.
    this.followCamera.boostFov = this.powerUps.isActive('catnipRush')
      ? CATNIP_FOV_BOOST
      : 0;

    const camera = this.followCamera.camera;
    camera.getWorldDirection(_listenerFwd);
    this.audio.setListener(camera.position, _listenerFwd, _listenerUp);
  }

  /**
   * Fish scoring (with the Golden Fish multiplier) and power-up pickups/
   * timers - runs whenever `this.endless` exists, endless run or tutorial
   * level alike (the tutorial just never spawns a power-up to pick up).
   * Split out of `updateVisuals()` rather than inlined, since none of it
   * applies to the campaign and `this.endless` is already known non-null by
   * the one call site.
   */
  private updateEndlessCollectibles(dt: number): void {
    const endless = this.endless;
    if (!endless) return;

    const fishCaught = endless.updateFishVisuals(dt);
    if (fishCaught > 0) {
      this.fishCollected += fishCaught;
      this.endlessScore += fishCaught;
      this.audio.play('fishCollect', { rate: 1.25, gain: 0.5 });
    }

    for (const kind of endless.updatePowerUps(dt)) {
      this.powerUps.activate(kind);
      if (kind === 'nineLives') {
        this.lives = Math.min(this.lives + NINE_LIVES_BONUS, MAX_LIVES);
        this.livesTotal = Math.min(this.livesTotal + NINE_LIVES_BONUS, MAX_LIVES);
        // Nine Lives is instant - there is no "active" window in
        // PowerUpManager to gate an ongoing effect on - so this is a
        // one-shot flourish fired at the moment of pickup, layered on top
        // of the generic burst every type gets below.
        this.particles.embers(_catPos, 12);
      }
      this.audio.play('powerUp');
      this.particles.burst(_catPos, 18, POWERUP_COLOR[kind], 6);
    }

    this.powerUps.update(dt);
    endless.setFishMagnetActive(this.powerUps.isActive('fishMagnet'));

    // Green embers replacing the energy drink's old glow (see
    // `AssetRegistry.loadEnergyDrinkModel`) - a low, fixed rate rather than
    // per-frame, so a still-uncollected pickup reads as gently smouldering
    // rather than constantly fizzing.
    const emberPos = endless.getActiveEnergyDrinkPosition();
    if (emberPos) {
      this.energyDrinkEmberTimer -= dt;
      if (this.energyDrinkEmberTimer <= 0) {
        this.energyDrinkEmberTimer = ENERGY_DRINK_EMBER_INTERVAL;
        this.particles.embers(emberPos, ENERGY_DRINK_EMBER_COUNT, POWERUP_COLOR.catnipRush);
      }
    }

    // Catnip Rush's rainbow trail - a flat ribbon painted on the deck, not
    // particles. Called every frame regardless of `isActive`: emission is
    // gated internally, but ageing/fading never stops, which is the entire
    // mechanism that makes the ribbon shrink away once Catnip Rush ends
    // rather than needing a separate "stop and clear" path. Ground-anchored
    // via `lastGroundY` (see `cameraTarget()`), not the cat's raw position,
    // so a jump never lifts the trail off the roof.
    _catnipTrailPos.set(_catPos.x, this.player.lastGroundY, _catPos.z);
    this.catnipTrail.update(dt, this.powerUps.isActive('catnipRush'), _catnipTrailPos, this.player.grounded);

    this.updatePowerUpGlow(dt);
  }

  /**
   * In-world "something is active" cue: a small glow floats above the cat,
   * coloured to match whichever power-up is active (the most recently
   * picked up, if more than one), plus an occasional sparkle so it reads at
   * a glance rather than only when the player looks straight at it. Both
   * reuse existing, already-cheap systems - `ParticlePool.sparkle()` is the
   * same call `Collectible` already makes every ~0.18s, and the glow is one
   * mesh with its material swapped, not a light or a new render pass.
   */
  private updatePowerUpGlow(dt: number): void {
    const active = this.powerUps.activeTypes();
    this.powerUpGlow.visible = active.length > 0;
    if (active.length === 0) return;

    const kind = active[active.length - 1];
    this.powerUpGlow.material = powerUpMaterials[kind];
    this.powerUpGlow.position.set(_catPos.x, _catPos.y + POWERUP_GLOW_HEIGHT, _catPos.z);
    this.powerUpGlow.rotation.y += dt * POWERUP_GLOW_SPIN_RATE;

    this.powerUpSparkleTimer -= dt;
    if (this.powerUpSparkleTimer <= 0) {
      this.powerUpSparkleTimer = POWERUP_SPARKLE_INTERVAL;
      this.particles.sparkle(this.powerUpGlow.position);
    }
  }

  /**
   * The endless HUD: no chase - real lives, invulnerability and active
   * power-ups. The turn-warning indicator reads `PlayerController`'s
   * `inTurnZone`/`turnDistance`/`turnBuffered` directly.
   */
  private updateHud(): void {
    if (!this.endless) return;

    this.hudState.fishCollected = this.fishCollected;
    this.hudState.distance = this.runDistance;
    this.hudState.tutorialText = null;
    this.hudState.tutorialCue = this.tutorialLevel?.cue ?? null;
    this.hudState.chasePressure = 0;
    this.hudState.lives = this.lives;
    this.hudState.livesTotal = this.livesTotal;
    this.hudState.invulnerable = this.invulnTimer > 0;
    this.hudState.pursuitStage = 0;
    this.hudState.powerUps = this.powerUps
      .activeTypes()
      .map((type) => ({ type, remainingFrac: this.powerUps.remainingFrac(type) }));

    // The warning only means anything while the corner is still ahead. Past it
    // the controller keeps offering a late turn for a few units, but telling
    // the player to turn into a corner they have already overshot is worse than
    // saying nothing. It also drops once the player has booked the turn -
    // carrying on flashing at someone who has already pressed reads as the
    // input not having registered.
    const ahead =
      this.player.inTurnZone &&
      this.player.turnDistance > 0 &&
      this.player.turnBuffered === 0;
    this.hudState.turnWarning = ahead;
    this.hudState.turnProximity = ahead
      ? THREE.MathUtils.clamp(1 - this.player.turnDistance / PHYSICS.turnZoneBefore, 0, 1)
      : 0;
    this.hudState.turnDirection = ahead ? this.player.pendingTurn : 0;

    this.ui.updateHud(this.hudState);
  }

  private trackFps(dt: number): void {
    if (dt <= 0) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
  }

  private buildDebugText(): string {
    const fps =
      this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);

    return [
      `FPS            ${fps.toFixed(0)}`,
      `state          ${this.states.state}`,
      `speed          ${this.player.speed.toFixed(2)}  (h ${this.player.horizontalSpeed.toFixed(2)})`,
      `slip           ${this.player.slipSpeed.toFixed(2)}${this.player.isSliding ? '  SLIDING' : ''}`,
      `grounded       ${this.player.grounded}  d=${this.player.groundDistance.toFixed(2)}`,
      `slope          ${this.player.slopeAngle.toFixed(1)} deg  mu=${this.player.groundFriction.toFixed(2)}`,
      `player state   ${this.player.state}`,
      `lane           ${this.player.lane}  offset ${this.player.lateral.toFixed(2)}` +
        `${this.player.inTurnZone ? `  TURN ${this.player.pendingTurn > 0 ? 'RIGHT' : 'LEFT'}` : ''}`,
      `lives          ${this.lives}${this.invulnTimer > 0 ? `  invuln ${this.invulnTimer.toFixed(1)}s` : ''}`,
      `fall depth     ${this.player.fallDepth.toFixed(2)}`,
      `position       ${_catPos.x.toFixed(1)}, ${_catPos.y.toFixed(1)}, ${_catPos.z.toFixed(1)}`,
      `rotation       ${(_catRot.x).toFixed(2)}, ${(_catRot.y).toFixed(2)}, ${(_catRot.z).toFixed(2)}, ${(_catRot.w).toFixed(2)}`,
      `score          ${this.endlessScore}`,
      `distance       ${this.runDistance.toFixed(1)}m  (best ${this.save.bestDistance.toFixed(0)}m)`,
      `fish banked    ${this.save.fish}`,
      `bodies         ${this.physics.bodyCount}`,
      `particles      ${this.particles.activeCount}`,
      `steps/frame    ${this.physics.stepsLastFrame}`,
    ].join('\n');
  }

  // ==========================================================================
  // WebGL context loss
  // ==========================================================================

  private onContextLost = (event: Event): void => {
    // Preventing the default is what allows the context to be restored at all.
    event.preventDefault();
    this.contextLost = true;
    this.audio.suspend();
    if (this.states.state === GameState.Playing) this.states.transition(GameState.Paused);
    console.warn('[game] WebGL context lost - simulation paused');
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.lastFrameTime = performance.now();
    // A restored context comes back with a default-sized drawing buffer, so
    // the cached size is deliberately invalidated before re-measuring.
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.measureViewport();
    this.audio.resume();
    console.info('[game] WebGL context restored');
  };

  // ==========================================================================

  dispose(): void {
    this.stop();

    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;

    this.teardownRun();
    this.cat.dispose();
    this.catPreview?.dispose();
    this.player.dispose();
    this.particles.dispose();
    this.catnipTrail.dispose();
    this.physics.dispose();

    this.ui.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.save.flush();

    // The coats are registry-owned textures now, not a separate canvas cache,
    // so registry.dispose() already frees every one that was ever worn.
    this.registry.dispose();
    disposeProceduralCache();
    disposeBuildingWindowCache();
    disposeBuildingAssets();
    disposeClotheslineAssets();
    disposeVentPipeAssets();
    disposeFishCoinAssets();

    this.renderer.dispose();
  }
}
