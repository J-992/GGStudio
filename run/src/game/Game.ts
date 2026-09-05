import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  FIXED_DT, MAX_FRAME_DT, KILL_DIST, MAX_AIR_TIME,
  HALF, ROT_COOLDOWN, PLAYER_HALF_H, PLAYER_HALF_W, SLICE_LEN,
  P1_COLOR, P2_COLOR, TETHER_REST, SCREEN_KILL_GRACE, FORWARD_SPEED,
} from "./Constants";
import { InputManager } from "../input/InputManager";
import { touchState } from "../input/touchState";
import { UI } from "../ui/UI";
import { Effects } from "../effects/Effects";
import { audio } from "../audio/AudioManager";
import { Tunnel } from "../tunnel/Tunnel";
import { Orientation, getFrame, stepOrientation } from "../tunnel/SurfaceOrientation";
import { Player, PLAYER_GROUP, STATIC_GROUP } from "../player/Player";
import type { PlayerInputSample } from "../player/Player";
import { ACT_NAMES, ACT_SIZE, actOf, actStart, progress } from "../progress/Progress";

/** How long a robot goes untouched before the game offers to fly it. */
const AUTOPILOT_OFFER_AFTER = 4;
/** Reaction latency, so the autopilot plays like a hand rather than a script. */
const AUTOPILOT_REACTION = 0.1;

/** A catch is a helping hand, not a safety harness: act one allows a few. */
const MAX_RECOVERIES = 4;
const RECOVER_COOLDOWN = 0.7;
import { Coach } from "../ui/Coach";
import { Autopilot } from "./Autopilot";
import { LockerPanel } from "../ui/LockerPanel";
import { Coins } from "../tunnel/Coins";
import { SKINS, TRAILS, skinById, trailById } from "./Skins";
import { RobotTrail } from "../effects/Trails";
import { TetherState } from "../tether/TetherPhysics";
import { TetherRenderer } from "../tether/TetherRenderer";
import { CoopCamera } from "../camera/CoopCamera";
import { LEVELS } from "../levels";

export enum GameState {
  Title,
  Playing,
  Paused,
  Dying,
  Complete,
  Finished,
  RunOver,
}

export interface NetworkPlayerState {
  p: [number, number, number];
  v: [number, number, number];
  grounded: boolean;
  gripping: boolean;
  elasticFlight: number;
}

export interface NetworkGameState {
  level: number;
  state: GameState;
  orientation: Orientation;
  players: [NetworkPlayerState, NetworkPlayerState];
  tetherDistance: number;
  tetherTension: number;
  deaths: number;
  rescues: number;
  drumAngle: number;
  featureTime: number;
  releaseReady: boolean;
}

