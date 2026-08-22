import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  FIXED_DT, MAX_FRAME_DT, KILL_DIST, MAX_AIR_TIME,
  HALF, ROT_COOLDOWN, PLAYER_HALF_H, SLICE_LEN,
  P1_COLOR, P2_COLOR, TETHER_REST, SCREEN_KILL_GRACE,
} from "./Constants";
import { InputManager } from "../input/InputManager";
import { touchState } from "../input/touchState";
import { UI } from "../ui/UI";
import { Effects } from "../effects/Effects";
import { audio } from "../audio/AudioManager";
import { Tunnel } from "../tunnel/Tunnel";
import { Orientation, getFrame, stepOrientation } from "../tunnel/SurfaceOrientation";
import { Player, STATIC_GROUP } from "../player/Player";
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
}

const RAY_GROUPS = (0xffff << 16) | STATIC_GROUP;

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

  async init(canvas: HTMLCanvasElement) {
    await RAPIER.init();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.Fog(0x05070c, 24, 92);

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
    this.players = [p1, p2];

    this.input.onAnyKey = () => this.handleAnyKey();
    this.input.onPauseToggle = () => this.handlePause();
    this.input.onRestart = () => this.handleRestart();
    this.input.onMuteToggle = () => this.handleMute();
    document.addEventListener("pointerdown", () => this.handleAnyKey());

    window.addEventListener("resize", () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.coopCam.camera.aspect = window.innerWidth / window.innerHeight;
      this.coopCam.camera.updateProjectionMatrix();
    });

    this.loadLevel(0);
    this.state = GameState.Title;
    this.ui.showTitle(true);
    this.ui.hideLoading();

    this.exposeDebug();
  }

  private handleAnyKey() {
    audio.resume();
    if (this.state === GameState.Title) {
      this.ui.showTitle(false);
      this.startRun(0);
    }
  }

  private handlePause() {
    if (this.state === GameState.Playing) {
      this.state = GameState.Paused;
      this.ui.pause(true);
    } else if (this.state === GameState.Paused) {
      this.state = GameState.Playing;
      this.ui.pause(false);
    }
  }

  private handleMute() {
    const muted = audio.toggleMute();
    this.ui.hint(muted ? "MUTED" : "SOUND ON", 1.2);
  }

  pauseGame() {
    this.handlePause();
  }

  muteGame() {
    this.handleMute();
  }

  private handleRestart() {
    audio.resume();
    if (this.state === GameState.Finished) {
      this.ui.hideFinish();
      this.startRun(0);
      return;
    }
    if (this.state === GameState.Playing || this.state === GameState.Dying || this.state === GameState.Paused) {
      this.ui.pause(false);
      this.resetLevel();
      this.state = GameState.Playing;
    }
  }

  private startRun(level: number) {
    this.deaths = 0;
    this.rescues = 0;
    this.loadLevel(level);
    this.state = GameState.Playing;
  }

  private loadLevel(idx: number) {
    this.levelIdx = idx;
    const def = LEVELS[idx];

    if (this.tunnel) this.tunnel.dispose(this.scene);
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = FIXED_DT;
    const spawnY = -HALF + PLAYER_HALF_H + 0.02;
    this.tunnel = new Tunnel(this.scene, this.world, def, (x, y, z, hx, hy, hz) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
      );
      const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0)
        .setRestitution(0)
        .setCollisionGroups((STATIC_GROUP << 16) | 0xffff);
      this.world.createCollider(col, body);
    });

    const spawns = [
      new THREE.Vector3(-1.2, spawnY, -4),
      new THREE.Vector3(1.2, spawnY, -4),
    ];
    this.players.forEach((p, i) => {
      p.attachBody(RAPIER, this.world, spawns[i]);
      p.stopMotion();
      p.resetToSpawn();
    });

    this.orientation = Orientation.Floor;
    this.coopCam.snapTo(this.orientation);
    this.rotCooldown = 0;
    this.hintFlags = (def.hints ?? []).map(() => false);
    this.tetherPhysics.wasHigh = false;
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
    this.tetherPhysics.wasHigh = false;
    this.ui.flash("#000000", 0);
  }

  private die() {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Dying;
    this.dyingTimer = 0.42;
    this.deaths++;
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
    audio.portal();
    this.ui.bannerShow("LEVEL COMPLETE", "", "#9ff5ff");
    this.bannerTimer = 1.1;
    this.tunnel.group.getWorldPosition(this.tmpB);
    this.tmpA.set(0, 0, this.tunnel.finishZ);
    this.effects.burst(this.tmpA, 0x9ff5ff, 60, 16, 1.0, 0);
    for (const p of this.players) {
      p.position(this.tmpB);
      this.effects.burst(this.tmpB, p.color, 20, 8, 0.8, 0);
    }
  }

  private advanceAfterComplete() {
    this.ui.bannerHide();
    if (this.levelIdx + 1 >= LEVELS.length) {
      this.state = GameState.Finished;
      this.ui.showFinish(this.deaths, this.rescues);
    } else {
      this.loadLevel(this.levelIdx + 1);
      this.state = GameState.Playing;
    }
  }

  frame(dtReal: number) {
    dtReal = Math.min(dtReal, MAX_FRAME_DT);
    this.time += dtReal;

    if (this.state === GameState.Title || this.state === GameState.Finished) {
      if (this.pollPadStart()) this.handleAnyKey();
    }

    const scale =
      this.state === GameState.Dying ? 0.25 :
      this.state === GameState.Complete ? 0.55 : 1;

    if (
      this.state === GameState.Playing ||
      this.state === GameState.Dying ||
      this.state === GameState.Complete
    ) {
      this.accumulator += dtReal * scale;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 8) {
        this.fixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
    }

    const frameUp = getFrame(this.orientation);

    if (this.state !== GameState.Paused && this.state !== GameState.Title) {
      const visDt = dtReal * (this.state === GameState.Dying ? 0.25 : 1);
      for (const p of this.players) p.updateVisual(visDt, frameUp);
      this.tetherRender.update(
        this.players[0], this.players[1], frameUp,
        this.tetherPhysics.tension01, this.coopCam.camera.position, this.time,
      );
      this.players[0].updateShadow(RAPIER, this.world, frameUp, RAY_GROUPS);
      this.players[1].updateShadow(RAPIER, this.world, frameUp, RAY_GROUPS);
      this.tunnel.update(visDt);
      _gravDir.copy(frameUp.up).negate();
      this.effects.update(visDt, _gravDir, this.coopCam.camera.position.z);
      this.coopCam.update(visDt, this.players[0], this.players[1], this.orientation);

      if (this.state === GameState.Playing) {
        this.checkScreenDeath(dtReal);
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dtReal;
      if (this.bannerTimer <= 0) this.ui.bannerHide();
    }
    this.ui.update(dtReal);

    if (this.state === GameState.Dying) {
      this.dyingTimer -= dtReal;
      if (this.dyingTimer <= 0) {
        this.loadLevel(0);
        this.state = GameState.Playing;
      }
    }
    if (this.state === GameState.Complete) {
      this.completeTimer -= dtReal;
      if (this.completeTimer <= 0) this.advanceAfterComplete();
    }

    audio.setTension(this.state === GameState.Playing ? this.tetherPhysics.tension01 : 0);
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
    const frame = getFrame(this.orientation);

    if (this.state === GameState.Complete) {
      this.retractStep(dt);
      return;
    }

    const in0 = this.input.sample(0);
    const in1 = this.input.sample(1);
    this.players[0].preStep(in0);
    this.players[1].preStep(in1);

    const { snap } = this.tetherPhysics.compute(this.players[0], this.players[1], frame, frame, dt);
    this.players[0].tensionAmount = this.tetherPhysics.tension01;
    this.players[1].tensionAmount = this.tetherPhysics.tension01;
    this.players[0].winchActive = this.tetherPhysics.winchActive;
    this.players[1].winchActive = this.tetherPhysics.winchActive;
    if (snap && this.state === GameState.Playing) audio.snap();

    const ev0 = { jumped: false, landed: false, landImpact: 0 };
    const ev1 = { jumped: false, landed: false, landImpact: 0 };
    this.players[0].integrate(frame, dt, ev0);
    this.players[1].integrate(frame, dt, ev1);

    this.world.step();

    this.players[0].postStep(RAPIER, this.world, frame, RAY_GROUPS, dt, ev0);
    this.players[1].postStep(RAPIER, this.world, frame, RAY_GROUPS, dt, ev1);

    this.safetyCheck();
    if (this.state !== GameState.Playing) return;

    if (ev0.jumped || ev1.jumped) audio.jump();
    if (ev0.landed && ev0.landImpact > 0.08) audio.land();
    if (ev1.landed && ev1.landImpact > 0.08) audio.land();

    this.checkRotation();
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
      p.position(_proj);
      _proj.project(this.coopCam.camera);
      const off =
        _proj.y < -1.12 || _proj.y > 1.5 || _proj.x < -1.4 || _proj.x > 1.4;
      if (off) {
        p.offScreenTime += dt;
        if (p.offScreenTime > SCREEN_KILL_GRACE) {
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

  private checkKills(ev0: { landed: boolean }, ev1: { landed: boolean }) {
    const evs = [ev0, ev1];
    let anyDead = false;
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      p.position(this.tmpA);
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
      if (p.beyond > KILL_DIST || p.airTime > MAX_AIR_TIME) anyDead = true;
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
        this.ui.hint(hints[i].text);
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

  private playerSnap(p: Player) {
    p.position(this.tmpA);
    return { x: +this.tmpA.x.toFixed(2), y: +this.tmpA.y.toFixed(2), z: +this.tmpA.z.toFixed(2), grounded: p.grounded };
  }
}

const _mid = new THREE.Vector3();
const _ppos = new THREE.Vector3();
const _gravDir = new THREE.Vector3();
const _proj = new THREE.Vector3();
const E_PATTERN = ".....";
