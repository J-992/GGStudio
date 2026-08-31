import {
  AnimationClip,
  AnimationMixer,
  FrontSide,
  Group,
  LoopOnce,
  MathUtils,
  Mesh,
  Object3D,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
} from 'three';
import { ATTACK, CONTACT, PHYSICS } from '../config';
import { RigAdapter, normalizeHeight, type Pose } from './Rig';
import { Inertia, Spring } from '../fx/Physics';
import {
  AnimationDetailLayer,
  MOTION_SOURCE_KEYS,
  combineMotionPoses,
} from './AnimationDetailLayer';
import { FLOW_STRIKE, HURT, KO, WHIFF, sample } from './Poses';
import {
  BASIC_IDS,
  FLASHY_IDS,
  MOVES,
  moveById,
  sampleRoot,
  type Move,
  type MoveEventKind,
  type RootSample,
} from './MoveLibrary';
import { Wardrobe } from './Wardrobe';
import { defaultLoadout, type Loadout } from './Cosmetics';
import type { Lane } from '../input/InputManager';
import {
  contactProfileFor,
  type ContactImpulse,
  type ContactSample,
} from './CombatContact';

export type PlayerState = 'idle' | 'attack' | 'whiff' | 'hurt' | 'ko' | 'flowStrike' | 'finisher';

export interface PlayerContactEvent extends ContactSample {
  moveId: string;
}

const HERO_HEIGHT = 1.72;

/**
 * The hero: one premium rigged ninja, driven by a two-layer animator.
 *
 * Layer 1 is the character's own idle clip on an AnimationMixer, so every ninja
 * keeps its authored personality while standing.
 * Layer 2 is a procedural pose track applied additively on top for everything
 * combat-timed — strikes, whiffs, hurt, KO — because those must land on exact
 * millisecond boundaries that a 3-second authored clip cannot hit.
 *
 * The controller owns no combat rules. It is told what happened and shows it,
 * which is what keeps gameplay logic character-independent.
 */
export class Player {
  readonly group = new Group();
  readonly root = new Group();

  state: PlayerState = 'idle';
  /** 0..1 progress through the current procedural animation. */
  private phase = 0;
  private duration = 1;
  private mixer: AnimationMixer | null = null;
  private idleAction: AnimationAction | null = null;
  /** Rotation-only run cycle, blended in under travelling reel moves. */
  private locomotionAction: AnimationAction | null = null;
  private finisherAction: AnimationAction | null = null;
  private rig: RigAdapter | null = null;
  private readonly pose: Pose = {};
  private facing = 0;
  private facingTarget = 0;
  private lungeX = 0;
  private lungeTarget = 0;
  private idleWeight = 1;
  private locomotionWeight = 0;
  private readonly secondaryPose: Pose = {};
  /** Angular-velocity-driven overlap for wrists, shoulders, feet and twist helpers. */
  private readonly detailLayer = new AnimationDetailLayer();
  /** Bind-relative rotations produced by the imported idle/run/finisher clips. */
  private readonly mixerPose: Pose = {};
  /** Mixer and combat rotations combined as one source for follow-through. */
  private readonly motionPose: Pose = {};
  private bodyLean = 0;
  private landingCompression = 0;
  private lastRootX = 0;
  private lastRootY = 0;
  private model: Object3D | null = null;
  private move: Move = MOVES[0];
  private basicCursor = 0;
  private flashyCursor = 0;
  private readonly rootSample: RootSample = { x: 0, y: 0, rot: [0, 0, 0] };
  private readonly firedEvents = new Set<number>();
  private readonly pendingEvents: MoveEventKind[] = [];
  private readonly pendingContacts: PlayerContactEvent[] = [];
  private moveDir = 1;
  /**
   * A travelling move ends somewhere else. The final root offset is held after
   * the animation completes so the hero stays where the scene put him, instead
   * of sliding back to his mark the instant the move is over.
   */
  private rootHeld = false;
  /** Direction the hero should face while idle, e.g. the live Flow target. */
  private idleFacing = 0;
  /**
   * Hero inertia. The root is driven by authored motion — lunges, slides,
   * dashes — and the torso and head are given mass of their own: they trail
   * when he accelerates and swing through when he stops. Without it a two-metre
   * dash reads as the whole model being teleported sideways.
   */
  private readonly inertia = new Inertia();
  private readonly torsoLag = new Spring(PHYSICS.heroLagStiffness, PHYSICS.heroLagDamping);
  private readonly headLag = new Spring(PHYSICS.heroLagStiffness * 0.7, PHYSICS.heroLagDamping * 0.8);
  /** Root motion-warp target and measured striking-bone trajectory. */
  private readonly contactTarget = new Vector3();
  private readonly effectorPosition = new Vector3();
  private readonly previousEffector = new Vector3();
  private contactTargetRadius = CONTACT.bodyRadius;
  private contactActive = false;
  private contactEmitted = false;
  private effectorStarted = false;
  private contactWarp = 0;
  /** Equal-and-opposite response: a small root shove plus articulated recoil. */
  private readonly rootRecoil = new Spring(105, 18);
  private readonly bodyRecoil = new Spring(135, 19);
  /**
   * Cosmetics. The wardrobe hangs off the rig, so it survives a move but not a
   * character swap, and it gets its own inertia tracker: cloth has to keep
   * swinging while the hero stands still, and the body's tracker only runs
   * while a combat track is playing.
   */
  private wardrobe: Wardrobe | null = null;
  private loadout: Loadout = defaultLoadout();
  private readonly clothInertia = new Inertia();