// The ground ray sees the other robot as well as the tunnel. Standing on your
// partner has to count as standing on something: without this a robot resting on
// the other one is "airborne" forever and dies to the air-time limit.
const RAY_GROUPS = (0xffff << 16) | STATIC_GROUP | PLAYER_GROUP;

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private coopCam!: CoopCamera;
  private world!: RAPIER.World;
  private tunnel!: Tunnel;
  private players: Player[] = [];
  private tetherPhysics = new TetherState();
  private tetherRender!: TetherRenderer;
  private effects!: Effects;
  private ui = new UI();
  private input = new InputManager();

  state: GameState = GameState.Title;
  levelIdx = 0;
  timeScale = 1;
  botInput = { lat: 0, jump: false, grip: false, active: false };
  botInput2 = { lat: 0, jump: false, grip: false, active: false };
  bot: { tick(dt: number): void } | null = null;
  onGameplayStart?: (level: number) => void;
  onGameplayStop?: (level: number, result?: "complete" | "fail") => void;
  onCommercialBreak?: () => Promise<void>;
  pauseInterceptor?: () => boolean;
  restartInterceptor?: () => boolean;
  titleInputEnabled = true;
  orientation: Orientation = Orientation.Floor;
  deaths = 0;
  rescues = 0;

  private accumulator = 0;
  private rotCooldown = 0;
  private dyingTimer = 0;
  private completeTimer = 0;
  private bannerTimer = 0;
  private time = 0;
  private hintFlags: boolean[] = [];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private remoteInput = { lat: 0, jump: false, grip: false, active: false };
  private networkGuest = false;
  private resuming = false;
  private playerCollisionEnabled = true;

  async init(canvas: HTMLCanvasElement, debug = false) {
    await RAPIER.init();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.Fog(0x05070c, 24, 92);

    // A polished skin at metalness 1 has nothing to reflect without an
    // environment and renders almost black. This gives the metals a room to be
    // shiny in; it costs one small render at boot.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x33281c, 1.9);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0x2a3a52, 1.1);
    this.scene.add(amb);
    const dir = new THREE.DirectionalLight(0xfff4e0, 2.4);
    dir.position.set(6, 11, 4);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88bbff, 0.7);
    dir2.position.set(-6, -4, -8);
    this.scene.add(dir2);

    this.coopCam = new CoopCamera(window.innerWidth / window.innerHeight);
    this.effects = new Effects(this.scene);
    this.tetherRender = new TetherRenderer(this.scene);

    const p1 = new Player(0, P1_COLOR, this.scene);
    const p2 = new Player(1, P2_COLOR, this.scene);
    this.trails = [new RobotTrail(this.scene), new RobotTrail(this.scene)];
    this.players = [p1, p2];

    this.input.onAnyKey = () => this.handleAnyKey();
    this.input.onPauseToggle = () => this.pauseGame();
    this.input.onRestart = () => this.restartGame();
    this.input.onMuteToggle = () => this.handleMute();
    this.input.setBotSources(this.botInput, this.botInput2);
    this.input.setRemoteSource(this.remoteInput);

    window.addEventListener("resize", () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.coopCam.camera.aspect = window.innerWidth / window.innerHeight;
      this.coopCam.camera.updateProjectionMatrix();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === GameState.Playing && !this.networkGuest) {
        void this.handlePause();
      }
    });

    this.loadLevel(0);
    this.state = GameState.Title;
    this.showTitleScreen();
    this.ui.hideLoading();

    this.ui.bindAutopilotOffer((player) => this.setAutopilot(player, true));
    // Tab takes the standing offer, or flies whichever robot is idle.
    this.input.onAutopilot = () => {
      const idle = this.humanIdle[1] >= this.humanIdle[0] ? 1 : 0;
      this.setAutopilot(idle, !this.autoOn[idle]);
      this.ui.hideAutopilotOffer();
    };
    this.locker = new LockerPanel();
    const openLocker = () => this.locker.open(() => this.applySkin());
    document.getElementById("btn-locker")?.addEventListener("click", openLocker);
    document.getElementById("btn-pause-locker")?.addEventListener("click", openLocker);

    if (debug) this.exposeDebug();
  }

  /** Shows the title with its act shortcuts rebuilt from the current record. */
  /**
   * Surfaces skins the coin total has just brought into reach. Cheapest first,
   * once each, and it points at the pause menu because that is where the shop
   * lives once a run is under way.
   */
  private announceUnlocks() {
    const fresh = progress.newlyAffordable(SKINS);
    if (!fresh.length) return;
    const cheapest = fresh.reduce((a, b) => (a.price <= b.price ? a : b));
    const skin = skinById(cheapest.id);
    this.ui.unlockToast(skin.name, skin.price, fresh.length - 1);
    progress.markAnnounced(fresh.map((f) => f.id));
    audio.save();
  }

  /** Repaints both robots for whichever skin is equipped. */
  applySkin() {
    const skin = skinById(progress.skin);
    this.players[0].applySkin(skin, skin.p1);
    this.players[1].applySkin(skin, skin.p2);
    // Keep the coach labels wearing the same colours as the robots they name.
    const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
    document.getElementById("coach-p1")?.style.setProperty("--coach-c", hex(skin.p1));
    document.getElementById("coach-p2")?.style.setProperty("--coach-c", hex(skin.p2));
    const accents = [skin.p1, skin.p2];
    for (let i = 0; i < 2; i++) {
      this.trails[i]?.setTrail(trailById(progress.trailFor(i)), accents[i]);
    }
  }

  private showTitleScreen() {
    this.state = GameState.Title;
    this.ui.hideGameOver();
    this.ui.hideFinish();
    this.ui.buildActSelect((act) => {
      this.ui.showTitle(false);
      this.startRun(actStart(act));
    });
    this.ui.setCoins(progress.coins, 0);
    this.ui.showTitle(true);
  }

  private handleAnyKey() {
    audio.resume();
    if (this.state === GameState.RunOver) {
      this.runOverTimer = Math.min(this.runOverTimer, 0.2);
      return;
    }
    if (this.state === GameState.Title && this.titleInputEnabled) {
      this.ui.showTitle(false);
      this.startRun(0);
    }
  }

  startLocal() {
    this.titleInputEnabled = true;
    this.handleAnyKey();
  }

  private async handlePause() {
    if (this.locker?.isOpen) {
      this.locker.close();
      return;
    }
    if (this.state === GameState.Playing) {
      this.state = GameState.Paused;
      this.ui.pause(true);
      audio.suspend();
      this.onGameplayStop?.(this.levelIdx + 1);
    } else if (this.state === GameState.Paused) {
      if (this.resuming) return;
      this.resuming = true;
      await this.onCommercialBreak?.();
      this.state = GameState.Playing;
      this.ui.pause(false);
      audio.resume();
      this.onGameplayStart?.(this.levelIdx + 1);
      this.resuming = false;
    }
  }

  private handleMute() {
    const muted = audio.toggleMute();
    this.ui.hint(muted ? "MUTED" : "SOUND ON", undefined, 1.2);
  }

  pauseGame() {
    if (this.pauseInterceptor?.()) return;
    void this.handlePause();
  }

  pauseFromNetwork() {
    if (this.state === GameState.Playing) void this.handlePause();
  }

  muteGame() {
    this.handleMute();
  }

  restartGame() {
    if (this.restartInterceptor?.()) return;
    this.handleRestart();
  }

  private handleRestart() {
    audio.resume();
    if (this.state === GameState.RunOver) {
      this.runOverTimer = Math.min(this.runOverTimer, 0.2);
      return;
    }
    if (this.state === GameState.Finished) {
      this.ui.hideFinish();
      this.startRun(0);
      return;
    }
    if (this.state === GameState.Playing || this.state === GameState.Dying || this.state === GameState.Paused || this.state === GameState.Complete) {
      if (this.state === GameState.Playing) this.onGameplayStop?.(this.levelIdx + 1, "fail");
      this.ui.pause(false);
      this.resetLevel();
      this.state = GameState.Playing;
      audio.resume();
      this.onGameplayStart?.(this.levelIdx + 1);
    }
  }

  /** Set while the run began at an act shortcut, so it cannot set a record. */
  private practising = false;
  private runStart = 0;
  private runOverTimer = 0;
  /** Per-robot cooldown so a catch cannot fire every frame. */
  private recoverCooldown = [0, 0];
  private recoveries = 0;
  private coach = new Coach();
  /** Drives whichever robot nobody is playing. */
  private pilot = new Autopilot();
  private autoOn = [false, false];
  private humanIdle = [0, 0];
  private autoOffered = [false, false];
  /** Decisions are held briefly so the autopilot reads as a hand, not a script. */
  private autoHold = [0, 0];
  private autoLast: { lat: number; jump: boolean; grip: boolean }[] = [
    { lat: 0, jump: false, grip: false }, { lat: 0, jump: false, grip: false },
  ];
  private autoJumpPrev = [false, false];
  private locker!: LockerPanel;
  private coins!: Coins;
  private trails: RobotTrail[] = [];
  /** Coins picked up this run, banked when the run ends or a level is cleared. */
  private runCoins = 0;

  private startRun(level: number) {
    this.deaths = 0;
    this.rescues = 0;
    this.runCoins = 0;
    for (const t of this.trails) t.clear();
    this.applySkin();
    this.practising = level > 0;
    this.runStart = performance.now();
    this.ui.hideGameOver();
    this.loadLevel(level);
    this.state = GameState.Playing;
    this.onGameplayStart?.(level + 1);
  }

  private loadLevel(idx: number, preserveCoins = false) {
    this.coach.stop();
    if (idx === 0 && !progress.learned) this.coach.start();
    this.levelIdx = idx;
    const def = LEVELS[idx];

    if (this.tunnel) this.tunnel.dispose(this.scene);
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = FIXED_DT;
    const spawnY = -HALF + PLAYER_HALF_H + 0.02;
    this.tunnel = new Tunnel(this.scene, this.world, def, RAPIER, (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
      );
      const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0)
        .setRestitution(0)
        .setCollisionGroups((STATIC_GROUP << 16) | 0xffff);
      this.world.createCollider(col, body);
    });

    if (!preserveCoins || !this.coins) {
      if (this.coins) this.coins.dispose(this.scene);
      this.coins = new Coins(this.scene, def);
    }

    const spawns = [
      new THREE.Vector3(-1.2, spawnY, -4),
      new THREE.Vector3(1.2, spawnY, -4),
    ];
    this.players.forEach((p, i) => {
      p.attachBody(RAPIER, this.world, spawns[i]);
      p.setCollide(this.playerCollisionEnabled);
      p.stopMotion();
      p.resetToSpawn();
    });

    this.orientation = Orientation.Floor;
    this.coopCam.snapTo(this.orientation);
    this.rotCooldown = 0;
    this.hintFlags = (def.hints ?? []).map(() => false);
    this.recoveries = 0;
    this.recoverCooldown = [0, 0];
    this.tetherPhysics.reset();
    this.ui.clearHint();
    this.ui.setLevel(idx + 1, LEVELS.length, def.name);
    this.ui.bannerShow(`LEVEL ${idx + 1}`, def.name, "#dfe9f5");
    this.bannerTimer = 1.0;
  }

  private resetLevel() {
    this.players.forEach((p) => {
      p.resetToSpawn();
      p.container.quaternion.copy(getFrame(Orientation.Floor).rollQuat);
    });
    this.orientation = Orientation.Floor;
    this.coopCam.snapTo(this.orientation);
    this.rotCooldown = 0;
    this.tetherPhysics.reset();
    this.tunnel.drum.setAngle(0, true);
    this.tunnel.resetCrumbles(this.world);
    this.ui.flash("#000000", 0);
  }

  private die() {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Dying;
    this.dyingTimer = 0.42;
    this.deaths++;
    this.onGameplayStop?.(this.levelIdx + 1, "fail");
    this.ui.flash("#ff3828", 0.42);
    audio.death();
    for (const p of this.players) {
      p.position(this.tmpA);
      this.effects.burst(this.tmpA, p.color, 26, 9, 0.7, 14);
    }
  }

  private completeLevel() {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Complete;
    this.completeTimer = 1.15;
    this.onGameplayStop?.(this.levelIdx + 1, "complete");
    audio.portal();
    const finishedAct = actOf(this.levelIdx) !== actOf(this.levelIdx + 1);
    if (finishedAct && this.levelIdx + 1 < LEVELS.length) {
      this.ui.bannerShow(`ACT ${actOf(this.levelIdx) + 1} CLEAR`, ACT_NAMES[actOf(this.levelIdx)] ?? "", "#7dffc8");
    } else {
      this.ui.bannerShow("LEVEL COMPLETE", "", "#9ff5ff");
    }
    this.bannerTimer = 1.1;
    this.tunnel.group.getWorldPosition(this.tmpB);
    this.tmpA.set(0, 0, this.tunnel.finishZ);
    this.effects.burst(this.tmpA, 0x9ff5ff, 60, 16, 1.0, 0);
    for (const p of this.players) {
      p.position(this.tmpB);
      this.effects.burst(this.tmpB, p.color, 20, 8, 0.8, 0);
    }
  }

  /** A run is over: bank how far they got and show it before restarting. */
  private endRun() {
    const reached = this.levelIdx + 1;
    const previousBest = progress.best;
    const isBest = this.practising ? false : progress.reached(reached);
    this.state = GameState.RunOver;
    this.runOverTimer = 0.95;
    this.ui.bannerHide();
    this.ui.clearHint();
    this.ui.showGameOver(reached, LEVELS.length, isBest ? previousBest : progress.best, isBest, this.runCoins);
    this.onGameplayStop?.(reached, "fail");
  }

  private advanceAfterComplete() {
    this.ui.bannerHide();
    if (this.levelIdx + 1 >= LEVELS.length) {
      this.state = GameState.Finished;
      const seconds = (performance.now() - this.runStart) / 1000;
      const fastest = this.practising ? false : progress.cleared(seconds);
      this.ui.showFinish(seconds, this.rescues, fastest, progress.clears);
    } else {
      this.loadLevel(this.levelIdx + 1);
      if (!this.practising) progress.reached(this.levelIdx + 1);
      this.state = GameState.Playing;
      this.onGameplayStart?.(this.levelIdx + 1);
    }
  }

  frame(dtReal: number) {
    dtReal = Math.min(dtReal, MAX_FRAME_DT);
    this.time += dtReal;
    this.bot?.tick(dtReal);

    if (this.state === GameState.Title || this.state === GameState.Finished) {
      if (this.pollPadStart()) this.handleAnyKey();
    }

    const scale =
      this.state === GameState.Dying ? 0.25 :
      this.state === GameState.Complete ? 0.55 : 1;

    if (!this.networkGuest && (
      this.state === GameState.Playing ||
      this.state === GameState.Dying ||
      this.state === GameState.Complete
    )) {
      this.accumulator += dtReal * scale * this.timeScale;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 40) {
        this.fixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
    }

    const frameUp = this.tunnel.drum.surface(this.orientation);

    if (this.state !== GameState.Paused && this.state !== GameState.Title) {
      const visDt = dtReal * scale * this.timeScale;
      for (const p of this.players) p.updateVisual(visDt, frameUp);
      this.tetherRender.update(
        this.players[0], this.players[1], frameUp,
        this.tetherPhysics.tension01, this.coopCam.camera.position, this.time,
      );
      this.players[0].updateShadow(RAPIER, this.world, frameUp, RAY_GROUPS);
      this.players[1].updateShadow(RAPIER, this.world, frameUp, RAY_GROUPS);
      this.tunnel.update(visDt);
      this.coins.update(visDt, this.tunnel.drum.angle);
      for (let i = 0; i < 2; i++) {
        this.players[i].position(this.tmpA);
        this.trails[i].update(visDt, this.tmpA, frameUp.up, this.state === GameState.Playing);
      }
      if (this.networkGuest && this.state === GameState.Playing) {
        this.tunnel.updateSpinners(visDt);
        this.tunnel.updateFeatures(visDt);
      }
      _gravDir.copy(frameUp.up).negate();
      this.effects.update(visDt, _gravDir, this.coopCam.camera.position.z);
      this.coopCam.update(visDt, this.players[0], this.players[1], this.orientation, this.tunnel.drum.angle);
      if (this.state === GameState.Playing) {
        this.players[0].position(this.tmpA);
        this.players[1].position(this.tmpB);
        this.coach.update(visDt, this.coopCam.camera, this.renderer.domElement, [this.tmpA, this.tmpB]);
      } else {
        this.coach.stop();
      }

      if (this.state === GameState.Playing && !this.coopCam.rolling) {
        this.checkScreenDeath(dtReal * this.timeScale);
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dtReal;
      if (this.bannerTimer <= 0) this.ui.bannerHide();
    }
    this.ui.update(dtReal);

    if (!this.networkGuest && this.state === GameState.Dying) {
      this.dyingTimer -= dtReal;
      if (this.dyingTimer <= 0) {
        if (LEVELS[this.levelIdx].localRetry) {
          this.loadLevel(this.levelIdx, true);
          this.state = GameState.Playing;
          this.onGameplayStart?.(this.levelIdx + 1);
        } else this.endRun();
      }
    }
    if (!this.networkGuest && this.state === GameState.RunOver) {
      this.runOverTimer -= dtReal;
      if (this.runOverTimer <= 0) {
        this.startRun(this.practising ? actStart(actOf(this.levelIdx)) : 0);
      }
    }
    if (!this.networkGuest && this.state === GameState.Complete) {
      this.completeTimer -= dtReal;
      if (this.completeTimer <= 0) this.advanceAfterComplete();
    }

    audio.setTension(this.state === GameState.Playing ? this.tetherPhysics.tension01 : 0);
    const anchors = this.players.filter(p => p.gripping);
    this.ui.elasticStatus(this.state !== GameState.Playing ? "" : anchors.length === 2 ? "BOTH LOCKED · RELEASE ONE TO SWING"
      : anchors.length ? this.tetherPhysics.releaseReady ? "SPRING RETURNING · RELEASE TO CARRY MOMENTUM" : `P${anchors[0].index + 1} ANCHORED · STRETCH → SWING → RELEASE`
      : this.players.some(p => p.gripAvailable) ? "GOLD RAIL · HOLD GRIP TO ANCHOR" : "");
    this.renderer.render(this.scene, this.coopCam.camera);
  }

  private pollPadStart(): boolean {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const b of pad.buttons) if (b.pressed) return true;
    }
    return false;
  }

  private fixedUpdate(dt: number) {
    const frame = this.tunnel.drum.surface(this.orientation);

    if (this.state === GameState.Complete) {
      this.retractStep(dt);
      return;
    }

    const in0 = this.input.sample(0);
    const in1 = this.input.sample(1);
    this.driveIdleRobot(0, in0, dt);
    this.driveIdleRobot(1, in1, dt);
    this.players[0].preStep(in0);
    this.players[1].preStep(in1);
    const previouslyGripped = this.players.map(p => p.gripping);
    this.tunnel.preparePlayers(this.players);
    if (this.players.some((p, i) => p.gripping && !previouslyGripped[i])) audio.grip();
    // Preserve the existing axis-aligned collision shape in tunnel-local space.
    // Rotating it again on a gravity roll expands its side into a wall/partner.
    if (this.tunnel.drum.speed) {
      for (const p of this.players) p.body.setRotation(this.tunnel.drum.rotation, true);
    }

    const { snap } = this.tetherPhysics.compute(this.players[0], this.players[1], frame, frame, dt);
    this.players[0].tensionAmount = this.tetherPhysics.tension01;
    this.players[1].tensionAmount = this.tetherPhysics.tension01;
    this.players[0].winchActive = this.tetherPhysics.winchActive;
    this.players[1].winchActive = this.tetherPhysics.winchActive;
    if (snap && this.state === GameState.Playing) audio.snap();

    const ev0 = { jumped: false, landed: false, landImpact: 0, launched: false };
    const ev1 = { jumped: false, landed: false, landImpact: 0, launched: false };
    this.tunnel.applyFeatures(this.players, frame);
    this.players[0].integrate(frame, dt, ev0);
    this.players[1].integrate(frame, dt, ev1);

    this.tunnel.updateSpinners(dt);
    this.tunnel.updateFeatures(dt);
    this.world.step();

    const picked: THREE.Vector3[] = [];
    if (this.coins.collect(this.players, picked, this.tunnel.drum)) {
      for (const at of picked) this.effects.burst(at, 0xffd75e, 14, 6, 0.5, 0);
      this.runCoins += picked.length;
      progress.addCoins(picked.length);
      this.ui.setCoins(progress.coins, this.runCoins);
      audio.coin();
      this.announceUnlocks();
    }

    const cev = this.tunnel.updateCrumble(dt, this.players, this.world, frame.up);
    if (cev.broken.length) {
      audio.crumble();
      for (const bp of cev.broken) this.effects.burst(bp, 0xffa060, 10, 5, 0.5, 10);
    }

    this.players[0].postStep(RAPIER, this.world, frame, RAY_GROUPS, dt, ev0);
    this.players[1].postStep(RAPIER, this.world, frame, RAY_GROUPS, dt, ev1);

    for (let i = 0; i < 2; i++) {
      if (this.recoverCooldown[i] > 0) this.recoverCooldown[i] -= dt;
    }

    this.safetyCheck();
    if (this.state !== GameState.Playing) return;

    if (ev0.jumped) this.coach.note(0, "jumped");
    if (ev1.jumped) this.coach.note(1, "jumped");
    for (let i = 0; i < 2; i++) {
      if (Math.abs(this.players[i].latVel) > 2) this.coach.note(i, "moved");
    }
    if (this.coach.complete) progress.markLearned();
    if (ev0.jumped || ev1.jumped) audio.jump();
    if (ev0.launched || ev1.launched) {
      audio.launch();
      for (let i = 0; i < 2; i++) {
        if (!(i === 0 ? ev0 : ev1).launched) continue;
        this.players[i].position(this.tmpA);
        this.effects.burst(this.tmpA, 0x2effa8, 22, 9, 0.55, 0);
      }
    }
    if (ev0.landed && ev0.landImpact > 0.08) audio.land();
    if (ev1.landed && ev1.landImpact > 0.08) audio.land();

    this.checkRotation();
    this.checkShutters();
    if (this.state !== GameState.Playing) return;
    this.checkKills(ev0, ev1);
    this.checkFinish();
    this.checkHints();
  }

  private retractStep(dt: number) {
    this.players[0].position(this.tmpA);
    this.players[1].position(this.tmpB);
    _mid.addVectors(this.tmpA, this.tmpB).multiplyScalar(0.5);
    for (const p of this.players) {
      p.position(_ppos);
      _ppos.lerp(_mid, Math.min(1, 7 * dt));
      _ppos.z -= 1.5 * dt;
      p.body.setTranslation({ x: _ppos.x, y: _ppos.y, z: _ppos.z }, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.tunnel.update(dt);
  }

  private safetyCheck() {
    for (const p of this.players) {
      const t = p.body.translation();
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)) {
        p.stopMotion();
        p.resetToSpawn();
      }
    }
  }

  private checkScreenDeath(dt: number) {
    for (const p of this.players) {
      const mate = this.players[1 - p.index];
      if (p.elasticFlight > 0 && (mate.gripping || mate.grounded) && this.tetherPhysics.distance < 9) {
        p.offScreenTime = 0;
        continue;
      }
      p.position(_proj);
      _proj.project(this.coopCam.camera);
      const off =
        _proj.y < -1.12 || _proj.y > 1.5 || _proj.x < -1.4 || _proj.x > 1.4;
      if (off) {
        p.offScreenTime += dt;
        if (p.offScreenTime > SCREEN_KILL_GRACE) {
          this.noteDeath("off-screen", p.index);
          this.die();
          return;
        }
      } else {
        p.offScreenTime = 0;
      }
    }
  }

  private checkRotation() {
    this.rotCooldown = Math.max(0, this.rotCooldown - FIXED_DT);
    if (this.rotCooldown > 0) return;
    let intent = 0;
    for (const p of this.players) {
      intent = p.rotationIntent();
      if (intent !== 0) break;
    }
    if (intent === 0) return;
    const from = this.orientation;
    const to = stepOrientation(from, intent);
    this.orientation = to;
    this.rotCooldown = ROT_COOLDOWN;
    this.coopCam.requestRoll(from, to);
    audio.rotate();
    for (const p of this.players) {
      p.position(this.tmpA);
      this.effects.burst(this.tmpA, 0x66e0ff, 18, 6, 0.5, 0);
    }
  }

  /**
   * Drops a fallen robot back beside its partner. Only works while the partner is
   * itself safe: the two are tethered, so they usually go over the edge together,
   * and putting a falling robot next to a falling robot just re-triggers this
   * every frame — which read as the pair bouncing around, never dying.
   */
  private recover(p: Player, mateIdx: number): boolean {
    if (this.recoverCooldown[p.index] > 0) return true;
    if (this.recoveries >= MAX_RECOVERIES) return false;
    const mate = this.players[mateIdx];
    if (!mate.grounded || mate.beyond > 0.5) return false;

    mate.position(this.tmpB);
    const frame = this.tunnel.drum.surface(this.orientation);
    this.tmpA.copy(this.tmpB).addScaledVector(frame.right, p.index === 0 ? -1.1 : 1.1);
    this.tmpA.addScaledVector(frame.up, 0.6);
    p.warp(this.tmpA.x, this.tmpA.y, this.tmpA.z);
    p.stopMotion();
    p.wasFar = false;
    this.recoverCooldown[p.index] = RECOVER_COOLDOWN;
    this.recoveries++;
    this.rescues++;
    this.ui.rescuePopup();
    audio.save();
    this.effects.burst(this.tmpA, 0x7dffc8, 24, 8, 0.7, 0);
    return true;
  }

  /**
   * Watches one robot for a human, and flies it when there is not one. Any real
   * input hands it straight back — the autopilot never fights the player for a
   * robot they have picked up.
   */
  private driveIdleRobot(i: number, sample: PlayerInputSample, dt: number) {
    const touched = Math.abs(sample.lateral) > 0.15 || sample.jumpHeld || sample.jumpPressed || sample.gripHeld;
    if (touched) {
      this.humanIdle[i] = 0;
      if (this.autoOn[i]) this.setAutopilot(i, false);
      return;
    }
    if (this.state !== GameState.Playing) return;

    this.humanIdle[i] += dt;
    if (!this.autoOn[i]) {
      // Offer once, after long enough that a pause for breath is not mistaken
      // for an empty seat.
      if (this.humanIdle[i] > AUTOPILOT_OFFER_AFTER && !this.autoOffered[i]) {
        this.autoOffered[i] = true;
        this.ui.offerAutopilot(i);
      }
      return;
    }

    this.autoHold[i] -= dt;
    if (this.autoHold[i] <= 0) {
      const read = this.botRead();
      const lead = i === 0 ? null : this.autoLast[0].lat;
      const plan = this.pilot.plan(read, i, this.autoOn[1 - i] ? null : lead);
      // A touch of slop: a partner who tracks the exact centre of every lane
      // reads as a machine, and the point is that it feels like somebody is there.
      const slop = Math.random() < 0.12 ? 0 : plan.lat;
      this.autoLast[i] = { lat: slop, jump: plan.jump, grip: plan.grip };
      this.autoHold[i] = AUTOPILOT_REACTION * (0.7 + Math.random() * 0.6);
    }
    sample.lateral = this.autoLast[i].lat;
    const wasHeld = this.autoJumpPrev[i];
    sample.jumpHeld = this.autoLast[i].jump;
    sample.jumpPressed = this.autoLast[i].jump && !wasHeld;
    this.autoJumpPrev[i] = sample.jumpHeld;
    sample.gripHeld = this.autoLast[i].grip;
  }

  setAutopilot(i: number, on: boolean) {
    if (this.autoOn[i] === on) return;
    this.autoOn[i] = on;
    this.autoHold[i] = 0;
    this.autoLast[i] = { lat: 0, jump: false, grip: false };
    this.autoJumpPrev[i] = false;
    if (on) this.pilot.reset();
    this.ui.setAutopilot(i, on);
  }

  autopilotOn(i: number) { return this.autoOn[i]; }

  private checkShutters() {
    for (const p of this.players) {
      p.position(this.tmpA);
      if (!this.tunnel.shutterHazard(this.tmpA, PLAYER_HALF_W, PLAYER_HALF_H)) continue;
      this.effects.burst(this.tmpA, 0xff3a2f, 34, 11, 0.7, 0);
      this.noteDeath("shutter", p.index);
      this.die();
      return;
    }
  }

  /** Diagnostics for the verification bot: what ended the run, and where. */
  deathInfo: { cause: string; player: number; slice: number; orientation: string } | null = null;

  private noteDeath(cause: string, player: number) {
    this.players[player].position(this.tmpA);
    this.deathInfo = {
      cause, player,
      slice: Math.round(-this.tmpA.z / SLICE_LEN),
      orientation: Orientation[this.orientation],
    };
  }

  private checkKills(ev0: { landed: boolean }, ev1: { landed: boolean }) {
    const evs = [ev0, ev1];
    let anyDead = false;
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      p.position(this.tmpA);
      this.tunnel.drum.toLocal(this.tmpA);
      const dx = Math.max(0, Math.abs(this.tmpA.x) - HALF - 0.4);
      const dy = Math.max(0, Math.abs(this.tmpA.y) - HALF - 0.4);
      p.beyond = Math.max(dx, dy);
      if (p.beyond > 3.5) p.wasFar = true;

      if (evs[i].landed && p.wasFar && p.beyond < 1) {
        this.rescues++;
        p.wasFar = false;
        this.ui.rescuePopup();
        audio.save();
        this.effects.burst(this.tmpA, 0x7dffc8, 30, 8, 0.8, 0);
      }
      const supportedSwing = p.elasticFlight > 0 && this.players[1 - i].gripping && this.tetherPhysics.distance < 9;
      if (p.beyond > KILL_DIST || p.airTime > (supportedSwing ? 7 : MAX_AIR_TIME)) {
        // Act one teaches. A robot that falls there is put back beside its
        // partner instead of ending the run: playtests showed the median session
        // dying out inside the first minute, which is the tutorial failing, not
        // the player.
        if (this.levelIdx < ACT_SIZE && this.recover(p, i === 0 ? 1 : 0)) continue;
        anyDead = true;
        this.noteDeath(p.airTime > MAX_AIR_TIME ? "air-time" : "fell-out", i);
      }
    }
    if (anyDead) this.die();
  }

  private checkFinish() {
    if (this.tetherPhysics.distance > TETHER_REST + 3) return;
    let both = true;
    for (const p of this.players) {
      p.position(this.tmpA);
      if (this.tmpA.z > this.tunnel.finishZ || Math.abs(this.tmpA.x) > HALF * 1.6 || Math.abs(this.tmpA.y) > HALF * 1.6) {
        both = false;
      }
    }
    if (both) this.completeLevel();
  }

  private checkHints() {
    const def = LEVELS[this.levelIdx];
    const hints = def.hints ?? [];
    let minZ = Infinity;
    for (const p of this.players) {
      p.position(this.tmpA);
      minZ = Math.min(minZ, this.tmpA.z);
    }
    for (let i = 0; i < hints.length; i++) {
      if (this.hintFlags[i]) continue;
      const zTrigger = -(hints[i].atSlice * SLICE_LEN + 3);
      if (minZ <= zTrigger) {
        this.hintFlags[i] = true;
        this.ui.hint(hints[i].text, hints[i].touchText);
      }
    }
  }

  private exposeDebug() {
    (window as unknown as Record<string, unknown>).__TR__ = {
      game: this,
      snapshot: () => ({
        state: GameState[this.state],
        level: this.levelIdx + 1,
        orientation: Orientation[this.orientation],
        p1: this.playerSnap(this.players[0]),
        p2: this.playerSnap(this.players[1]),
        tetherDist: this.tetherPhysics.distance,
        tension: this.tetherPhysics.tension01,
        deaths: this.deaths,
        rescues: this.rescues,
        finishZ: this.tunnel.finishZ,
        spinners: this.tunnel.spinnerStates(),
        drumAngle: this.tunnel.drum.angle,
      }),
      warp: (i: number, x: number, y: number, z: number) => this.players[i].warp(x, y, z),
      setAutoRun: (i: number, on: boolean) => {
        this.players[i].autoRun = on;
        if (!on) this.players[i].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      },
      setOrientation: (o: number) => {
        this.orientation = o as Orientation;
        this.coopCam.snapTo(this.orientation);
      },
      forceRotate: (dir: number) => {
        const from = this.orientation;
        this.orientation = stepOrientation(from, dir);
        this.rotCooldown = ROT_COOLDOWN;
        this.coopCam.requestRoll(from, this.orientation);
      },
      musicPlaying: () => audio.musicPlaying,
      setTimeScale: (ts: number) => { this.timeScale = ts; },
      setPlayerCollision: (on: boolean) => this.setPlayerCollision(on),
      crumbleBroken: () => this.tunnel.crumbleBrokenCount(),
      features: () => ({
        ...this.tunnel.featurePositions(),
        sliders: this.tunnel.sliderStates(),
      }),
      bot: null as unknown,
      touch: () => ({ ...touchState }),
      levels: () =>
        LEVELS.map((d) => {
          let maxFloorRun = 0;
          let run = 0;
          let wallHaz = 0;
          for (const s of d.slices) {
            const fEmpty = s.f === E_PATTERN;
            if (fEmpty) {
              run++;
              if (run > maxFloorRun) maxFloorRun = run;
            } else {
              run = 0;
            }
            const otherGap = [s.l, s.r, s.c].some((x) => x !== undefined && x.includes("."));
            if (fEmpty && otherGap) wallHaz++;
          }
          return { name: d.name, len: d.slices.length, maxFloorRun, wallHaz };
        }),
      startRun: (idx: number) => {
        this.ui.showTitle(false);
        this.ui.hideFinish();
        this.startRun(idx);
      },
    };
  }

  botRead() {
    return {
      state: this.state as number,
      orientation: this.orientation,
      def: LEVELS[this.levelIdx],
      drum: this.tunnel.drum,
      level: this.levelIdx + 1,
      p1: this.players[0],
      p2: this.players[1],
      p2body: this.players[1].body,
      spinners: this.tunnel.spinnerStates(),
      sliders: this.tunnel.sliderStates(),
      sliderColAt: (ahead: number, baseCol: number, phase: number) =>
        this.tunnel.sliderColAt(ahead, baseCol, phase),
      deathInfo: this.deathInfo,
      shutterAt: (ahead: number, phase: number) => this.tunnel.shutterExtensionAt(ahead, phase),
      timeScale: this.timeScale,
      time: this.time,
    };
  }

  setNetworkRole(role: "local" | "host" | "guest") {
    this.networkGuest = role === "guest";
    this.remoteInput.active = role === "host";
    if (role !== "host") {
      this.remoteInput.lat = 0;
      this.remoteInput.jump = false;
      this.remoteInput.grip = false;
    }
  }

  setRemoteInput(lateral: number, jumpHeld: boolean, gripHeld = false) {
    this.remoteInput.lat = Number.isFinite(lateral) ? Math.max(-1, Math.min(1, lateral)) : 0;
    this.remoteInput.jump = jumpHeld;
    this.remoteInput.grip = gripHeld;
    this.remoteInput.active = true;
  }

  private setPlayerCollision(on: boolean) {
    this.playerCollisionEnabled = on;
    for (const p of this.players) p.setCollide(on);
  }

  readOnlineInput(): { lateral: number; jumpHeld: boolean; gripHeld: boolean } {
    const sample = this.input.sample(0);
    return { lateral: sample.lateral, jumpHeld: sample.jumpHeld, gripHeld: sample.gripHeld };
  }

  startOnlineRun() {
    this.ui.showTitle(false);
    this.ui.hideFinish();
    this.startRun(0);
  }

  networkSnapshot(): NetworkGameState {
    return {
      level: this.levelIdx,
      state: this.state,
      orientation: this.orientation,
      players: [this.networkPlayerState(this.players[0]), this.networkPlayerState(this.players[1])],
      tetherDistance: this.tetherPhysics.distance,
      tetherTension: this.tetherPhysics.tension01,
      deaths: this.deaths,
      rescues: this.rescues,
      drumAngle: this.tunnel.drum.angle,
      featureTime: this.tunnel.featureClock,
      releaseReady: this.tetherPhysics.releaseReady,
    };
  }

  applyNetworkSnapshot(s: NetworkGameState) {
    if (!this.networkGuest) return;
    const previousState = this.state;
    if (s.level !== this.levelIdx) this.loadLevel(s.level);
    this.tunnel.syncClock(s.featureTime ?? 0, s.drumAngle ?? 0);
    if (s.orientation !== this.orientation) {
      this.orientation = s.orientation;
      this.coopCam.snapTo(this.orientation);
    }
    this.applyNetworkPlayerState(this.players[0], s.players[0]);
    this.applyNetworkPlayerState(this.players[1], s.players[1]);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.tetherPhysics.distance = s.tetherDistance;
    this.tetherPhysics.tension01 = s.tetherTension;
    this.tetherPhysics.releaseReady = !!s.releaseReady;
    this.deaths = s.deaths;
    this.rescues = s.rescues;
    this.state = s.state;
    this.ui.showTitle(false);
    this.ui.pause(s.state === GameState.Paused);
    // The guest mirrors the host's screens. Records belong to whoever is running
    // the campaign, so a guest never banks one.
    if (s.state === GameState.Finished) {
      this.ui.showFinish((performance.now() - this.runStart) / 1000, s.rescues, false, progress.clears);
    } else {
      this.ui.hideFinish();
    }
    if (s.state === GameState.RunOver) {
      this.ui.showGameOver(this.levelIdx + 1, LEVELS.length, progress.best, false);
    } else {
      this.ui.hideGameOver();
    }

    if (previousState === GameState.Paused && s.state === GameState.Playing) {
      this.state = GameState.Paused;
      this.ui.pause(true);
      if (!this.resuming) {
        this.resuming = true;
        void (async () => {
          await this.onCommercialBreak?.();
          this.state = GameState.Playing;
          this.ui.pause(false);
          audio.resume();
          this.onGameplayStart?.(s.level + 1);
          this.resuming = false;
        })();
      }
      return;
    }

    if (previousState === GameState.Playing && s.state !== GameState.Playing) {
      const result = s.state === GameState.Complete ? "complete" : s.state === GameState.Dying ? "fail" : undefined;
      this.onGameplayStop?.(s.level + 1, result);
      if (s.state === GameState.Paused) audio.suspend();
    } else if (previousState !== GameState.Playing && s.state === GameState.Playing) {
      audio.resume();
      this.onGameplayStart?.(s.level + 1);
    }
  }

  private networkPlayerState(p: Player): NetworkPlayerState {
    const pos = p.body.translation();
    const vel = p.body.linvel();
    return {
      p: [pos.x, pos.y, pos.z],
      v: [vel.x, vel.y, vel.z],
      grounded: p.grounded,
      gripping: p.gripping,
      elasticFlight: p.elasticFlight,
    };
  }

  private applyNetworkPlayerState(p: Player, s: NetworkPlayerState) {
    p.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
    p.body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
    p.container.position.set(s.p[0], s.p[1], s.p[2]);
    p.grounded = s.grounded;
    p.gripping = !!s.gripping;
    p.elasticFlight = s.elasticFlight ?? 0;
  }

  private playerSnap(p: Player) {
    p.position(this.tmpA);
    return { x: +this.tmpA.x.toFixed(2), y: +this.tmpA.y.toFixed(2), z: +this.tmpA.z.toFixed(2), grounded: p.grounded, gripping: p.gripping, gripAvailable: p.gripAvailable, elasticFlight: p.elasticFlight };
  }
}

const _mid = new THREE.Vector3();
const _ppos = new THREE.Vector3();
const _gravDir = new THREE.Vector3();
const _proj = new THREE.Vector3();
const E_PATTERN = ".....";
