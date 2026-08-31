import { ACESFilmicToneMapping, MathUtils, PCFSoftShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import {
  ATTACK,
  CAMERA,
  CONTACT,
  ENEMY,
  FEINT,
  FLOW,
  GUARD,
  HEALTH,
  HIGHLIGHTS,
  HITSTOP,
  PAUSE_GRACE,
  SCORE,
  TUTORIAL,
  UNLOCKS,
  VFX as VFXCFG,
  type CharacterId,
  DEV,
} from '../config';
import { Loop, type Frame } from '../core/Loop';
import { Rng } from '../core/Rng';
import { loadSave, saveSave } from '../core/Storage';
import { InputManager, type Lane } from '../input/InputManager';
import { Assets, idleGate } from '../assets/Assets';
import { MEASURE, PlatformAdapter, type MeasureKey } from '../platform/PlatformAdapter';
import { AudioEngine } from '../fx/Audio';
import { IMPACT_COLOR, VFX } from '../fx/VFX';
import { Props } from '../fx/Props';
import { HUD } from '../ui/HUD';
import { GameOverScreen, type GameOverData } from '../ui/GameOver';
import { MainMenu, type MenuData } from '../ui/MainMenu';
import { CharacterSelect, type SelectData } from '../ui/CharacterSelect';
import { PauseMenu } from '../ui/PauseMenu';
import { LoadingScreen } from '../ui/Loading';
import { Arena, type WeatherKind } from './Arena';
import type { EnvironmentImpactEvent } from './ArenaImpacts';
import { CameraRig } from './CameraRig';
import { CombatDirector } from './CombatDirector';
import { ComboSystem } from './ComboSystem';
import { FlowMode } from './FlowMode';
import { FlowSystem } from './FlowSystem';
import { MomentLog } from './Highlights';
import { HighlightReel } from './HighlightReel';
import { contactProfileFor, solveContactImpulse, type ContactProfile } from './CombatContact';
import type { Enemy } from './Enemy';
import { Player } from './Player';
import {
  COSMETIC_MODEL_IDS,
  COSMETIC_SLOTS,
  itemsForSlot,
  sanitizeLoadout,
  type CosmeticSlot,
  type Loadout,
} from './Cosmetics';
import { commitDaily, dailiesFor, type Daily } from './Dailies';
import { commitRun, unlockState, type RunStats } from './Progression';
import { phaseIndexFor } from './PatternDirector';
import { MODEL_WEAPONS, setWeaponModelSupplier } from './Weapons';
import { evaluate } from './TimingEvaluator';

type GameState =
  | 'loading'
  | 'menu'
  | 'ready'
  | 'playing'
  | 'flow'
  | 'dying'
  | 'reel'
  | 'gameover'
  | 'paused';

interface PendingPlayerHit {
  target: Enemy;
  profile: ContactProfile;
  moveId: string;
  lane: Lane;
  perfect: boolean;
  guarded: boolean;
  power: number;
}

/**
 * The run loop and every rule that binds the systems together.
 *
 * Ordering inside `update` matters and is deliberate:
 *   input → combat resolution → director → flow → animation → camera → render
 * Resolving input before advancing the director means a press is always graded
 * against the world the player was actually looking at, not the world one frame
 * into the future.
 */
export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly arena: Arena;
  private readonly vfx: VFX;
  private readonly props: Props;
  private readonly player = new Player();
  private readonly combat: CombatDirector;
  private readonly flowMode: FlowMode;
  private readonly flow = new FlowSystem();
  private readonly combo = new ComboSystem();
  private readonly input: InputManager;
  private readonly audio = new AudioEngine();
  private readonly hud: HUD;
  private readonly gameOver: GameOverScreen;
  private readonly menu: MainMenu;
  private readonly select: CharacterSelect;
  private readonly pauseMenu: PauseMenu;
  private readonly loop: Loop;
  private readonly rng = new Rng();
  private readonly assets = new Assets();
  private readonly moments = new MomentLog();
  private readonly reel: HighlightReel;
  private readonly platform = new PlatformAdapter();

  private state: GameState = 'loading';
  private runStart = 0;
  private elapsed = 0;
  private score = 0;
  private hearts: number = HEALTH.hearts;
  private recovery = 0;
  private stats: RunStats = { kills: 0, perfects: 0, flows: 0, score: 0 };
  private selected: CharacterId = 'fox';
  private attackLock = 0;
  private provedLeft = 0;
  private provedRight = 0;
  private flowTutorialActive = false;
  private deathTimer = 0;
  private flashLight = 0;
  private measured = new Set<MeasureKey>();
  private focusX = 0;
  private pendingPlayerHit: PendingPlayerHit | null = null;
  private readonly contactAnchor = new Vector3();

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.arena = new Arena(this.scene);
    this.vfx = new VFX(this.scene);
    this.props = new Props(this.scene);
    this.combat = new CombatDirector(this.scene, this.rng, this.props);
    this.flowMode = new FlowMode(this.scene, this.rng, this.props);
    this.scene.add(this.player.group);

    this.input = new InputManager(canvas);
    this.hud = new HUD(
      ui,
      () => this.toggleMute(),
      () => this.togglePause(),
    );
    this.gameOver = new GameOverScreen(ui);
    this.menu = new MainMenu(ui);
    this.select = new CharacterSelect(ui);
    this.pauseMenu = new PauseMenu(ui);
    this.loading = new LoadingScreen(ui);

    this.reel = new HighlightReel(this.scene, this.rng, this.player, this.vfx, this.rig, this.audio, this.hud, {
      flash: (v) => {
        this.flashLight = Math.max(this.flashLight, v);
      },
      hitStop: (s) => this.loop.hitStop(s),
    },
      this.props,
    );

    this.loop = new Loop((f) => this.update(f));

    this.gameOver.setHandlers(
      () => void this.replay(),
      (id) => void this.selectCharacter(id),
      () => this.showMenu(),
      () => void this.continueRun(),
    );
    this.menu.setHandlers(
      () => void this.playFromMenu(),
      () => this.openCharacterSelect(),
      () => this.toggleMute(),
    );
    this.select.setHandlers({
      onClose: () => this.closeCharacterSelect(),
      onPick: (id) => void this.selectCharacter(id),
      onEquip: (slot, itemId) => this.equip(slot, itemId),
      onRandomize: () => this.randomizeLook(),
      onSpin: (radians) => {
        this.selectSpin += radians;
      },
    });
    this.pauseMenu.setHandlers({
      onResume: () => this.resume(),
      onRestart: () => this.restartFromPause(),
      onQuit: () => this.quitToMenu(),
      onSound: () => this.toggleMute(),
    });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.platform.onAdState((s) => this.onAdState(s));
    this.resize();
  }

  private readonly loading: LoadingScreen;

  /**
   * Boot: essential assets only, then straight into the arena.
   *
   * There is no menu on the path to gameplay. A returning player's ninja is
   * loaded instead of the default, so their first frame is the one they chose.
   */
  async boot(): Promise<void> {
    const save = loadSave();
    this.selected = (UNLOCKS.order as readonly string[]).includes(save.selected)
      ? (save.selected as CharacterId)
      : 'fox';
    this.audio.setMuted(save.muted);
    this.hud.setMuted(save.muted);

    // Poki's SDK init runs alongside asset loading; neither blocks the other.
    const platformReady = this.platform.init();

    let characterProgress = 0;
    let arenaProgress = 0;
    const reportProgress = () =>
      this.loading.setProgress((characterProgress * 0.7 + arenaProgress * 0.3) * 0.98);
    const [asset] = await Promise.all([
      this.assets.boot(this.selected, (r) => {
        characterProgress = r;
        reportProgress();
      }),
      this.arena.load((r) => {
        arenaProgress = r;
        reportProgress();
      }),
    ]);
    this.applyCharacter(asset.id);

    await platformReady;
    // Essential set is playable — Poki is told now, not after the other ninjas.
    this.platform.gameLoadingFinished();

    this.input.attach();
    this.input.setFirstInputHandler(() => this.onFirstInput());
    this.loop.start();
    this.exposeDevHooks();
    this.state = 'ready';

    // A brand-new player never sees a menu: they are dropped straight into the
    // arena, because time-to-gameplay is the number that decides whether a
    // Poki player stays at all. The menu is for the second visit onward, when
    // "which ninja" and "how far to the next one" are real questions.
    const returning = save.runs > 0;
    if (returning) this.showMenu();
    else this.startRun();

    await this.loading.hide();
    if (!returning) this.hud.show();
    if (save.runs > 0 && Date.now() - save.lastPlayed > 6 * 3600_000) this.hud.welcomeBack();

    // Everything else streams in behind live gameplay, one file per idle slot.
    // The small original enemy cast lands first, then its real weapons; both
    // are seen every run, unlike the optional hero catalogue and wardrobe.
    setWeaponModelSupplier((id) => this.assets.weapon(id));
    void this.assets
      .loadEnemies(idleGate)
      .then(() => this.installEnemyModels())
      .then(() => this.assets.loadWeapons(MODEL_WEAPONS, idleGate))
      .then(() => this.assets.loadDeferred(idleGate))
      .then(() => this.refreshFinisherClip())
      .then(() => this.assets.loadCosmetics(COSMETIC_MODEL_IDS, idleGate))
      // A returning player's saved hat was skipped while its model was in
      // flight, so the loadout is worn again once the files are on hand — and
      // the character screen redraws, since its cards had nothing to render.
      .then(() => {
        this.player.setLoadout(this.loadout);
        if (this.select.isVisible) this.select.refresh(this.selectData());
      });
  }

  // ----------------------------------------------------------------- run

  private startRun(): void {
    const save = loadSave();
    this.state = 'playing';
    this.runStart = this.loopTime;
    this.elapsed = 0;
    this.score = 0;
    this.hearts = HEALTH.hearts;
    this.recovery = 0;
    this.attackLock = 0;
    this.deathTimer = 0;
    this.stats = { kills: 0, perfects: 0, flows: 0, score: 0 };
    this.feintsHeld = 0;
    this.continueUsed = false;
    this.committed = null;
    // Last run, not all-time best: a best set weeks ago is a wall, and the
    // score you managed twenty seconds ago is a race.
    this.chaseTarget = save.lastScore;
    this.hud.setChase(this.chaseTarget, 0);
    this.provedLeft = 0;
    this.provedRight = 0;
    this.flowTutorialActive = false;
    this.pendingPlayerHit = null;

    this.combo.reset();
    // A brand-new player's meter starts part-way up so they meet Flow inside
    // their first few seconds. Every later run starts from nothing.
    this.flow.reset(save.runs === 0 ? FLOW.firstRunHead : 0);
    this.props.clear();
    this.moments.reset();
    this.flowMode.abort();
    this.arena.resetDamage();
    // A completed CURRENT lesson skips onboarding. When its content changes,
    // veterans receive the corrected safe lesson once rather than being left
    // with stale instructions forever.
    const currentTutorialSeen = save.tutorialVersion >= TUTORIAL.version;
    this.combat.reset(this.loopTime, currentTutorialSeen);
    this.tutorialDone = currentTutorialSeen;
    this.hud.setTutorialText('');
    if (currentTutorialSeen) {
      this.provedLeft = TUTORIAL.proveCount;
      this.provedRight = TUTORIAL.proveCount;
    }
    this.player.reset();
    this.rig.reset();
    this.loop.setTimeScale(1);

    this.hud.resetScore();
    this.hud.setHealth(this.hearts);
    this.hud.setBest(save.best);
    this.hud.setCombo(0, false);
    this.hud.setFlow(0, false);
    this.hud.setHint(null, '');
    this.audio.setIntensity(0.25);
  }

  private loopTime = 0;
  /** The state a pause interrupted, restored on resume. */
  private pausedFrom: GameState = 'playing';

  // ----------------------------------------------------------------- menu

  private menuData(): MenuData {
    const save = loadSave();
    return {
      best: save.best,
      bestCombo: save.bestCombo,
      runs: save.runs,
      dailies: dailiesFor(save.daily),
      unlock: unlockState(save.mastery),
      selected: this.selected,
      available: (UNLOCKS.order as readonly CharacterId[]).filter((id) => this.assets.isLoaded(id)),
      muted: this.audio.muted,
    };
  }

  /**
   * Opens the menu over the live arena, with the chosen ninja standing in it —
   * so picking a different one swaps the character in front of you rather than
   * showing a portrait of them.
   */
  private showMenu(): void {
    this.state = 'menu';
    // Menus hand the sky back to its own slow cycle — a title screen that sits
    // in whatever weather the last run ended in reads as a bug.
    this.arena.setPhase(null);
    this.gameOver.hide();
    this.select.hide();
    this.pauseMenu.hide();
    this.hud.hide();
    this.hud.setTutorialText('');
    this.hud.setHint(null, '');
    this.input.setEnabled(false);
    this.loop.setTimeScale(1);
    this.cancelPendingPlayerHit();
    this.combat.clearThreats(0);
    this.flowMode.abort();
    this.player.reset();
    this.rig.reset();
    this.rig.setCinematic(false);
    this.hud.setCinematic(false);
    this.audio.setIntensity(0.12);
    this.menuAngle = 0;
    // The menu gets its own camera so the ninja you are choosing is actually
    // on screen: a slow low orbit that frames him under the panel rather than
    // behind it.
    this.rig.setCinematic(true);
    this.menu.show(this.menuData());
  }

  private menuAngle = 0;

  /** Slow orbit around the hero while the menu is open. */
  private updateMenuCamera(dtReal: number): void {
    this.menuAngle += dtReal;
    if (this.select.isVisible) {
      // Closer, and turnable: the character screen is about looking at the
      // ninja, so the drift is small and the player's own drag dominates. The
      // near railing is hidden for the duration — it sits at hip height on this
      // set and crossed the shins from every angle the turntable could reach —
      // which is what lets the camera come in this far.
      const angle = this.selectSpin + Math.sin(this.menuAngle * 0.14) * 0.1;
      const radius = 2.9;
      this.rig.cineShot(
        Math.sin(angle) * radius,
        1.75,
        Math.cos(angle) * radius,
        0,
        0.8,
        0,
      );
      return;
    }
    // A slow sweep ACROSS the front of the dojo, not a full orbit: the arena is
    // built to be seen from the front, and a camera that swings behind it shows
    // the player the back of the set. Looking slightly above the hero drops him
    // into the lower third of the frame, clear of the panel and fully in shot.
    const angle = Math.sin(this.menuAngle * 0.22) * 0.42;
    const radius = 4.9;
    this.rig.cineShot(
      Math.sin(angle) * radius,
      1.42,
      Math.cos(angle) * radius,
      0,
      // Looking higher still than the hero's head, which pushes him further
      // down the frame — the panel grew when the day's goals moved into it.
      2.12,
      0,
    );
  }

  private async playFromMenu(): Promise<void> {
    this.audio.ui();
    this.rig.setCinematic(false);
    this.audio.unlock();
    this.select.hide();
    this.menu.hide();
    // Poki counts an ad break between runs, never in front of the first one.
    if (loadSave().runs > 0) await this.platform.commercialBreak();
    this.startRun();
    this.hud.show();
    this.input.setEnabled(true);
    this.platform.gameplayStart();
  }

  // ---------------------------------------------------------------- pause

  private togglePause(): void {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  private pause(): void {
    if (this.state !== 'playing' && this.state !== 'flow') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.audio.suspend();
    // Poki must not count a paused run as time played.
    this.platform.gameplayStop();
    this.pauseMenu.show(this.audio.muted);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    this.state = this.pausedFrom;
    this.audio.resume();
    this.input.setEnabled(true);
    this.platform.gameplayStart();
    // The schedule is pushed out so the first threat after a pause is readable
    // rather than landing the instant control comes back.
    this.combat.delayTo(this.loopTime + PAUSE_GRACE);
  }

  private restartFromPause(): void {
    this.audio.ui();
    this.rig.setCinematic(false);
    this.pauseMenu.hide();
    this.audio.resume();
    this.startRun();
    this.hud.show();
    this.input.setEnabled(true);
    this.platform.gameplayStart();
  }

  private quitToMenu(): void {
    this.audio.ui();
    this.audio.resume();
    this.showMenu();
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (this.state === 'playing' || this.state === 'flow' || this.state === 'paused') {
      e.preventDefault();
      this.togglePause();
    }
  }

  private async replay(): Promise<void> {
    this.audio.ui();
    this.platform.measure(MEASURE.replayInteract[0], MEASURE.replayInteract[1]);
    this.gameOver.hide();

    // Ads live strictly between runs, never inside combat, and gameplay is
    // already stopped by the death handler before we get here.
    await this.platform.commercialBreak();

    this.startRun();
    this.hud.show();
    this.input.setEnabled(true);
    // Poki counts gameplay from the moment control actually resumes.
    this.platform.gameplayStart();
  }

  /**
   * One rewarded continue per run.
   *
   * It is a second chance at THIS run, not an advantage in it: the run resumes
   * on one heart, at the difficulty it had reached, with the score and combo
   * best intact. Nothing about the fight is made easier for having paid
   * attention to an advert, which is the line between a continue and pay-to-win.
   *
   * Progress up to the first death is already saved, so a player who watches the
   * ad and then closes the tab loses nothing they had earned.
   */
  private async continueRun(): Promise<void> {
    this.audio.ui();
    this.continueUsed = true;
    this.platform.measure(MEASURE.continueInteract[0], MEASURE.continueInteract[1]);

    const rewarded = await this.platform.rewardedBreak();
    if (!rewarded) {
      // No reward earned — the ad was skipped, blocked or unavailable. The
      // offer is spent either way, so the screen simply loses the button
      // rather than pretending it can be tried again.
      this.gameOver.show({ ...this.gameOverData(), canContinue: false });
      return;
    }

    this.gameOver.hide();
    this.state = 'playing';
    this.hearts = 1;
    this.hud.setHealth(this.hearts);
    this.player.reset();
    this.recovery = HEALTH.recovery;
    this.combo.reset();
    this.flow.reset();
    this.cancelPendingPlayerHit();
    this.flowMode.abort();
    this.arena.resetDamage();
    // The schedule is pushed out so the first threat back is readable rather
    // than landing on the frame control returns — the same grace a pause gets.
    this.combat.clearThreats(this.player.worldX);
    this.combat.delayTo(this.loopTime + PAUSE_GRACE);
    this.runStart = this.loopTime - this.elapsed;

    this.hud.show();
    this.input.setEnabled(true);
    this.platform.gameplayStart();
  }

  private async selectCharacter(id: CharacterId): Promise<void> {
    this.audio.ui();
    this.platform.measure(MEASURE.selectorInteract[0], MEASURE.selectorInteract[1]);
    if (!this.assets.isLoaded(id)) await this.assets.loadCharacter(id);
    this.applyCharacter(id);
    saveSave({ selected: id });
    if (this.select.isVisible) this.select.refresh(this.selectData());
    else if (this.menu.isVisible) this.menu.refresh(this.menuData());
    else this.showGameOver();
  }

  private applyCharacter(id: CharacterId): void {
    const asset = this.assets.get(id);
    if (!asset) return;
    const playerModel = asset.scene;
    this.selected = id;
    const idle = asset.clips.find((c) => /idle/i.test(c.name)) ?? null;
    this.player.setCharacter(playerModel, asset.clips, idle);
    // Each ninja keeps its own look, so switching back to one you dressed up
    // returns them wearing it rather than resetting them to the default kit.
    this.loadout = this.loadoutFor(id);
    this.player.setLoadout(this.loadout);
    this.refreshFinisherClip();
  }

  /** Installs the three authored cast members across every pooled fight mode. */
  private installEnemyModels(): void {
    this.combat.setDetailedEnemyModels((index) => this.assets.enemyInstance(index));
    this.flowMode.setDetailedEnemyModels((index) => this.assets.enemyInstance(index + 1));
    this.reel.setDetailedEnemyModels((index) => this.assets.enemyInstance(index + 2));
  }

  // ----------------------------------------------------- character screen

  /** Extra turntable rotation the player dragged in on the character screen. */
  private selectSpin = 0;
  private loadout: Loadout = sanitizeLoadout(null);

  private selectData(): SelectData {
    return {
      selected: this.selected,
      unlock: unlockState(loadSave().mastery),
      available: (UNLOCKS.order as readonly CharacterId[]).filter((id) => this.assets.isLoaded(id)),
      loadout: this.loadout,
    };
  }

  private loadoutFor(id: CharacterId): Loadout {
    return sanitizeLoadout(loadSave().loadouts[id]);
  }

  private openCharacterSelect(): void {
    this.audio.ui();
    this.selectSpin = 0;
    this.menu.hide();
    this.arena.setNearRailVisible(false);
    this.select.show(this.selectData());
  }

  private closeCharacterSelect(): void {
    this.audio.ui();
    this.arena.setNearRailVisible(true);
    this.select.hide();
    this.menu.show(this.menuData());
  }

  /**
   * Equipping is immediate and permanent — no confirm step, no preview mode.
   * The change lands on the ninja standing in front of the player, which is
   * the entire feedback loop the screen exists for.
   */
  private equip(slot: CosmeticSlot, itemId: string): void {
    this.audio.ui();
    this.loadout = sanitizeLoadout({ ...this.loadout, [slot]: itemId });
    this.player.setLoadout(this.loadout);
    const save = loadSave();
    saveSave({ loadouts: { ...save.loadouts, [this.selected]: this.loadout } });
    this.select.refresh(this.selectData());
  }

  /**
   * Rolls a look. Deliberately on Math.random rather than the seeded stream:
   * cosmetics must never be able to reshuffle a run's pattern.
   */
  private randomizeLook(): void {
    this.audio.ui();
    const rolled: Record<string, string> = {};
    for (const slot of COSMETIC_SLOTS) {
      const pool = itemsForSlot(slot);
      rolled[slot] = pool[Math.floor(Math.random() * pool.length)].id;
    }
    this.loadout = sanitizeLoadout(rolled);
    this.player.setLoadout(this.loadout);
    const save = loadSave();
    saveSave({ loadouts: { ...save.loadouts, [this.selected]: this.loadout } });
    this.select.refresh(this.selectData());
  }

  /**
   * The Flow finisher is the one place a 2-3 second authored clip fits, so each
   * ninja finishes with its own signature move from the shared pool.
   */
  private refreshFinisherClip(): void {
    const own = this.assets.get(this.selected);
    const clip =
      own?.clips.find((c) => !/idle|walk|run/i.test(c.name)) ??
      this.assets.findClip(['Judgment', 'Charged', 'Combo', 'Spin', 'Slash']);
    this.player.setFinisherClip(clip ?? null);
  }

  // --------------------------------------------------------------- frame

  private update(frame: Frame): void {
    this.loopTime = frame.time;
    const { dt, dtReal } = frame;
    if (dtReal > 0) this.fps += (1 / dtReal - this.fps) * 0.05;

    if (this.state === 'paused') {
      // Nothing advances behind a pause — not the arena, not the callout
      // timers, not the death reel. The frame is still drawn so the paused
      // world stays visible behind the overlay.
      this.renderer.render(this.scene, this.rig.camera);
      return;
    }

    this.hud.update(dtReal);
    this.audio.update(dtReal);
    this.arena.update(dt);
    this.vfx.update(dt);
    this.props.update(dt);

    if (this.state === 'playing' || this.state === 'flow' || this.state === 'dying') {
      this.elapsed = frame.time - this.runStart;
    }

    if (this.state === 'playing') this.tickCombat(dt, frame.time);
    else if (this.state === 'flow') this.tickFlow(dtReal, frame.time);
    else if (this.state === 'dying') this.tickDying(dt, frame.time);
    else if (this.state === 'reel') this.tickReel(dt, frame.time);

    if (this.state === 'menu') this.updateMenuCamera(dtReal);

    this.player.update(dt);
    this.updateFocus(dtReal);
    this.updateEnvironmentImpacts(dt);
    this.placeActorsOnBridge();
    this.rig.update(dtReal, this.focusX);

    // Impact flash decays on real time so hit-stop holds it at full brightness.
    if (this.flashLight > 0) {
      this.flashLight = Math.max(0, this.flashLight - dtReal * 6);
      this.arena.impactLight.intensity = this.flashLight * 14;
    }

    this.renderer.render(this.scene, this.rig.camera);
  }

  private updateFocus(dtReal: number): void {
    let target = 0;
    if (this.state === 'flow') target = this.flowMode.heroX;
    else if (this.state === 'reel') target = this.reel.focusX;
    else {
      const next = this.combat.nextThreat(this.loopTime);
      if (next) target = next.group.position.x * 0.22;
    }
    this.focusX = MathUtils.damp(this.focusX, target, 6, dtReal);
    // The hero body follows the focus during Flow so dashes read as movement.
    const heroTarget =
      this.state === 'flow'
        ? this.flowMode.heroX
        : this.state === 'reel'
          ? this.reel.heroX
          : 0;
    this.player.group.position.x = MathUtils.damp(
      this.player.group.position.x,
      heroTarget,
      this.state === 'flow' ? 22 : 8,
      dtReal,
    );
  }

  /** Keeps every living actor grounded on the garden model's arched bridge. */
  private placeActorsOnBridge(): void {
    this.player.group.position.y = this.arena.bridgeHeightAt(this.player.group.position.x);
    this.placeEnemiesOnBridge(this.combat.liveThreats);
    this.placeEnemiesOnBridge(this.flowMode.liveEnemies);
    this.placeEnemiesOnBridge(this.reel.liveEnemies);
  }

  private placeEnemiesOnBridge(enemies: readonly Enemy[]): void {
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.state === 'dying') continue;
      enemy.group.position.y = this.arena.bridgeHeightAt(enemy.group.position.x);
    }
  }

  /**
   * Death physics remains owned by each enemy; the arena only reacts when that
   * moving body crosses a landmark's collision time. Keeping this after the
   * enemy updates makes splashes, wood failure and tree recoil land on the
   * exact rendered body position rather than one frame early.
   */
  private updateEnvironmentImpacts(dt: number): void {
    this.updateEnemyEnvironment(this.combat.liveThreats, dt);
    this.updateEnemyEnvironment(this.flowMode.liveEnemies, dt);
    this.updateEnemyEnvironment(this.reel.liveEnemies, dt);
  }

  private updateEnemyEnvironment(enemies: readonly Enemy[], dt: number): void {
    for (const enemy of enemies) {
      const event = this.arena.interactBody(enemy, dt);
      if (event) this.onEnvironmentImpact(event);
    }
  }

  private onEnvironmentImpact(event: EnvironmentImpactEvent): void {
    const strength = MathUtils.clamp(event.energy / 18, 0.25, 1);
    this.arena.impactLight.position.set(event.x, event.y + 0.55, event.z);

    if (event.kind === 'pond') {
      this.audio.splash(strength);
      this.flashLight = Math.max(this.flashLight, 0.16 + strength * 0.08);
      this.rig.addTrauma(0.045 + strength * 0.045);
      this.rig.addImpulse(Math.sign(event.x) || 1, 0.025 + strength * 0.035);
      return;
    }
    if (event.kind === 'bridge') {
      this.audio.woodBreak(strength);
      this.flashLight = Math.max(this.flashLight, 0.3 + strength * 0.18);
      this.rig.addTrauma(0.11 + strength * 0.1);
      this.rig.addImpulse(Math.sign(event.x) || 1, 0.08 + strength * 0.08);
      return;
    }

    this.audio.treeImpact(strength);
    this.flashLight = Math.max(this.flashLight, 0.2 + strength * 0.12);
    this.rig.addTrauma(0.075 + strength * 0.07);
    this.rig.addImpulse(Math.sign(event.x) || 1, 0.045 + strength * 0.055);
  }

  // -------------------------------------------------------------- combat

  private tickCombat(dt: number, now: number): void {
    // Player.update runs after combat resolution, so a limb contact generated
    // on the previous rendered frame is consumed before any new threat logic.
    this.resolvePlayerContacts(now);
    if (this.attackLock > 0) this.attackLock = Math.max(0, this.attackLock - dt);
    if (this.recovery > 0) this.recovery = Math.max(0, this.recovery - dt);

    this.combat.update(dt, now, this.elapsed);
    // The sky walks forward with the difficulty, so a long run visibly goes
    // somewhere instead of holding one afternoon for three minutes.
    this.arena.setPhase(phaseIndexFor(this.elapsed));
    this.updateTutorialHint(now);
    this.trackRunDepth();

    const press = this.input.consume();
    if (press && this.attackLock <= 0) {
      // Convert the real-time press stamp into game time so grading keeps
      // sub-frame accuracy instead of quantising to the frame boundary.
      const pressTime = now - press.ageSeconds * this.loop.timeScale;
      this.resolveSwing(press.lane, pressTime);
    } else if (press) {
      // Committed: the press is dropped rather than queued, so mashing during
      // recovery buys nothing.
      this.hud.flashZone(press.lane);
    }

    const overdue = this.combat.findOverdue(now);
    if (overdue) this.onThreatLands(overdue);

    for (const held of this.combat.collectHeldFeints(now)) this.onFeintHeld(held);

    // Flow arms itself the instant the meter fills. No third button, and no
    // waiting for a clean field — the live threats are swept up by the
    // activation, which is part of the payoff.
    if (this.flow.isFull && !this.pendingPlayerHit) this.enterFlow(now);
  }

  private resolveSwing(lane: Lane, pressTime: number): void {
    this.hud.flashZone(lane);
    const target = this.combat.findTarget(lane, pressTime);
    const result = evaluate(pressTime, target ? target.impactAt : null);

    if (!target || result.quality === 'whiff' || result.quality === 'late') {
      this.onWhiff(lane);
      return;
    }

    const perfect = result.quality === 'perfect';

    // A guarded enemy eats the strike on its plate. The hit still counts — the
    // combo carries, Flow builds, the score ticks — but the enemy is knocked
    // back and comes again, so beating it costs a second read rather than a
    // second button press.
    if (target.guarded) {
      this.onGuardBreak(target, lane, perfect, pressTime);
      return;
    }

    this.attackLock = ATTACK.total;
    // A Perfect earns one of the showy moves, so the reward for good timing is
    // visible in the hero's body, not just in the score.
    this.player.attack(lane, true, false, perfect ? 'flashy' : undefined);
    this.audio.swing();
    this.armPlayerContact(target, lane, perfect, false);
  }

  /** A strike stopped by a plate: progress, but not a kill. */
  private onGuardBreak(target: Enemy, lane: Lane, perfect: boolean, _now: number): void {
    this.attackLock = ATTACK.total;
    this.player.attack(lane, true, false, perfect ? 'flashy' : undefined);
    this.audio.swing();
    this.armPlayerContact(target, lane, perfect, true);
  }

  /** Reserves the accepted target until the selected move reaches contact. */
  private armPlayerContact(target: Enemy, lane: Lane, perfect: boolean, guarded: boolean): void {
    const move = this.player.currentMove;
    const profile = contactProfileFor(move);
    target.contactPoint(profile.targetHeight, this.contactAnchor);
    this.player.setContactTarget(this.contactAnchor, CONTACT.bodyRadius);
    if (!target.reserveContact()) return;
    this.pendingPlayerHit = {
      target,
      profile,
      moveId: move.id,
      lane,
      perfect,
      guarded,
      power: (perfect ? 1.35 : 1) * (target.rare ? 1.3 : 1),
    };
  }

  /** Resolves damage and feedback at the animated hand/foot/blade contact. */
  private resolvePlayerContacts(now: number): void {
    for (const contact of this.player.drainContacts()) {
      const pending = this.pendingPlayerHit;
      if (!pending || contact.moveId !== pending.moveId) continue;
      this.pendingPlayerHit = null;
      const impulse = solveContactImpulse(
        pending.profile,
        contact,
        this.player.worldX,
        pending.target.group.position.x,
        pending.power,
      );
      this.player.applyContactRecoil(impulse);
      if (pending.guarded) this.resolveGuardContact(pending, contact.point.x, contact.point.y, now, impulse);
      else this.resolveBodyContact(pending, contact.point.x, contact.point.y, impulse);
    }
  }

  private resolveBodyContact(
    pending: PendingPlayerHit,
    contactX: number,
    contactY: number,
    impulse: ReturnType<typeof solveContactImpulse>,
  ): void {
    const { target, lane, perfect, profile, power } = pending;
    target.killFromContact(impulse, profile.reaction, power);

    const milestone = this.combo.hit();
    const gained = this.flow.onHit(perfect ? 'perfect' : 'good', this.combo.multiplier);
    const base = perfect ? SCORE.perfect : SCORE.good;
    const bonus = target.rare ? SCORE.rareBonus : 0;
    const earned = Math.round((base + bonus) * this.combo.multiplier);
    this.addScore(earned);

    this.stats.kills += 1;
    if (perfect) this.stats.perfects += 1;
    if (target.rare && !loadSave().seenRareTip) {
      saveSave({ seenRareTip: true });
      this.hud.setTutorialText('');
    }
    this.moments.add({
      kind: target.rare ? 'rare' : perfect ? 'perfect' : 'good',
      side: target.side,
      combo: this.combo.count,
      at: this.elapsed,
    });
    this.combat.consumeTutorialThreat();
    if (lane === 'left') this.provedLeft += 1;
    else this.provedRight += 1;

    const color = target.rare ? IMPACT_COLOR.rare : perfect ? IMPACT_COLOR.perfect : IMPACT_COLOR.good;
    const intensity = perfect ? VFXCFG.slashScale.perfect : VFXCFG.slashScale.good;
    this.vfx.impact(contactX, contactY, intensity, color);
    this.flashLight = perfect ? VFXCFG.flash.perfect : VFXCFG.flash.good;

    // Freeze, camera punch and sound now share the exact frame the bodies do.
    this.loop.hitStop((perfect ? HITSTOP.perfect : HITSTOP.good) * this.comboWeight);
    this.rig.addTrauma(perfect ? CAMERA.trauma.perfect : CAMERA.trauma.good);
    this.rig.addImpulse(Math.sign(impulse.linear.x), perfect ? CAMERA.punch.perfect : CAMERA.punch.good);

    if (target.rare) this.audio.hitRare();
    else if (perfect) this.audio.hitPerfect();
    else this.audio.hitGood();

    this.hud.setCombo(this.combo.count, true);
    this.hud.setFlow(this.flow.ratio, gained > 0);
    this.hud.callout(
      perfect ? (this.combo.count >= 3 ? `PERFECT ×${this.combo.count}` : 'PERFECT!') : 'GOOD',
      perfect ? 'perfect' : 'good',
      lane === 'left' ? 0.3 : 0.7,
      earned,
    );

    if (perfect) this.measureOnce('firstPerfect');
    if (milestone) this.onMilestone(milestone);
    this.audio.setIntensity(0.25 + this.flow.ratio * 0.45);
  }

  private resolveGuardContact(
    pending: PendingPlayerHit,
    contactX: number,
    contactY: number,
    now: number,
    impulse: ReturnType<typeof solveContactImpulse>,
  ): void {
    const { target, lane } = pending;
    this.combat.breakGuard(target, now, this.player.worldX, impulse);
    if (!loadSave().seenGuardTip) {
      saveSave({ seenGuardTip: true });
      this.hud.setTutorialText('');
    }

    const milestone = this.combo.hit();
    // A break is progress, not a kill: it carries the combo and gives a little
    // Flow, but never a full hit's worth. Guards would otherwise accelerate
    // Flow — and Flow's invulnerability — faster than fighting normally does.
    this.flow.boost(GUARD.flowGain);
    const earned = Math.round(GUARD.breakScore * this.combo.multiplier);
    this.addScore(earned);

    this.vfx.impact(contactX, contactY, VFXCFG.slashScale.good * 0.9, IMPACT_COLOR.guard);
    this.vfx.sparkBurst(contactX, contactY, IMPACT_COLOR.guard);
    this.flashLight = VFXCFG.flash.good;
    this.loop.hitStop(HITSTOP.good);
    this.rig.addTrauma(CAMERA.trauma.good);
    this.rig.addImpulse(-Math.sign(target.group.position.x), CAMERA.punch.good);
    this.audio.guardBreak();

    this.hud.setCombo(this.combo.count, true);
    this.hud.setFlow(this.flow.ratio, true);
    this.hud.callout(
      target.guarded ? 'GUARD!' : 'GUARD BROKEN',
      'good',
      lane === 'left' ? 0.3 : 0.7,
      earned,
    );
    this.measureOnce('firstGuardBreak');
    if (milestone) this.onMilestone(milestone);
  }

  /** Releases a reserved body if another state interrupts the contact window. */
  private cancelPendingPlayerHit(): void {
    if (this.pendingPlayerHit) this.pendingPlayerHit.target.retire();
    this.pendingPlayerHit = null;
    this.player.drainContacts();
  }

  /** Hit-stop multiplier from the live combo — 1 at the start of a chain. */
  private get comboWeight(): number {
    const t = Math.min(1, this.combo.count / HITSTOP.comboScaleAt);
    return 1 + (HITSTOP.comboScaleMax - 1) * t;
  }

  private onWhiff(lane: Lane): void {
    // A whiff is a real commitment: full animation, slower recovery, combo
    // reduced. This is the mechanic that makes reading beat mashing.
    this.attackLock = ATTACK.total * ATTACK.whiffRecoveryScale;
    this.player.attack(lane, false, false);
    this.audio.whiff();
    this.combo.break();
    this.flow.onHit('whiff', 1);
    this.hud.setCombo(0, false);
    this.hud.setFlow(this.flow.ratio, false);
    this.hud.callout('MISS', 'miss', lane === 'left' ? 0.3 : 0.7);
  }

  /**
   * A feint that was allowed to pull up short.
   *
   * Paid in Flow and points, but never in combo: a combo is a run of connected
   * strikes and holding is not one. It keeps the combo alive rather than
   * extending it, which is the honest reading of what the player just did.
   */
  private onFeintHeld(enemy: Enemy): void {
    const lane: Lane = enemy.side === 'L' ? 'left' : 'right';
    if (!loadSave().seenFeintTip) {
      saveSave({ seenFeintTip: true });
      this.hud.setTutorialText('');
    }
    this.feintsHeld += 1;
    this.flow.boost(FEINT.flowGain);
    const earned = Math.round(FEINT.score * this.combo.multiplier);
    this.addScore(earned);
    this.hud.setFlow(this.flow.ratio, true);
    this.hud.callout('HELD', 'good', lane === 'left' ? 0.3 : 0.7, earned);
    this.audio.ui();
  }

  private onThreatLands(enemy: Enemy): void {
    this.cancelPendingPlayerHit();
    const lane: Lane = enemy.side === 'L' ? 'left' : 'right';
    const x = enemy.group.position.x;
    const missedGuard = enemy.guarded;
    const missedRare = enemy.rare;
    this.combat.rearmAfterLanding(enemy, this.loopTime, this.player.worldX);

    if (missedGuard && !loadSave().seenGuardTip) saveSave({ seenGuardTip: true });
    if (missedRare && !loadSave().seenRareTip) saveSave({ seenRareTip: true });

    // Tutorial safety: the first threats stage a dramatic block instead of
    // taking a heart, so nobody can lose before they understand the mapping.
    // Health only becomes real once BOTH sides have been demonstrated — a
    // player who walks away mid-tutorial comes back alive, not dead.
    const unproven = !this.tutorialDone && (this.provedLeft === 0 || this.provedRight === 0);
    const safe = this.combat.tutorialThreatsLeft > 0 || unproven || this.recovery > 0;
    this.combat.consumeTutorialThreat();

    if (safe) {
      this.player.hurt(lane);
      this.vfx.impact(x * 0.5, 1.15, 1.1, IMPACT_COLOR.good);
      this.rig.addTrauma(CAMERA.trauma.good);
      this.audio.whiff();
      this.hud.callout('BLOCK!', 'good', lane === 'left' ? 0.3 : 0.7);
      this.combo.break();
      this.hud.setCombo(0, false);
      return;
    }

    this.hearts -= 1;
    this.recovery = HEALTH.recovery;
    this.combo.break();
    this.flow.onDamage();
    this.player.hurt(lane);

    this.vfx.impact(x * 0.5, 1.2, 1.3, IMPACT_COLOR.damage);
    this.flashLight = VFXCFG.flash.good;
    this.loop.hitStop(HITSTOP.playerHit);
    this.rig.addTrauma(CAMERA.trauma.damage);
    this.rig.addImpulse(-Math.sign(x), CAMERA.punch.perfect);
    this.audio.hurt();

    this.hud.setHealth(this.hearts);
    this.hud.setCombo(0, false);
    this.hud.setFlow(this.flow.ratio, false);
    this.audio.setIntensity(0.2);

    if (this.hearts <= 0) this.die();
  }

  // ----------------------------------------------------------------- flow

  private enterFlow(now: number): void {
    this.cancelPendingPlayerHit();
    this.state = 'flow';
    this.combat.clearThreats(this.player.worldX);
    this.flowMode.start(this.player.worldX, now);
    this.loop.setTimeScale(FLOW.timeScale);
    this.rig.setFlow(true);
    this.arena.setFlowEmphasis(1);
    this.audio.flowActivate();
    this.audio.setIntensity(1);
    this.hud.banner('FLOW');
    this.flowTutorialActive = !loadSave().seenFlowTip;
    if (this.flowTutorialActive) {
      this.hud.setTutorialText('FLOW: FOLLOW THE GLOW — ONE QUICK PRESS EACH');
    }
    this.hud.setHint(null, '');
    this.vfx.shockwave(this.player.worldX, 1, 2.4, IMPACT_COLOR.flow);
    this.rig.addTrauma(CAMERA.trauma.good);
    this.measureOnce('firstFlow');
  }

  private tickFlow(dtReal: number, now: number): void {
    const press = this.input.consume();
    if (press) {
      this.hud.flashZone(press.lane);
      if (!this.flowMode.press(press.lane) && this.flowMode.acceptsInput) {
        // Nothing to resolve yet — swallow rather than penalise.
      }
    }

    this.flowMode.update(dtReal, now);

    // Flow asks for a direction under a tightening clock, so the direction it
    // wants is shown, not implied: the lane zone lights up, the hero squares up
    // to the target, and the target itself is lit in the scene. Without all
    // three the chain is a coin flip, which is the opposite of a reward.
    const side = this.flowMode.currentSide;
    const lane: Lane | null = side === null ? null : side === 'L' ? 'left' : 'right';
    this.hud.setHint(lane, lane === null ? '' : lane === 'left' ? '←' : '→');
    this.player.look(lane);

    for (const ev of this.flowMode.drain()) {
      switch (ev.type) {
        case 'hit': {
          const x = ev.x ?? 0;
          this.player.attack((ev.lane ?? 'left') as Lane, true, true);
          this.vfx.dashTrail(this.flowMode.lastDashFrom, x, 1);
          this.vfx.impact(x, ev.y ?? 1, VFXCFG.slashScale.flow, IMPACT_COLOR.flow);
          this.loop.hitStop(HITSTOP.flowHit);
          this.rig.addTrauma(CAMERA.trauma.good);
          this.rig.addImpulse(Math.sign(x), CAMERA.punch.good);
          this.flashLight = VFXCFG.flash.good;
          this.audio.flowDash();
          this.audio.flowHit();
          const flowEarned = Math.round(FLOW.scorePerHit * this.combo.multiplier);
          this.addScore(flowEarned);
          this.combo.hit();
          this.hud.setCombo(this.combo.count, true);
          // Gain only, no grade: a Flow chain fires every few hundred
          // milliseconds and a word on each one would be noise. The number
          // climbing beside each cut is the whole reward.
          this.hud.callout('', 'flow', x < 0 ? 0.32 : 0.68, flowEarned);
          if (this.flowTutorialActive) {
            this.flowTutorialActive = false;
            saveSave({ seenFlowTip: true });
            this.hud.setTutorialText('');
          }
          break;
        }
        case 'finisherReady':
          this.hud.callout('FINISH!', 'flow');
          break;
        case 'finisherHit': {
          const x = ev.x ?? 0;
          this.player.finisher((ev.lane ?? 'left') as Lane, FLOW.finisherWindup);
          this.vfx.dashTrail(this.flowMode.lastDashFrom, x, 1);
          this.vfx.impact(x, 1.2, VFXCFG.slashScale.finisher, IMPACT_COLOR.finisher);
          this.vfx.shockwave(x, 1.1, 3.4, IMPACT_COLOR.finisher);
          this.loop.hitStop(HITSTOP.finisher);
          this.rig.addTrauma(CAMERA.trauma.finisher);
          this.rig.addImpulse(Math.sign(x), CAMERA.punch.finisher);
          this.flashLight = VFXCFG.flash.finisher;
          this.audio.finisher();
          this.addScore(Math.round(FLOW.finisherScore * this.combo.multiplier));
          this.hud.callout(
            'FINISHER',
            'flow',
            x < 0 ? 0.32 : 0.68,
            Math.round(FLOW.finisherScore * this.combo.multiplier),
          );
          this.moments.add({
            kind: 'finisher',
            side: (ev.lane ?? 'left') === 'left' ? 'L' : 'R',
            combo: this.combo.count,
            at: this.elapsed,
          });
          break;
        }
        case 'miss':
          this.hud.callout('FLOW BROKEN', 'miss');
          this.audio.whiff();
          break;
        case 'end':
          this.exitFlow(now, ev.completed === true);
          break;
        default:
          break;
      }
    }
  }

  private exitFlow(now: number, completed: boolean): void {
    this.flow.consume(completed);
    if (completed) {
      this.stats.flows += 1;
      this.measureOnce('firstFlowComplete');
      this.hud.banner('FLOW COMPLETE');
    }
    this.state = 'playing';
    this.loop.setTimeScale(1);
    this.rig.setFlow(false);
    this.arena.setFlowEmphasis(0);
    this.player.look(null);
    this.hud.setHint(null, '');
    this.flowTutorialActive = false;
    this.hud.setTutorialText('');
    this.audio.setIntensity(0.35);
    this.hud.setFlow(0, false);
    this.player.reset();
    // Guarantee a readable first threat after the cinematic camera settles.
    this.combat.delayTo(now + FLOW.recoverPause);
  }

  // ---------------------------------------------------------------- death

  private die(): void {
    this.cancelPendingPlayerHit();
    this.state = 'dying';
    this.deathTimer = 0;
    this.player.ko();
    this.input.setEnabled(false);
    this.loop.setTimeScale(0.35);
    this.audio.ko();
    this.audio.setIntensity(0);
    this.combat.clearThreats(this.player.worldX);
    this.flowMode.abort();
    this.rig.addTrauma(CAMERA.trauma.finisher);
    // Poki must see gameplay stop before the result UI appears.
    this.platform.gameplayStop();
  }

  private tickDying(dt: number, now: number): void {
    this.deathTimer += dt;
    this.combat.update(dt, now, this.elapsed);
    if (this.deathTimer > 0.42) {
      this.loop.setTimeScale(1);
      this.commitRunStats();
      const picked = HIGHLIGHTS.enabled ? this.moments.pick() : [];
      if (picked.length > 0) this.startReel(picked, now);
      else this.presentGameOver();
    }
  }

  /**
   * The death reel: the run's best moments, re-enacted from the event log in
   * slow motion under the cinematic camera. Driven entirely by what the player
   * actually did — hit qualities, sides and combo counts were recorded live.
   * Any input skips it, and short runs with nothing worth showing go straight
   * to the results screen.
   */
  private startReel(picked: import('./Highlights').Moment[], now: number): void {
    this.state = 'reel';
    this.player.reset();
    this.rig.setCinematic(true);
    this.hud.setCinematic(true);
    this.reel.start(picked, now);
    this.loop.setTimeScale(HIGHLIGHTS.timeScale);
    this.input.setEnabled(true);
    this.hud.setTutorialText('TAP TO SKIP');
  }

  private tickReel(dt: number, now: number): void {
    const skip = this.input.consume() !== null;
    if (this.reel.update(dt, now, skip)) {
      this.rig.setCinematic(false);
      this.hud.setCinematic(false);
      this.loop.setTimeScale(1);
      this.input.setEnabled(false);
      this.hud.setTutorialText('');
      this.presentGameOver();
    } else {
      // The reel owns the speed ramp — approach brisk, aftermath slow-mo.
      this.loop.setTimeScale(this.reel.desiredTimeScale);
    }
  }

  private commitRunStats(): void {
    const save = loadSave();
    const previousBest = save.best;
    this.addScore(Math.round(this.elapsed * SCORE.survivalPerSecond));
    this.stats.score = this.score;

    // Only what has happened since the last commit. On a run that never used
    // its continue this is the whole run; on one that did, the first death
    // already banked everything up to that point.
    const prior = this.committed ?? { kills: 0, perfects: 0, flows: 0, score: 0, held: 0 };
    const delta: RunStats = {
      kills: this.stats.kills - prior.kills,
      perfects: this.stats.perfects - prior.perfects,
      flows: this.stats.flows - prior.flows,
      score: this.stats.score - prior.score,
    };

    // Today's goals are folded in BEFORE the run is committed, so the Mastery
    // they pay lands in the same unlock check as the run's own — finishing a
    // goal and a ninja on the same run reads as one event, not two. Counters
    // take the delta; a personal best within the run takes the real figure.
    const daily = commitDaily(save.daily, {
      ...delta,
      score: this.stats.score,
      bestCombo: this.combo.best,
      held: this.feintsHeld - prior.held,
    });
    saveSave({ daily: daily.state });

    const { state, newlyUnlocked } = commitRun(delta, daily.mastery, {
      countRun: this.committed === null,
      bestScore: this.stats.score,
    });
    this.committed = {
      kills: this.stats.kills,
      perfects: this.stats.perfects,
      flows: this.stats.flows,
      score: this.stats.score,
      held: this.feintsHeld,
    };
    this.completedDailies = daily.completed;
    saveSave({
      bestCombo: Math.max(save.bestCombo, this.combo.best),
      // The score to beat on the next run. Written even on a bad run: chasing
      // your last attempt is the point, not chasing your best.
      lastScore: this.score,
    });

    if (newlyUnlocked.length > 0) {
      this.audio.unlockJingle();
      if (newlyUnlocked.includes('cat')) this.platform.measure(MEASURE.secondNinja[0], MEASURE.secondNinja[1]);
      // Preload anything just unlocked so the selector is instantly usable.
      for (const id of newlyUnlocked) void this.assets.loadCharacter(id);
    }

    this.pendingUnlocks = newlyUnlocked;
    this.pendingPrevBest = previousBest;
    this.pendingState = state;
  }

  private presentGameOver(): void {
    this.state = 'gameover';
    this.hud.hide();
    this.showGameOver();
    this.platform.measure(MEASURE.replayVisible[0], MEASURE.replayVisible[1]);
  }

  private pendingUnlocks: CharacterId[] = [];
  private completedDailies: Daily[] = [];
  /** Feints correctly left alone this run; feeds the daily goal. */
  private feintsHeld = 0;
  /** True once this run has spent its one rewarded continue. */
  private continueUsed = false;
  /** What was already committed for this run; see Progression.CommitOptions. */
  private committed: { kills: number; perfects: number; flows: number; score: number; held: number } | null =
    null;
  private pendingPrevBest = 0;
  private pendingState = unlockState(0);

  private showGameOver(): void {
    this.gameOver.show(this.gameOverData());
  }

  private gameOverData(): GameOverData {
    const save = loadSave();
    return {
      score: this.score,
      best: save.best,
      previousBest: this.pendingPrevBest,
      maxCombo: this.combo.best,
      flowChains: this.flow.chains,
      unlock: this.pendingState,
      newlyUnlocked: this.pendingUnlocks,
      completedDailies: this.completedDailies,
      canContinue: !this.continueUsed && this.platform.canReward,
      selected: this.selected,
      available: (UNLOCKS.order as readonly CharacterId[]).filter((id) => this.assets.isLoaded(id)),
    };
  }

  // ------------------------------------------------------------ tutorial

  /**
   * Core controls are taught under safe threats; later mechanics explain
   * themselves contextually the first time they actually appear.
   */
  private updateTutorialHint(now: number): void {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const next = this.combat.nextThreat(now);

    if (this.tutorialDone) {
      const save = loadSave();
      if (next?.feint && !save.seenFeintTip) {
        // Ahead of the others: a feint punishes the reflex the whole rest of
        // the game rewards, so it is the one mechanic that must never be
        // discovered by being caught out.
        this.hud.setTutorialText('UNARMED IN WHITE: DON’T SWING — LET IT COME AND GO');
      } else if (next?.guarded && !save.seenGuardTip) {
        this.hud.setTutorialText('ARMORED: BREAK THE PLATE — THEN TIME THE FOLLOW-UP');
      } else if (next?.rare && !save.seenRareTip) {
        this.hud.setTutorialText('GOLD ENEMY: BONUS SCORE — SAME PERFECT TIMING');
      } else {
        this.hud.setTutorialText('');
      }
      return;
    }

    let text = '';
    if (this.provedLeft === 0 || this.provedRight === 0) {
      // The direction prompt follows the threat actually on screen, so a missed
      // first enemy can never leave the text pointing at an empty lane.
      const side = next?.side ?? 'L';
      const firstSide = this.provedLeft === 0 && this.provedRight === 0;
      if (side === 'L') text = touch ? 'TAP LEFT JUST BEFORE THEIR HIT LANDS' : 'PRESS ← JUST BEFORE THEIR HIT LANDS';
      else if (firstSide) text = touch ? 'TAP RIGHT JUST BEFORE THEIR HIT LANDS' : 'PRESS → JUST BEFORE THEIR HIT LANDS';
      else text = touch ? 'NOW TAP RIGHT AT THE LAST SECOND' : 'NOW PRESS → AT THE LAST SECOND';
      if (side === 'L' && this.provedLeft > 0) text = touch ? 'NOW TAP LEFT AT THE LAST SECOND' : 'NOW PRESS ← AT THE LAST SECOND';
    } else if (this.combat.tutorialThreatsLeft > 0) {
      text = this.stats.perfects > 0
        ? 'PERFECT! LAST-SECOND HITS CHARGE FLOW FASTER'
        : 'STRIKE JUST AS THEIR ATTACK IS ABOUT TO CONNECT';
    } else {
      // Tutorial complete: one GO!, remember it, never show any of this again.
      this.tutorialDone = true;
      this.hud.setTutorialText('');
      this.hud.setHint(null, '');
      this.hud.banner('GO!');
      this.audio.ui();
      this.measureOnce('tutorialTiming');
      saveSave({ seenTutorial: true, tutorialVersion: TUTORIAL.version });
      return;
    }
    this.hud.setTutorialText(text);
    if (this.provedLeft >= 1) this.measureOnce('tutorialLeft');
    if (this.provedRight >= 1) this.measureOnce('tutorialRight');

    // The directional pulse starts shortly before impact. It teaches which
    // side is dangerous without turning the exact Perfect frame into a visual
    // quick-time prompt.
    const untilImpact = next ? next.impactAt - now : Infinity;
    if (next && untilImpact < 0.72 && this.combat.tutorialThreatsLeft > 0) {
      const lane: Lane = next.side === 'L' ? 'left' : 'right';
      this.hud.setHint(lane, lane === 'left' ? '←' : '→');
    } else {
      this.hud.setHint(null, '');
    }
  }

  private tutorialDone = false;

  private onMilestone(count: number): void {
    this.hud.banner(`${count} COMBO`);
    this.vfx.shockwave(this.player.worldX, 1.4, 1.6, IMPACT_COLOR.perfect);
    this.audio.hitRare();
    if (count === 10) this.measureOnce('firstCombo10');
  }

  private trackRunDepth(): void {
    if (this.elapsed >= 180) this.measureOnce('run180');
    else if (this.elapsed >= 120) this.measureOnce('run120');
    else if (this.elapsed >= 60) this.measureOnce('run60');
    else if (this.elapsed >= 30) this.measureOnce('run30');
  }

  // ------------------------------------------------------------- plumbing

  /** Previous run's score, chased on the HUD; 0 once it has been passed. */
  private chaseTarget = 0;

  private addScore(amount: number): void {
    this.score += amount;
    this.hud.setScore(this.score);
    if (this.chaseTarget > 0 && this.score >= this.chaseTarget) {
      this.chaseTarget = 0;
      this.hud.chasePassed();
    }
  }

  private measureOnce(key: MeasureKey): void {
    if (this.measured.has(key)) return;
    this.measured.add(key);
    const [category, action] = MEASURE[key];
    this.platform.measure(category, action);
  }

  private onFirstInput(): void {
    this.audio.unlock();
    // Poki counts gameplay from a real interaction, never from page load — but
    // a tap on the menu is not gameplay starting, so the run must already be
    // live before this reports anything.
    if (this.state === 'playing' || this.state === 'flow') {
      this.platform.gameplayStart();
      this.input.setEnabled(true);
    }
  }

  private toggleMute(): void {
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.hud.setMuted(muted);
    this.menu.setMuted(muted);
    this.pauseMenu.setMuted(muted);
    saveSave({ muted });
  }

  private onAdState(state: 'none' | 'playing'): void {
    if (state === 'playing') {
      this.audio.suspend();
      this.input.setEnabled(false);
    } else {
      // A run paused behind an ad stays paused: control returns only to a run
      // that was actually live.
      if (this.state !== 'paused') this.audio.resume();
      this.input.setEnabled(this.state === 'playing' || this.state === 'flow');
    }
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.audio.suspend();
      // A backgrounded tab is an interruption; Poki wants gameplay stopped, and
      // a live run is paused outright rather than continuing unwatched.
      if (this.state === 'playing' || this.state === 'flow') this.pause();
    } else if (this.state !== 'paused') {
      this.audio.resume();
      if (this.state === 'playing' || this.state === 'flow') this.platform.gameplayStart();
    }
  }

  /**
   * Development-only inspection handle.
   *
   * Gated on import.meta.env.DEV so it is dead-code-eliminated from the
   * production bundle entirely — there is no debug panel, no cheat hook and no
   * developer overlay in a shipped build. It exists so automated playthroughs
   * can grade the first minute without a human at the keyboard.
   */
  private exposeDevHooks(): void {
    if (!DEV) return;
    (window as unknown as { __ninjaflow?: unknown }).__ninjaflow = {
      snapshot: () => ({
        state: this.state,
        elapsed: this.elapsed,
        score: this.score,
        hearts: this.hearts,
        combo: this.combo.count,
        flow: this.flow.ratio,
        flowPhase: this.flowMode.phase,
        flowSide: this.flowMode.currentSide,
        flowUrgency: this.flowMode.urgency,
        flowHits: this.flowMode.hitCount,
        flowLen: this.flowMode.chainLength,
        chains: this.flow.chains,
        now: this.loopTime,
        next: (() => {
          const t = this.combat.nextThreat(this.loopTime);
          return t ? { side: t.side, impactAt: t.impactAt, rare: t.rare, guard: t.guard } : null;
        })(),
        fps: this.fps,
        move: this.player.currentMove.id,
        blades: this.vfx.bladesInFlight,
        props: this.props.activeCount,
        weather: this.arena.weather,
        sky: this.arena.skyDebug,
        environment: this.arena.impactDebug,
        reel: this.state === 'reel' ? this.reel.debug : null,
      }),
      bone: (name: string) => this.player.boneFor(name as never),
      press: (lane: Lane) => this.devPress(lane),
      weather: (kind: WeatherKind) => this.arena.setWeather(kind),
      splash: () => this.arena.previewSplash(0, 1.55, 13),
      step: (seconds: number) => {
        // Deterministic stepping for scripted playthroughs in hidden tabs.
        const dt = 1 / 60;
        for (let t = 0; t < seconds; t += dt) this.loop.step(dt);
      },
      menu: () => this.showMenu(),
      characters: () => this.openCharacterSelect(),
      equip: (slot: string, id: string) => this.equip(slot as CosmeticSlot, id),
      loadout: () => ({ ...this.loadout }),
      fit: () => this.player.wardrobeDebug,
      mounts: () => this.player.wardrobeMounts,
      restart: () => {
        this.gameOver.hide();
        this.select.hide();
        this.menu.hide();
        this.startRun();
        this.hud.show();
        this.input.setEnabled(true);
      },
    };
  }

  /** Injects a press through the same path a real key takes. */
  private devPress(lane: Lane): void {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: lane === 'left' ? 'ArrowLeft' : 'ArrowRight' }),
    );
  }

  private fps = 0;

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }
}

void ENEMY;