  constructor() {
    this.group.add(this.root);
  }

  /** Swaps in a character. Safe to call between runs; the old model is dropped. */
  setCharacter(scene: Object3D, clips: readonly AnimationClip[], idleClip: AnimationClip | null): void {
    if (this.model) {
      this.wardrobe?.clear();
      this.wardrobe = null;
      this.root.remove(this.model);
      this.mixer?.stopAllAction();
    }
    const model = scene;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    normalizeHeight(model, HERO_HEIGHT);

    model.traverse((o) => {
      if (o instanceof Mesh || o instanceof SkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        // Meshy exports double-sided by default, which doubles the hero's
        // shadow cost for no visual gain on a closed mesh.
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) m.side = FrontSide;
      }
    });

    this.root.add(model);
    this.model = model;
    this.rig = new RigAdapter(model, HERO_HEIGHT);
    this.wardrobe = new Wardrobe(model, this.rig);
    this.wardrobe.apply(this.loadout);

    this.mixer = new AnimationMixer(model);
    const idle = idleClip ?? clips.find((c) => /idle/i.test(c.name)) ?? null;
    this.idleAction = idle ? this.mixer.clipAction(idle) : null;
    this.idleAction?.play();
    // The supplied locomotion clips contain root translations. Their rotation
    // tracks add believable leg timing, but root tracks would compete with the
    // precisely-authored combat path, so only rotations are retained here.
    const locomotion = clips.find((c) => /run|walk/i.test(c.name)) ?? null;
    this.locomotionAction = locomotion
      ? this.mixer.clipAction(rotationOnlyClip(locomotion))
      : null;
    this.locomotionAction?.setEffectiveWeight(0).play();
    this.finisherAction = null;
    this.state = 'idle';
    this.phase = 0;
    this.idleWeight = 1;
    this.locomotionWeight = 0;
    this.bodyLean = 0;
    this.landingCompression = 0;
    this.lastRootX = 0;
    this.lastRootY = 0;
    this.detailLayer.reset();
    this.clothInertia.reset(0, 0);
    this.clearContact();
  }

  /**
   * Dresses the hero. Cosmetics never touch combat, so this is safe to call
   * mid-run — the player sees the change on the ninja standing in front of them
   * rather than on the next load.
   */
  setLoadout(loadout: Loadout): void {
    this.loadout = loadout;
    this.wardrobe?.apply(loadout);
  }

  /** Measured cosmetic fit, for scripted checks. Empty before a character loads. */
  get wardrobeDebug(): Record<string, unknown> {
    return this.wardrobe?.debugLimbs ?? {};
  }

  /** Where the wardrobe actually put each piece, for scripted fitting checks. */
  get wardrobeMounts(): unknown[] {
    return this.wardrobe?.debugMounts ?? [];
  }

  /** Arms a long authored clip for the next Flow finisher. */
  setFinisherClip(clip: AnimationClip | null): void {
    if (!this.mixer || !clip) {
      this.finisherAction = null;
      return;
    }
    this.finisherAction = this.mixer.clipAction(clip);
    this.finisherAction.setLoop(LoopOnce, 1);
    this.finisherAction.clampWhenFinished = true;
  }

  /** True when this character has an authored clip armed for the finisher. */
  get hasFinisherClip(): boolean {
    return this.finisherAction !== null;
  }

  /** Dev-only bone access, used for visual experiments in the browser. */
  boneFor(key: import('./Rig').BoneKey) {
    return this.rig?.get(key) ?? null;
  }

  get rigReady(): boolean {
    return this.rig !== null && this.rig.resolvedCount > 12;
  }

  /**
   * Begins a committed strike toward `lane`.
   *
   * `move` chooses the animation: an explicit index, `'flashy'` for the showy
   * half of the set (Perfects, and the reel's big beats), or nothing for the
   * grounded rotation. The set rotates rather than picking at random so the
   * same move never repeats twice running — the hero looks like a fighter with
   * a repertoire instead of one animation on a loop.
   */
  attack(lane: Lane, connects: boolean, flow = false, move?: string | 'flashy'): void {
    this.state = flow ? 'flowStrike' : connects ? 'attack' : 'whiff';
    this.phase = 0;
    this.detailLayer.reset();
    this.clearContact(false);
    this.move = connects && !flow ? this.pickMove(move) : MOVES[0];
    this.firedEvents.clear();
    this.rootHeld = false;
    const speed = connects && !flow ? (this.move.speed ?? 1) : 1;
    // The animation outlives the commitment window on purpose — see
    // ATTACK.animScale. Control returns on time; the body finishes the move.
    this.duration =
      (flow
        ? ATTACK.total * ATTACK.flowAnimScale
        : connects
          ? ATTACK.total * ATTACK.animScale
          : ATTACK.total * ATTACK.whiffRecoveryScale * ATTACK.animScale) * speed;
    this.moveDir = lane === 'left' ? -1 : 1;
    this.facingTarget = this.moveDir * (Math.PI / 2);
    if (this.move.root) this.locomotionAction?.reset().play();
    // The lunge is what stops the hero looking rooted: the body commits toward
    // the threat and is pulled back afterwards rather than teleporting. A move
    // carrying its own root motion owns its displacement outright, so the two
    // never fight each other.
    const reach = connects && !flow ? (this.move.reach ?? 1) : 1;
    this.lungeTarget = this.move.root
      ? 0
      : this.moveDir * ATTACK.lungeDistance * (flow ? 1.5 : 1) * reach;
  }

  private pickMove(choice?: string | 'flashy'): Move {
    if (choice && choice !== 'flashy') return moveById(choice);
    if (choice === 'flashy') {
      const id = FLASHY_IDS[this.flashyCursor % FLASHY_IDS.length];
      this.flashyCursor += 1;
      return moveById(id);
    }
    const id = BASIC_IDS[this.basicCursor % BASIC_IDS.length];
    this.basicCursor += 1;
    return moveById(id);
  }

  /** The move currently playing — the reel reads it to time its own effects. */
  get currentMove(): Move {
    return this.move;
  }

  /**
   * Timed cues the playing move has reached since the last call: a blade
   * leaving the hand, a landing shockwave, dust off a slide. Drained rather
   * than dispatched so effects stay owned by the caller.
   */
  drainEvents(): MoveEventKind[] {
    const out = this.pendingEvents.slice();
    this.pendingEvents.length = 0;
    return out;
  }

  /** Physical contacts reached by the animated striking bone since last frame. */
  drainContacts(): PlayerContactEvent[] {
    const out = this.pendingContacts.slice();
    this.pendingContacts.length = 0;
    return out;
  }

  /** Arms a world-space body target after the move has been selected. */
  setContactTarget(target: { x: number; y: number; z: number }, radius = CONTACT.bodyRadius): void {
    this.contactTarget.set(target.x, target.y, target.z);
    this.contactTargetRadius = radius;
    this.contactActive = this.state === 'attack';
    this.contactEmitted = false;
    this.effectorStarted = false;
  }

  /** Applies the attacker's half of the same impulse that launched the target. */
  applyContactRecoil(impulse: ContactImpulse): void {
    this.rootRecoil.impulse(impulse.recoil.x * 0.45);
    const backward = -impulse.recoil.x * this.moveDir;
    this.bodyRecoil.impulse(backward * 0.7 + Math.abs(impulse.recoil.y) * 0.08);
  }

  /**
   * Turns the hero toward a lane without starting an attack.
   *
   * Flow asks for a direction, so the hero's own body is part of the answer:
   * he squares up to the target the chain wants next.
   */
  look(lane: Lane | null): void {
    this.idleFacing = lane === null ? 0 : (lane === 'left' ? -1 : 1) * (Math.PI / 2) * 0.75;
  }

  hurt(fromLane: Lane): void {
    this.rootHeld = false;
    this.state = 'hurt';
    this.phase = 0;
    this.detailLayer.reset();
    this.clearContact();
    this.duration = 0.55;
    this.facingTarget = fromLane === 'left' ? -Math.PI / 2 : Math.PI / 2;
    this.lungeTarget = (fromLane === 'left' ? 1 : -1) * 0.34;
    this.move = MOVES[0];
  }

  ko(): void {
    this.rootHeld = false;
    this.state = 'ko';
    this.phase = 0;
    this.detailLayer.reset();
    this.clearContact();
    this.duration = 0.9;
    this.lungeTarget = 0;
    this.move = MOVES[0];
  }

  /** Plays the authored finisher clip; falls back to the procedural strike. */
  finisher(lane: Lane, seconds: number): void {
    this.rootHeld = false;
    this.state = 'finisher';
    this.phase = 0;
    this.detailLayer.reset();
    this.clearContact();
    this.duration = seconds;
    this.facingTarget = lane === 'left' ? -Math.PI / 2 : Math.PI / 2;
    this.lungeTarget = (lane === 'left' ? -1 : 1) * ATTACK.lungeDistance * 1.9;
    this.move = MOVES[0];
    if (this.finisherAction) {
      const clip = this.finisherAction.getClip();
      this.finisherAction.reset();
      this.finisherAction.timeScale = clip.duration / seconds;
      this.finisherAction.setEffectiveWeight(1);
      this.finisherAction.play();
    }
  }

  reset(): void {
    this.state = 'idle';
    this.phase = 0;
    this.lungeX = 0;
    this.lungeTarget = 0;
    this.facing = 0;
    this.facingTarget = 0;
    this.finisherAction?.stop();
    this.move = MOVES[0];
    this.rootHeld = false;
    this.idleFacing = 0;
    this.inertia.reset(0, 0);
    this.clothInertia.reset(0, 0);
    this.torsoLag.reset();
    this.headLag.reset();
    this.bodyLean = 0;
    this.landingCompression = 0;
    this.lastRootX = 0;
    this.lastRootY = 0;
    this.detailLayer.reset();
    this.clearContact();
    this.firedEvents.clear();
    this.pendingEvents.length = 0;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  /** True while the player is committed and cannot start another action. */
  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'ko' ? this.phase < 1 : false;
  }

  get isDown(): boolean {
    return this.state === 'ko';
  }

  get worldX(): number {
    return this.root.position.x;
  }

  update(dt: number): void {
    if (this.duration > 0 && this.state !== 'idle') {
      this.phase = Math.min(1, this.phase + dt / this.duration);
      // KO holds its final pose; everything else returns to idle on completion.
      if (this.phase >= 1 && this.state !== 'ko') {
        // A travelling move leaves the hero where it put him.
        if (this.state === 'attack' && this.move.root) this.rootHeld = true;
        this.state = 'idle';
        this.facingTarget = 0;
        this.lungeTarget = 0;
        this.finisherAction?.stop();
      }
    }

    if (!this.contactActive) {
      this.contactWarp = MathUtils.damp(this.contactWarp, 0, CONTACT.warpRelease, dt);
    }
    const recoilX = this.rootRecoil.step(0, dt);

    // Lunge springs out fast and is pulled home smoothly.
    const towards = this.state === 'idle' ? 0 : this.lungeTarget * lungeCurve(this.phase);
    this.lungeX = MathUtils.damp(this.lungeX, towards, ATTACK.lungeReturn, dt);
    this.root.position.x = this.lungeX + this.contactWarp + recoilX;

    // Root motion: travel, height and root rotation authored with the move and
    // mirrored to the side it is played on. This is what lets a move slide
    // under a body, vault over one, or flip out backwards.
    const rooted = (this.state === 'attack' || this.rootHeld) && this.move.root !== undefined;
    if (rooted) {
      sampleRoot(this.move.root, this.rootHeld ? 1 : this.phase, this.rootSample);
      this.root.position.x = this.lungeX + this.moveDir * this.rootSample.x + this.contactWarp + recoilX;
      this.root.position.y = this.rootSample.y;
    } else {
      this.root.position.y = 0;
    }

    if (this.state === 'attack' && this.move.events) {
      for (let i = 0; i < this.move.events.length; i++) {
        const ev = this.move.events[i];
        if (this.phase >= ev.t && !this.firedEvents.has(i)) {
          this.firedEvents.add(i);
          this.pendingEvents.push(ev.kind);
        }
      }
    }

    const facingRest = this.rootHeld ? this.facingTarget : this.idleFacing;
    this.facing = MathUtils.damp(
      this.facing,
      this.state === 'idle' ? facingRest : this.facingTarget,
      14,
      dt,
    );
    if (rooted) {
      this.root.rotation.set(
        this.rootSample.rot[0],
        this.facing + this.moveDir * this.rootSample.rot[1],
        this.moveDir * this.rootSample.rot[2],
      );
    } else {
      this.root.rotation.set(0, this.facing, 0);
    }

    // The idle clip fades out under a finisher (which is authored full-body)
    // but stays alive under procedural strikes so breathing continues.
    const idleTarget = this.state === 'finisher' && this.finisherAction ? 0 : 1;
    this.idleWeight = MathUtils.damp(this.idleWeight, idleTarget, 12, dt);
    this.idleAction?.setEffectiveWeight(this.idleWeight);

    // Travelling moves get a quiet rotation-only run layer underneath their
    // key poses. It supplies planted feet and limb follow-through without
    // compromising the authored root path or combat timing.
    const travelling = this.state === 'attack' && this.move.root && Math.abs(this.rootSample.x) > 0.05;
    const locomotionTarget = travelling ? 0.28 : 0;
    this.locomotionWeight = MathUtils.damp(this.locomotionWeight, locomotionTarget, 10, dt);
    this.locomotionAction?.setEffectiveWeight(this.locomotionWeight);

    // The mixer must always start from an unmodified pose. This makes the
    // procedural layer frame-rate independent even if a future character has
    // no idle animation (or leaves a joint unkeyed in that animation).
    this.rig?.restoreBasePose();
    this.mixer?.update(dt);

    if (!this.rig) return;
    this.rig.captureBasePose();
    this.rig.readAnimationPose(MOTION_SOURCE_KEYS, this.mixerPose);
    // Mixer rotations are already on the source bones. Apply only their helper
    // correction here, otherwise the imported animation would be doubled.
    this.rig.applyTwistAssist(this.mixerPose, 1);
    const track = this.trackFor();
    let proceduralWeight = 0;
    if (track) {
      sample(track, this.phase, this.pose);
      this.applyInertia(dt);
      // Ease the additive layer in and out so a strike never pops on frame one.
      proceduralWeight = this.state === 'ko' ? 1 : this.state === 'finisher' ? 0.35 : 1;
      this.rig.applyPose(this.pose, proceduralWeight);
    }
    // Feed the actual mixer result and the contact-critical combat layer into
    // one dynamics source. Idle breathing, run cycles and authored finishers
    // now drive the added helpers even when no procedural track is active.
    combineMotionPoses(this.mixerPose, track ? this.pose : null, proceduralWeight, this.motionPose);
    const detailWeight = this.state === 'ko' ? 0 : this.state === 'finisher' ? 0.55 : 1;
    this.rig.applyPose(this.detailLayer.update(this.motionPose, dt, detailWeight), 1);
    this.applySecondaryMotion(dt);
    this.applyContactWarp(dt);
    this.updateCloth(dt);
  }

  /** Cloth trails the hero's own motion, on its own tracker. See `wardrobe`. */
  private updateCloth(dt: number): void {
    if (!this.wardrobe) return;
    this.clothInertia.step(this.root.position.x, this.root.position.y, dt);
    const facing = Math.cos(this.facing) >= 0 ? 1 : -1;
    this.wardrobe.update(dt, this.clothInertia.accelX, this.clothInertia.accelY, facing);
  }

  /**
   * Small physically-motivated overlaps layered after the authored pose:
   * acceleration leans the mass, the gaze leads a turn, and downward velocity
   * compresses the lower body before springing back. These remain subtle so
   * contact keys and gameplay silhouettes stay exact.
   */
  private applySecondaryMotion(dt: number): void {
    if (!this.rig || this.state === 'ko') return;
    const safeDt = Math.max(1 / 240, dt);
    const horizontalSpeed = Math.abs((this.root.position.x - this.lastRootX) / safeDt);
    const verticalSpeed = (this.root.position.y - this.lastRootY) / safeDt;
    this.lastRootX = this.root.position.x;
    this.lastRootY = this.root.position.y;

    const leanTarget = clamp(-horizontalSpeed * 0.022, -0.13, 0);
    this.bodyLean = MathUtils.damp(this.bodyLean, leanTarget, 11, dt);
    const landingTarget =
      verticalSpeed < -0.7 && this.root.position.y < 0.42
        ? clamp((-verticalSpeed - 0.7) * 0.024, 0, 0.2)
        : 0;
    this.landingCompression = MathUtils.damp(
      this.landingCompression,
      landingTarget,
      landingTarget > this.landingCompression ? 18 : 8,
      dt,
    );

    const turnError = wrapAngle(this.facingTarget - this.facing);
    const gazeLead = clamp(turnError * 0.18, -0.22, 0.22);
    const toeRoll = clamp(horizontalSpeed * 0.018, 0, 0.14);
    const compression = this.landingCompression;
    const recoil = this.bodyRecoil.step(0, dt);
    this.secondaryPose.hips = [this.bodyLean - recoil * 0.24, 0, 0];
    this.secondaryPose.spine = [this.bodyLean * 0.62 - recoil * 0.62, -turnError * 0.035, 0];
    this.secondaryPose.chest = [this.bodyLean * 0.34 - recoil * 0.46, -turnError * 0.025, 0];
    this.secondaryPose.neck = [-this.bodyLean * 0.22, gazeLead * 0.42, 0];
    this.secondaryPose.head = [-this.bodyLean * 0.34 - recoil * 0.34, gazeLead * 0.58, 0];
    this.secondaryPose.armR = [-recoil * 0.16, 0, recoil * 0.22];
    this.secondaryPose.armL = [-recoil * 0.12, 0, -recoil * 0.18];
    this.secondaryPose.upLegL = [compression * 0.38, 0, 0];
    this.secondaryPose.upLegR = [compression * 0.38, 0, 0];
    this.secondaryPose.legL = [-compression, 0, 0];
    this.secondaryPose.legR = [-compression, 0, 0];
    this.secondaryPose.footL = [compression * 0.46, 0, 0];
    this.secondaryPose.footR = [compression * 0.46, 0, 0];
    this.secondaryPose.toeL = [toeRoll, 0, 0];
    this.secondaryPose.toeR = [toeRoll, 0, 0];
    this.rig.applyPose(this.secondaryPose, 1);
  }

  /**
   * Warps only inside the approach-to-contact window, using the animated bone
   * itself as the measurement. Different animal proportions therefore change
   * the correction automatically instead of requiring per-character offsets.
   */
  private applyContactWarp(dt: number): void {
    if (!this.rig || !this.contactActive || this.contactEmitted) return;
    const profile = contactProfileFor(this.move);
    const effector = this.rig.get(profile.effector);
    if (!effector) {
      if (this.phase >= this.move.contactAt) this.emitFallbackContact();
      return;
    }

    effector.getWorldPosition(this.effectorPosition);
    const targetSurfaceX = this.contactTarget.x - this.moveDir * this.contactTargetRadius;
    const tipX = this.effectorPosition.x + this.moveDir * profile.reach;
    const start = Math.max(0, this.move.contactAt - CONTACT.warpWindow);
    const warpWeight = smoothstep((this.phase - start) / Math.max(1e-5, this.move.contactAt - start));
    const desiredWarp = clamp(
      this.contactWarp + (targetSurfaceX - tipX),
      -CONTACT.maxWarp,
      CONTACT.maxWarp,
    );
    const previousWarp = this.contactWarp;
    this.contactWarp += (desiredWarp - this.contactWarp) * warpWeight;
    this.root.position.x += this.contactWarp - previousWarp;

    // Re-sample after moving the root: this is the point that visibly touches.
    effector.getWorldPosition(this.effectorPosition);
    const safeDt = clamp(dt, 1 / 240, 1 / 20);
    const vx = this.effectorStarted ? (this.effectorPosition.x - this.previousEffector.x) / safeDt : 0;
    const vy = this.effectorStarted ? (this.effectorPosition.y - this.previousEffector.y) / safeDt : 0;
    const vz = this.effectorStarted ? (this.effectorPosition.z - this.previousEffector.z) / safeDt : 0;
    this.previousEffector.copy(this.effectorPosition);
    this.effectorStarted = true;

    if (this.phase < this.move.contactAt) return;
    this.contactEmitted = true;
    this.contactActive = false;
    this.pendingContacts.push({
      moveId: this.move.id,
      point: {
        x: this.effectorPosition.x + this.moveDir * profile.reach,
        y: this.effectorPosition.y,
        z: this.effectorPosition.z,
      },
      velocity: {
        x: Math.abs(vx) > 0.2 ? vx : this.moveDir * CONTACT.minEffectorSpeed,
        y: vy,
        z: vz,
      },
    });
  }

  private emitFallbackContact(): void {
    this.contactEmitted = true;
    this.contactActive = false;
    this.pendingContacts.push({
      moveId: this.move.id,
      point: {
        x: this.contactTarget.x - this.moveDir * this.contactTargetRadius,
        y: this.contactTarget.y,
        z: this.contactTarget.z,
      },
      velocity: { x: this.moveDir * CONTACT.minEffectorSpeed, y: 0, z: 0 },
    });
  }

  private clearContact(clearQueued = true): void {
    this.contactActive = false;
    this.contactEmitted = false;
    this.effectorStarted = false;
    this.contactWarp = 0;
    this.rootRecoil.reset();
    this.bodyRecoil.reset();
    if (clearQueued) this.pendingContacts.length = 0;
  }

  /**
   * Folds body lag into the pose the move just produced.
   *
   * Applied on the additive layer, so it composes with every authored move
   * rather than fighting one: the spine leans back out of an acceleration and
   * catches up afterwards, and the head follows a beat later than the chest.
   */
  private applyInertia(dt: number): void {
    this.inertia.step(this.root.position.x, this.root.position.y, dt);
    const raw = -this.inertia.accelX * PHYSICS.heroLagPerAccel;
    const target =
      raw < -PHYSICS.heroMaxLag ? -PHYSICS.heroMaxLag : raw > PHYSICS.heroMaxLag ? PHYSICS.heroMaxLag : raw;
    // Authored in world space, applied in the hero's own space: a lean is
    // toward the world direction he came from whichever way he is facing.
    const facing = Math.cos(this.facing) >= 0 ? 1 : -1;
    const torso = this.torsoLag.step(target, dt) * facing;
    const head = this.headLag.step(target, dt) * facing;
    if (Math.abs(torso) < 1e-4 && Math.abs(head) < 1e-4) return;

    addPose(this.pose, 'spine', 0, 0, torso * 0.9);
    addPose(this.pose, 'chest', 0, 0, torso * 0.6);
    addPose(this.pose, 'head', 0, 0, head * 1.1);
  }

  private trackFor() {
    switch (this.state) {
      case 'attack':
        return this.move.track;
      case 'whiff':
        return WHIFF;
      case 'flowStrike':
      case 'finisher':
        return FLOW_STRIKE;
      case 'hurt':
        return HURT;
      case 'ko':
        return KO;
      default:
        return null;
    }
  }
}

/** Adds an euler offset onto whatever the move already asked of a bone. */
function addPose(pose: Pose, key: 'spine' | 'chest' | 'head', x: number, y: number, z: number): void {
  const current = pose[key];
  if (current) pose[key] = [current[0] + x, current[1] + y, current[2] + z];
  else pose[key] = [x, y, z];
}

/** Out fast, hold through impact, then home. Mirrors the attack phase split. */
function lungeCurve(t: number): number {
  if (t < 0.28) return t / 0.28;
  if (t < 0.6) return 1;
  return Math.max(0, 1 - (t - 0.6) / 0.4);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Removes model-space translation/scale from a locomotion clip. */
function rotationOnlyClip(clip: AnimationClip): AnimationClip {
  return new AnimationClip(
    `${clip.name}:rotation-only`,
    clip.duration,
    clip.tracks.filter((track) => track.name.endsWith('.quaternion')).map((track) => track.clone()),
  );
}
