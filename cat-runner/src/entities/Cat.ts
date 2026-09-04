import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { CatSkinId } from '../game/SaveManager';
import { DEFAULT_CAT_SKIN } from './CatSkins';
import { PlayerState } from '../physics/PlayerController';
import { PHYSICS, capsuleFeetOffset } from '../physics/PhysicsConfig';
import { CAT_CLIP_NAMES, type CatClipName } from './CatAnimations';
import type { PowerUpType } from '../levels/procedural/ChunkTypes';
import { POWERUP_COLOR } from '../levels/procedural/PlaceholderAssets';
import {
  buildCatnipPickupModel,
  buildMagnetModel,
  disposeIfOwned,
} from '../levels/procedural/PowerUpModels';

/**
 * Emissive tint shown on the cat's own materials while a power-up is active -
 * additive to the existing floating glow icon above the cat's head (that
 * signals *which* type; this signals *the cat is currently affected*).
 * Colours are pulled from `PlaceholderAssets.POWERUP_COLOR` so the tint
 * always matches the pickup/icon colour for the same type. Every
 * `PowerUpType` gets an entry so future additions only need a colour, not a
 * second lookup table to remember to update.
 */
const POWERUP_TINT: Readonly<Record<PowerUpType, { color: number; intensity: number }>> = {
  shield: { color: POWERUP_COLOR.shield, intensity: 0.55 },
  catnipRush: { color: POWERUP_COLOR.catnipRush, intensity: 0.4 },
  fishMagnet: { color: POWERUP_COLOR.fishMagnet, intensity: 0.35 },
  nineLives: { color: POWERUP_COLOR.nineLives, intensity: 0.35 },
};
/** How fast the emissive tint breathes, so an active effect reads as "alive"
 *  rather than a flat paint job - same idea as the invulnerability flash,
 *  just far gentler (this isn't a warning). */
const POWERUP_PULSE_HZ = 1.4;

/**
 * Shield's translucent bubble. Radius is sized to comfortably enclose the
 * cat's body without hugging it (a shield reads as protection, not a second
 * skin). Opacity fades out as `remainingFrac` runs down, on top of a gentle
 * pulse so it reads as "glowing" rather than a flat, static shell.
 */
const SHIELD_SPHERE_RADIUS = 0.62;
const SHIELD_MAX_OPACITY = 0.32;
const SHIELD_PULSE_HZ = 0.9;
const SHIELD_SPIN_RATE = 0.4;
/** Local Y the shield sphere parks at while inactive - same "move it well
 *  out of the way" convention `PowerUpPool`/`FishPool` use (their PARK_Y),
 *  needed because `visible = false` alone does not exclude a mesh from
 *  `THREE.Box3.setFromObject()` (several tests bounding-box `cat.root`, and
 *  it does not check `.visible`), and a mesh at the origin - even scaled to
 *  0 - still contributes its (transformed) position as a degenerate point. */
const SHIELD_SPHERE_PARK_Y = -50;

/** How far above the cat's own head the Fish Magnet prop floats, and how
 *  fast it spins - same parking convention as the shield sphere above. */
const MAGNET_PROP_HEIGHT = 0.68;
const MAGNET_SPIN_RATE = 1.1;
const MAGNET_PARK_Y = -50;

/** See `attachSneakers()`'s own doc comment - scales the Catnip Rush shoe
 *  model down from its pickup-tuned size to roughly the previous procedural
 *  sneaker's own footprint, so it fits the paw rather than the world. */
const EQUIPPED_SHOE_SCALE = 0.7;

/**
 * The provided Jordan model's own toe points along its local -X, not +Z -
 * found by inspecting the raw mesh (`public/assets/items/catnipRush.obj`)
 * rather than guessing: bucketing its vertices along X shows the -X end
 * staying low and narrow (a toe, tapered and close to the ground) while the
 * +X end flares up to the model's full height (a heel/ankle collar) - and
 * the cat rig's own local forward is +Z (see `attachFish()`'s identical
 * `(0,0,1).applyQuaternion(modelQuat)` a few methods down). Rotating -X
 * onto +Z takes +90 deg (pi/2) of yaw. See `attachSneakers()` for where
 * this gets applied - only to the provided model, never the procedural
 * fallback sneaker, which was already authored facing the rig's own +Z.
 */
const JORDAN_TOE_CORRECTION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI / 2,
);

/**
 * Visual cat.
 *
 * Skeletal animation comes from the clip set built in CatAnimations - gallop,
 * idle, jump, fall, land, stumble - blended by the little state machine in
 * {@link Cat.updateAnimation}. Everything the design asks for on top of that -
 * steering lean, tail response, landing squash - is layered procedurally after
 * the mixer has written its pose.
 *
 * Layering happens in two places:
 *
 *   - Whole-body attitude (lean, pitch, squash) is applied to a wrapper Group,
 *     so it composes with the skeletal animation without fighting it.
 *   - Tail sway writes directly to the tail bone chain, overwriting whatever
 *     the mixer put there. That is why no clip animates the tail.
 *
 * The fallback rig (`cat.fbx`) has neither semantic bone names nor this clip
 * set, so both bone lookup and clip selection degrade: bones are found by
 * geometry, and a lone "walk" clip stands in for the whole state machine.
 */

/**
 * Rig-space yaw correction so the cat's nose points along +Z.
 *
 * Both rigs already face +Z, which is the controller's forward and the
 * direction every level's route runs, so no correction is needed. This was
 * previously PI, which ran the cat rear-first down the whole game and - because
 * the head and tail are located by *geometry* on the fallback rig, not by name -
 * also swapped which end `findHeadBone` and `findTailChain` returned.
 */
const MODEL_YAW_OFFSET = 0;

/** Flash cycles per second while invulnerable. */
const FLASH_HZ = 5;

/**
 * Ground covered by one full stride of the `run` clip at timeScale 1.
 *
 * The gallop is played back at whatever rate makes the paws keep up with the
 * ground, and this is the constant that converts one into the other. Too low
 * and the cat skates; too high and it pedals.
 *
 * 2.0 pedalled: at `runSpeed` 11 it demanded 5.5 strides a second, which no
 * gait reads as - the legs blurred and the cycle's own detail was invisible.
 * 3.4 puts it at 3.2 strides/s, a hard sprint rather than a vibration, and the
 * playback rate lands at 1.29 in the comfortable middle of RUN_RATE_RANGE.
 */
const RUN_STRIDE_DISTANCE = 3.4;
/** Playback rate limits, so a stopped or teleporting cat still animates sanely. */
const RUN_RATE_RANGE: readonly [number, number] = [0.35, 3.2];
/** Ground speed below which the cat is considered standing still. */
const IDLE_SPEED = 0.6;
/** Ground speed the idle<-run transition falls back at, once already running.
 *  Below IDLE_SPEED so hovering right at the threshold (braking, stumble
 *  recovery) can't retarget the blend every single frame - the run/idle
 *  choice needs to cross a band, not a point, before it flips back. */
const IDLE_SPEED_EXIT = IDLE_SPEED * 0.5;

/**
 * How fast blend weights chase their target, 1/s.
 *
 * Fast, because the one-shots are short: `land` is over in a third of a second,
 * so a leisurely blend would still be fading it in as it finished.
 */
const BLEND_RATE = 22;

/**
 * How fast the run clip's stride rate chases its target, 1/s.
 *
 * Every other cosmetic value here (lean, pitch, duck) eases toward its
 * target; the stride rate used to be assigned outright from
 * `input.horizontalSpeed`, which only changes on fixed-step boundaries and
 * can step abruptly (lane-seek correction, a friction change, a wall-probe
 * deceleration) - the leg cycle's playback rate visibly jumped frame to
 * frame instead of ramping, reading as a stutter independent of any blend
 * weight. Fast enough to still track a real acceleration within a few
 * frames, slow enough to absorb single-step noise.
 */
const RUN_RATE_SMOOTH = 14;

/**
 * Peak height of the little hop that punctuates a lane change.
 *
 * Cosmetic, and deliberately so. A real impulse would break ground contact,
 * flip `grounded` false for a few frames and hand the clip selector `fall`
 * halfway through every dodge - as well as tangling with the jump latch and
 * the coyote timer. Lifting the model instead costs nothing and cannot desync
 * from the physics, because the physics never knows it happened.
 */
const LANE_HOP_HEIGHT = 0.12;

/**
 * How far the model drops while ducking, on top of the clip's own tuck.
 *
 * Cosmetic in the same way the lane hop is - the capsule never changes size,
 * and whether the duck *worked* is decided by `PlayerController.isDucking`, not
 * by where the model happens to be drawn. This exists so the answer looks like
 * the answer: the cloth's bottom edge sits 0.55 above the roof, and a cat drawn
 * at its full standing height while passing under it would read as a bug even
 * on a run the player got right.
 *
 * This translates the whole model, feet included - `groundOffset`'s origin is
 * the model's own ground-contact point, aligned with the capsule's fixed
 * bottom when this is 0. It used to be 0.28, which put that point 0.28 below
 * the capsule's actual (unmoved) contact with the roof, sinking the cat's
 * paws into the geometry for the whole duck. Kept small and non-zero rather
 * than dropped to 0: some silhouette lowering still reads correctly under the
 * clothesline, and the clip's own crouch (joint rotations only, no root
 * motion - see `rotationOnly()` in `CatAnimations.ts`) is doing the rest of
 * that work independent of this offset.
 */
const DUCK_DROP = 0.1;

/** Damping rate for the duck blend. Fast enough to look like a reaction. */
const DUCK_BLEND_RATE = 18;
/** Stretch applied at the top of the hop, fed into the existing squash spring. */
const LANE_HOP_STRETCH = 1.06;

/**
 * Largest step the squash spring may be integrated over.
 *
 * Has to stay under `2 / damping` (1/12 s) for the integration to be stable at
 * all, and well under it for the result to match what a 60 fps frame produces.
 * One 60 Hz step is both.
 */
const SQUASH_STEP = 1 / 60;
/**
 * Ceiling on how much simulated time one call may integrate, which bounds the
 * sub-step loop at 15 iterations.
 *
 * `Game` already clamps its frame delta to 0.1, but `update()` is public and
 * the tests drive it directly, so the loop cannot rely on the caller.
 */
const SQUASH_MAX_INTEGRATION = 0.25;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _euler = new THREE.Euler();

export interface CatVisualInput {
  /** Cat world position from the physics body. */
  position: THREE.Vector3;
  /** Cat body orientation from the physics body. */
  rotation: THREE.Quaternion;
  /** World velocity. */
  velocity: THREE.Vector3;
  horizontalSpeed: number;
  /** Signed sideways slip; drives the lean. */
  lateralSlip: number;
  /** Raw steering input, -1..1. */
  steer: number;
  grounded: boolean;
  state: PlayerState;
  /** True while the cat is tucked under something. */
  ducking: boolean;
}

export class Cat {
  /** Root added to the scene. Follows the physics body exactly. */
  readonly root = new THREE.Group();
  /**
   * Drops the model from the capsule centre onto its feet. Kept as its own node
   * so `root` stays a pure copy of the physics transform and `attitude` stays a
   * pure pose offset.
   */
  private groundOffset = new THREE.Group();
  /** Wrapper that carries the procedural attitude offsets. */
  private attitude = new THREE.Group();
  private model: THREE.Object3D | null = null;

  private mixer: THREE.AnimationMixer | null = null;
  /** Every clip the loaded rig offers, all playing, most at zero weight. */
  private actions = new Map<CatClipName, THREE.AnimationAction>();
  private blend = new Map<CatClipName, number>();
  /** Seconds left before a one-shot releases the state machine. */
  private oneShot: { clip: CatClipName; remaining: number } | null = null;
  /**
   * Overrides the locomotion state machine outright while set.
   *
   * For the non-gameplay contexts that need the cat to be *doing something* -
   * the attract screen behind the main menu, where it sits on the roof eating
   * its fish (`Game.startAttract()`), the way Subway Surfers' menu character
   * is mid-graffiti. Those contexts drive the cat by hand: they hold its
   * position still and feed `update()` a zero-velocity, grounded input, which
   * `selectClip` would otherwise read as "standing about" and answer with
   * `idle`. Rather than inventing fake velocity to trick the selector, they
   * name the clip.
   *
   * Deliberately outranks even a one-shot: nothing in an attract loop should
   * be able to interrupt it, and `Game` clears it (back to null) the moment a
   * real run starts.
   */
  showcaseClip: CatClipName | null = null;
  /**
   * False when the loaded rig is the fallback, which has one nameless walk cycle
   * and nothing to blend between.
   */
  private hasClipSet = false;

  private tailBones: THREE.Bone[] = [];
  private tailRestQuats: THREE.Quaternion[] = [];

  private fish: THREE.Object3D | null = null;

  // Smoothed procedural state.
  private leanAngle = 0;
  private pitchAngle = 0;
  private squash = 1;
  private squashVelocity = 0;
  private tailPhase = 0;
  private tailSway = 0;
  /** Seconds left in the lane-change hop, and how long it was given. */
  private hopTimer = 0;
  private hopDuration = 0;
  /** 0 standing, 1 fully tucked. Eased towards the controller's duck flag. */
  private duckBlend = 0;
  /** Last frame's duck flag, so the tuck can be rewound on the rising edge. */
  private wasDucking = false;
  /** Whether `selectClip` currently considers the cat "running" - see
   *  IDLE_SPEED_EXIT for why this needs its own hysteresis state. */
  private wasRunning = false;

  private skinTexture: THREE.Texture | null = null;
  /**
   * Whether the model has the UV layout the pack's coats are authored against.
   *
   * False on the procedural fallback cat, which is a stack of boxes - mapping a
   * fur atlas onto it would smear a nose across its flank.
   */
  private skinnable = false;
  private materials: THREE.MeshLambertMaterial[] = [];
  /** Authored opacity of each material, so the flash restores rather than guesses. */
  private baseOpacities: number[] = [];
  /**
   * The carried fish's own materials, tracked separately from `materials` so
   * `setSkin()` - which only ever writes `.map` on `materials` - can never
   * paint the fish with the cat's coat texture. The flash still needs to
   * reach the fish (see the comment in `load()`), so these mirror
   * `materials`/`baseOpacities` through `setInvulnerable`/`updateInvulnerability`
   * and cleanup, just never through skinning or power-up tinting.
   */
  private fishMaterials: THREE.MeshLambertMaterial[] = [];
  private fishBaseOpacities: number[] = [];

  // --- Invulnerability flash ---
  private invulnerable = false;
  private flashPhase = 0;
  /** Set from the accessibility settings; holds a steady ghost instead of strobing. */
  reducedMotion = false;

  // --- Power-up emissive tint ---
  private activePowerUps: readonly PowerUpType[] = [];
  /** Cheap change-detection key so `setActivePowerUps` (called every frame
   *  from `Game.ts`) only touches materials on an actual change. */
  private activePowerUpsKey = '';
  private powerUpPulsePhase = 0;

  // --- Shield sphere ---
  /** Built in the constructor (not `load()`) so it works even if the rig
   *  fails to load and falls back to the primitive cat - this is core
   *  gameplay feedback, not a rig-dependent cosmetic. Parented directly to
   *  `root` rather than `attitude`, so the squash/lean pose doesn't stretch
   *  or tilt what should read as a stable bubble around the whole cat. */
  private shieldSphere: THREE.Mesh;
  private shieldRemainingFrac = 0;
  private shieldPulsePhase = 0;

  // --- Catnip Rush sneakers ---
  /** One prop per found foot bone, built once at load and toggled visible -
   *  see `attachSneakers()`. Empty if the rig has no feet to attach to. */
  private sneakers: THREE.Object3D[] = [];
  private sneakersActive = false;

  // --- Fish Magnet prop ---
  /** Floats above the head while Fish Magnet is active. Built in the
   *  constructor for the same reason the shield sphere is - rig-independent
   *  gameplay feedback - and parented to `root` rather than `attitude` so
   *  it doesn't inherit the squash/lean pose. */
  private magnetProp: THREE.Group;
  private magnetActive = false;
  private magnetSpinPhase = 0;

  constructor(private registry: AssetRegistry) {
    this.root.add(this.groundOffset);
    this.groundOffset.add(this.attitude);
    this.groundOffset.position.y = -capsuleFeetOffset();

    this.shieldSphere = new THREE.Mesh(
      new THREE.SphereGeometry(SHIELD_SPHERE_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({
        color: POWERUP_COLOR.shield,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.shieldSphere.visible = false;
    this.shieldSphere.position.y = SHIELD_SPHERE_PARK_Y;
    this.root.add(this.shieldSphere);

    this.magnetProp = buildMagnetModel();
    this.magnetProp.visible = false;
    this.magnetProp.position.y = MAGNET_PARK_Y;
    this.root.add(this.magnetProp);
  }

  async load(skin: CatSkinId = DEFAULT_CAT_SKIN): Promise<void> {
    await this.registry.loadCat();

    const model = this.registry.getSkinnedModel('cat');
    if (!model) {
      // The game must still be playable if the rig fails to load.
      this.model = buildFallbackCat();
      this.attitude.add(this.model);
      // Collected so the invulnerability flash works on the fallback too. It
      // used to return before this, which meant a cat that had failed to load
      // its rig also silently failed to flash.
      this.collectMaterials(this.model);
      return;
    }

    model.rotation.y = MODEL_YAW_OFFSET;
    this.model = model;
    this.skinnable = true;
    this.attitude.add(model);

    this.collectMaterials(model);

    this.buildActions(model);

    this.tailBones = findTailChain(model);
    this.tailRestQuats = this.tailBones.map((b) => b.quaternion.clone());

    this.fish = buildFish();
    this.attachFish(model);
    // The fish is built after the rig traverse, so it has to be collected
    // separately or it stays fully opaque while the rest of the cat flashes.
    // It goes into its own arrays, not `materials` - see the field comment on
    // `fishMaterials` for why.
    this.collectMaterials(this.fish, this.fishMaterials, this.fishBaseOpacities);

    this.attachSneakers(model);

    await this.setSkin(skin);
  }

  /**
   * Creates one action per available clip and starts them all.
   *
   * Every action runs continuously and the state machine only moves *weights*.
   * That costs a handful of extra pose evaluations per frame and buys the thing
   * crossfade bookkeeping keeps getting wrong: there is no "currently playing"
   * variable to fall out of step with what the mixer is actually doing, so a
   * jump interrupted by a landing interrupted by a stumble cannot strand the cat
   * mid-pose.
   */
  private buildActions(model: THREE.Object3D): void {
    const clips = this.registry.getClips('cat');
    if (clips.length === 0) return;

    this.mixer = new THREE.AnimationMixer(model);

    for (const clip of clips) {
      const name = clip.name as CatClipName;
      const action = this.mixer.clipAction(clip);
      // These end on a pose the next state wants to blend out of rather than
      // snap away from.
      //
      // `slide` is here for a different reason from the others. It is
      // selected by *state* rather than fired as a one-shot - the duck is a
      // pose the cat holds - and a looping clip would visibly restart if the
      // take is shorter than `slideDuration`, which is a rewind in the middle
      // of the one input the player is watching most closely. Clamped, it
      // reaches the tuck and stays there; {@link onDuck} rewinds it on the
      // press so each duck plays from the top. `jump`/`land`/`stumble` are
      // the genuine one-shots - see `playOneShot()`.
      if (name === 'jump' || name === 'land' || name === 'slide' || name === 'stumble') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(name, action);
      this.blend.set(name, 0);
    }

    this.hasClipSet = CAT_CLIP_NAMES.every((name) => this.actions.has(name));
    if (!this.hasClipSet) {
      // Fallback rig: one clip, always on, speed-scaled. There is nothing to
      // select between, so the state machine below sits it out entirely.
      for (const action of this.actions.values()) action.setEffectiveWeight(1);
      for (const name of this.actions.keys()) this.blend.set(name, 1);
    }
  }

  /**
   * Clones every material under an object so this cat owns them outright.
   *
   * Cloning is what makes both recolouring and the invulnerability flash safe:
   * the registry hands out one cached material per model, and mutating that in
   * place would tint or fade every cat sharing it.
   */
  private collectMaterials(
    root: THREE.Object3D,
    materials: THREE.MeshLambertMaterial[] = this.materials,
    baseOpacities: number[] = this.baseOpacities,
  ): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const mat = mesh.material as THREE.Material;
      if (!mat || materials.includes(mat as THREE.MeshLambertMaterial)) return;

      const own = mat.clone() as THREE.MeshLambertMaterial;
      // Material.clone() carries userData across, including the registry's
      // `shared` marker. This copy is owned by this cat, so clear it or
      // disposeObject() will skip it and every skin change leaks a material.
      own.userData.shared = false;
      mesh.material = own;
      materials.push(own);
      baseOpacities.push(own.opacity);
      // The cat body is always collected before the fish, so this only ever
      // latches onto the cat's own coat map.
      if (!this.skinTexture && own.map) this.skinTexture = own.map;
    });
  }

  /**
   * Starts or stops the "you just lost a life" flash.
   *
   * Idempotent, so the game can push the current state every frame without
   * thrashing shader recompiles - flipping `transparent` changes the material's
   * program, so it is toggled exactly twice per flash and only `opacity` moves
   * in between.
   */
  setInvulnerable(active: boolean): void {
    if (active === this.invulnerable) return;
    this.invulnerable = active;
    this.flashPhase = 0;

    for (let i = 0; i < this.materials.length; i++) {
      const mat = this.materials[i];
      mat.transparent = active || this.baseOpacities[i] < 1;
      mat.depthWrite = !active;
      mat.opacity = active ? this.baseOpacities[i] : this.baseOpacities[i];
      mat.needsUpdate = true;
    }
    // The carried fish flashes too - see the field comment on `fishMaterials`.
    for (let i = 0; i < this.fishMaterials.length; i++) {
      const mat = this.fishMaterials[i];
      mat.transparent = active || this.fishBaseOpacities[i] < 1;
      mat.depthWrite = !active;
      mat.opacity = this.fishBaseOpacities[i];
      mat.needsUpdate = true;
    }
  }

  /** Cycles the flash. Called from update() at render rate. */
  private updateInvulnerability(dt: number): void {
    if (!this.invulnerable) return;

    this.flashPhase += dt;

    // Under reduced motion the strobe is the problem, not the transparency, so
    // hold a steady ghost instead of cycling.
    const factor = this.reducedMotion
      ? 0.55
      : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.flashPhase * FLASH_HZ * Math.PI * 2));

    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].opacity = this.baseOpacities[i] * factor;
    }
    for (let i = 0; i < this.fishMaterials.length; i++) {
      this.fishMaterials[i].opacity = this.fishBaseOpacities[i] * factor;
    }
  }

  /**
   * Snapshot of which power-ups are active this frame, with each one's
   * remaining-duration fraction - same idempotent-setter shape as
   * `setInvulnerable`, called once per frame from `Game.ts` right before
   * `update()`.
   *
   * The tint/material rebuild below is still gated on the active *set*
   * changing (cheap to call every frame - a no-op unless it did), but
   * `remainingFrac`-driven visuals (the shield sphere's fade, the sneaker
   * toggle) read their own fields every frame regardless, since those need
   * to track a continuously decaying value, not just a change in kind.
   *
   * When more than one type is active at once, only the last entry's tint
   * is shown - the same "one at a time" simplification `Game.ts`'s
   * existing floating glow icon already makes for consistency, not a new
   * limitation this introduces.
   */
  setActivePowerUps(active: readonly { type: PowerUpType; remainingFrac: number }[]): void {
    this.shieldRemainingFrac = active.find((a) => a.type === 'shield')?.remainingFrac ?? 0;
    this.sneakersActive = active.some((a) => a.type === 'catnipRush');
    for (const shoe of this.sneakers) shoe.visible = this.sneakersActive;
    this.magnetActive = active.some((a) => a.type === 'fishMagnet');

    const key = active.map((a) => a.type).join(',');
    if (key === this.activePowerUpsKey) return;
    this.activePowerUpsKey = key;
    this.activePowerUps = active.map((a) => a.type);

    if (active.length === 0) {
      this.powerUpPulsePhase = 0;
      for (const mat of this.materials) {
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Fades the shield sphere in/out with `remainingFrac` and gives it a
   * gentle pulse + slow spin so it reads as "glowing," not a static shell.
   * Hidden entirely once the effect ends.
   */
  private updateShieldSphere(dt: number): void {
    const active = this.shieldRemainingFrac > 0;
    this.shieldSphere.visible = active;
    if (!active) {
      this.shieldSphere.position.y = SHIELD_SPHERE_PARK_Y;
      return;
    }
    this.shieldSphere.position.y = 0;

    this.shieldPulsePhase += dt;
    const pulse = 0.85 + 0.15 * Math.sin(this.shieldPulsePhase * SHIELD_PULSE_HZ * Math.PI * 2);
    const material = this.shieldSphere.material as THREE.MeshBasicMaterial;
    material.opacity = SHIELD_MAX_OPACITY * this.shieldRemainingFrac * pulse;
    this.shieldSphere.rotation.y += dt * SHIELD_SPIN_RATE;
  }

  /**
   * Shows/hides and spins the Fish Magnet prop above the head. No fade like
   * the shield sphere - Fish Magnet isn't a hit-absorption effect with a
   * "spend it" moment worth telegraphing, so a clean pop on/off reads fine.
   */
  private updateMagnetProp(dt: number): void {
    this.magnetProp.visible = this.magnetActive;
    if (!this.magnetActive) {
      this.magnetProp.position.y = MAGNET_PARK_Y;
      return;
    }
    this.magnetProp.position.y = MAGNET_PROP_HEIGHT;
    this.magnetSpinPhase += dt * MAGNET_SPIN_RATE;
    this.magnetProp.rotation.y = this.magnetSpinPhase;
    this.magnetProp.position.y += Math.sin(this.magnetSpinPhase * 1.6) * 0.03;
  }

  /** Cycles the active power-up's emissive tint. Called from update() at render rate. */
  private updatePowerUpTint(dt: number): void {
    if (this.activePowerUps.length === 0) return;

    this.powerUpPulsePhase += dt;
    const tint = POWERUP_TINT[this.activePowerUps[this.activePowerUps.length - 1]];

    const pulse = 0.75 + 0.25 * Math.sin(this.powerUpPulsePhase * POWERUP_PULSE_HZ * Math.PI * 2);
    const intensity = tint.intensity * pulse;

    for (const mat of this.materials) {
      if (!('emissive' in mat)) continue;
      mat.emissive.setHex(tint.color);
      mat.emissiveIntensity = intensity;
      mat.needsUpdate = true;
    }
  }

  /** Parents the fish to the head bone if one can be found, else to the body. */
  private attachFish(model: THREE.Object3D): void {
    if (!this.fish) return;
    const head = findHeadBone(model);
    if (!head) {
      this.fish.position.set(0, 0.42, 0.45);
      this.attitude.add(this.fish);
      return;
    }

    model.updateMatrixWorld(true);

    // Bones are in rig space, which is both scaled and arbitrarily oriented -
    // this rig names every bone "Bone.0NN" and none of them share the model's
    // axes. Parenting the fish with only a translation therefore leaves it
    // rotated and sized by whatever the head bone happens to be doing, so both
    // are cancelled here and the pose is rebuilt in the cat's own frame.
    //
    // Computed once, at bind pose: the head barely moves in the walk clip, and
    // recomputing per frame would fight the animation.
    const headQuat = head.getWorldQuaternion(new THREE.Quaternion());
    const modelQuat = model.getWorldQuaternion(new THREE.Quaternion());

    // Carried crosswise in the mouth, the way a cat actually carries a fish,
    // with a slight droop under its own weight.
    const carry = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.PI / 2, 0.14, 'XYZ'),
    );
    this.fish.quaternion.copy(headQuat).invert().multiply(modelQuat).multiply(carry);

    const scale = getWorldScale(head);
    this.fish.scale.setScalar(1 / Math.max(scale, 1e-6));

    // Placed in world space and converted back, so the offset means the same
    // thing regardless of the bone's own scale and orientation.
    //
    // The reach is measured to the front of the model rather than fixed: the
    // two rigs put their head joint in very different places - the kitty's sits
    // well back inside a large skull - and a constant tuned for one buries the
    // fish inside the other's face.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(modelQuat);
    const headAt = head.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(model);
    // Forward is an axis, so the frontmost corner is whichever of the two box
    // extremes projects furthest along it.
    const nose = Math.max(box.min.dot(forward), box.max.dot(forward));
    const reach = Math.max(0.15, (nose - headAt.dot(forward)) * 0.92);

    const target = headAt
      .clone()
      .addScaledVector(forward, reach)
      .addScaledVector(new THREE.Vector3(0, 1, 0), -0.05);
    this.fish.position.copy(head.worldToLocal(target));

    head.add(this.fish);
  }

  /**
   * Builds one Jordan shoe (`PowerUpModels.buildCatnipPickupModel()` - the
   * provided model if it loaded, else the procedural sneaker fallback) per
   * found foot bone and parents it there, hidden by default -
   * `setActivePowerUps()` toggles them on while Catnip Rush is active and
   * back off (removing both, per the request) once it expires. Built once
   * at load, toggled visible/invisible rather than attached/detached per
   * activation, matching the same build-once-toggle convention
   * `PowerUpPool`/`FishPool` already use - and since visibility (not
   * parenting) is what tracks the foot bone frame to frame, the shoes
   * follow running/jumping/sliding for free, the same way the fish does.
   *
   * Uses the same world-quaternion-cancellation technique `attachFish()`
   * does (a bone is in rig space, arbitrarily scaled/oriented, so a plain
   * translation would leave the prop rotated/sized by whatever the bone
   * happens to be doing) but with a fixed small offset rather than a
   * nose-reach measurement - a shoe just needs to sit at the paw, not reach
   * toward a landmark elsewhere on the model.
   *
   * `EQUIPPED_SHOE_SCALE` brings the model down from `ITEM_MODEL_SIZE`
   * (0.6 units, `AssetRegistry.ts` - tuned for a *pickup*, floating and
   * meant to catch the eye at a run's distance) to roughly the previous
   * procedural sneaker's own footprint (~0.42 units), so swapping which
   * model this builds does not also change how big a shoe looks worn on
   * the actual paw.
   *
   * Two corrections apply only to the *provided* model
   * (`shoe.userData.isProvidedModel`, set by `buildCatnipPickupModel()`),
   * never the procedural fallback, which was already authored to fit this
   * same attachment code:
   *  - `JORDAN_TOE_CORRECTION` (own doc comment above) - the toe points the
   *    wrong way by default.
   *  - The sole offset below, which measures the *actual* model (whichever
   *    one this turned out to be) rather than assuming a fixed offset -
   *    the provided model's pivot sits at its geometric centre, not near
   *    its sole like the procedural sneaker's does, so a shared hardcoded
   *    "shift down a little" would have under-corrected specifically for
   *    the provided model, which is what left it floating in the middle of
   *    the paw instead of resting on it.
   */
  private attachSneakers(model: THREE.Object3D): void {
    const feet = findFootBones(model);
    if (feet.length === 0) return;

    model.updateMatrixWorld(true);
    const modelQuat = model.getWorldQuaternion(new THREE.Quaternion());

    for (const foot of feet) {
      const shoe = buildCatnipPickupModel();
      shoe.visible = false;

      const footQuat = foot.getWorldQuaternion(new THREE.Quaternion());
      shoe.quaternion.copy(footQuat).invert().multiply(modelQuat);
      if (shoe.userData.isProvidedModel) shoe.quaternion.multiply(JORDAN_TOE_CORRECTION);

      const scale = getWorldScale(foot);
      shoe.scale.setScalar(EQUIPPED_SHOE_SCALE / Math.max(scale, 1e-6));

      // How far the shoe's own sole sits below its pivot, measured (not
      // assumed) so this holds for whichever model is actually active -
      // computed unparented, so this is purely the shoe's own rotated,
      // scaled geometry around its own origin.
      shoe.updateMatrixWorld(true);
      const soleBox = new THREE.Box3().setFromObject(shoe);
      const soleDrop = Number.isFinite(soleBox.min.y) ? -soleBox.min.y : 0;

      // Target is the paw's underside/front - the shoe's SOLE lands there,
      // not its pivot, hence subtracting soleDrop back off the down offset.
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(modelQuat);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(modelQuat);
      const footAt = foot.getWorldPosition(new THREE.Vector3());
      const target = footAt
        .addScaledVector(down, 0.03 - soleDrop)
        .addScaledVector(forward, 0.05);
      shoe.position.copy(foot.worldToLocal(target));

      foot.add(shoe);
      this.sneakers.push(shoe);
    }
  }

  /**
   * Equips a coat.
   *
   * Async because a skin is a map on disk rather than something derived from
   * one already in memory: the six coats ship as separate 1024px textures and
   * are fetched the first time each is worn. Awaiting is optional - the shop
   * screen fires this and lets the cat change under the player - but the load
   * path awaits it so the game never opens on an untextured white cat.
   *
   * The fallback rig has no UVs to put a coat on and is skipped rather than
   * tinted; there is nothing sensible to map onto it.
   */
  async setSkin(id: CatSkinId): Promise<void> {
    if (!this.skinnable || this.materials.length === 0) return;

    let texture: THREE.Texture;
    try {
      texture = await this.registry.loadCatSkin(id);
    } catch {
      // A missing coat must not leave the player without a cat.
      return;
    }

    this.skinTexture = texture;
    for (const mat of this.materials) {
      mat.map = texture;
      mat.needsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Shows/hides the carried fish prop - on by default (it's part of the
   *  character's normal silhouette), off for contexts like the skin-preview
   *  widget where it's a distraction rather than a costume detail. */
  setFishVisible(visible: boolean): void {
    if (this.fish) this.fish.visible = visible;
  }

  /**
   * The cat's on-screen bounding box - for framing a camera around it, not
   * for gameplay (the physics capsule is the source of truth there).
   *
   * Deliberately NOT `new THREE.Box3().setFromObject(this.root)`: that method
   * doesn't check `.visible`, and both the shield sphere and the Fish Magnet
   * prop park themselves far below the model (`SHIELD_SPHERE_PARK_Y`,
   * `MAGNET_PARK_Y`) rather than actually detaching while inactive, so a
   * naive box would balloon out to include whichever is parked even though
   * nothing is drawn there. This walks the hierarchy itself and only
   * includes meshes actually being rendered.
   */
  getVisualBounds(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // traverseVisible, not traverse+`.visible` - the magnet prop and shield
    // sphere both park themselves with `this.magnetProp.visible = false` on
    // the GROUP, which does not clear each child mesh's own `.visible`
    // (three.js only skips rendering, it doesn't cascade the flag down) - a
    // plain `.visible` check on each child would still find them "visible"
    // and pull the parked position back in. traverseVisible walks the same
    // ancestor chain the renderer itself checks, so a parked prop's meshes
    // are correctly skipped without needing every prop to explicitly hide
    // each of its own children.
    this.root.traverseVisible((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) box.expandByObject(mesh);
    });
    return box;
  }

  /**
   * @param dt real frame delta - this runs at render rate, not physics rate,
   *           because it is purely cosmetic
   */
  update(dt: number, input: CatVisualInput): void {
    this.root.position.copy(input.position);
    this.root.quaternion.copy(input.rotation);

    this.updateInvulnerability(dt);
    this.updatePowerUpTint(dt);
    this.updateShieldSphere(dt);
    this.updateMagnetProp(dt);
    this.updateAnimation(dt, input);
    this.updateAttitude(dt, input);
    this.updateTail(dt, input);
  }

  /**
   * Picks the clip the cat should be playing and eases the blend weights there.
   */
  private updateAnimation(dt: number, input: CatVisualInput): void {
    if (!this.mixer) return;

    if (!this.hasClipSet) {
      this.updateLegacyWalkCycle(dt, input);
      return;
    }

    if (this.oneShot) {
      this.oneShot.remaining -= dt;
      if (this.oneShot.remaining <= 0) this.oneShot = null;
    }

    // Rewind the tuck on the rising edge of the duck.
    //
    // Derived from the state rather than driven by an event on purpose. The
    // slide action is `LoopOnce` + `clampWhenFinished` - it has to be, or a
    // take shorter than a held slide visibly rewinds mid-duck - which means
    // that by the time the player first presses slide, the action started at
    // load has long since run to its end and parked there. Raising its weight
    // then shows the clip's final frame and nothing else: the cat does not
    // tuck at all. Watching the flag here means the pose cannot be desynced by
    // a missed callback, which is the same reason nothing else in this class
    // takes its cue from an event either.
    if (input.ducking && !this.wasDucking) {
      const slide = this.actions.get('slide');
      if (slide) {
        slide.reset();
        slide.play();
      }
    }
    this.wasDucking = input.ducking;

    const run = this.actions.get('run');
    if (run) {
      // Match stride rate to ground speed so the paws stay planted rather than
      // skating. Held steady in the air: re-timing a cycle nothing can see
      // means the cat lands mid-stride at a random phase.
      const rate = input.grounded
        ? (input.horizontalSpeed * run.getClip().duration) / RUN_STRIDE_DISTANCE
        : run.timeScale;
      const targetRate = THREE.MathUtils.clamp(rate, RUN_RATE_RANGE[0], RUN_RATE_RANGE[1]);
      run.timeScale +=
        (targetRate - run.timeScale) * (1 - Math.exp(-RUN_RATE_SMOOTH * dt));
    }

    const target = this.selectClip(input);
    const ease = 1 - Math.exp(-BLEND_RATE * dt);

    for (const [name, action] of this.actions) {
      const current = this.blend.get(name) ?? 0;
      const next = current + ((name === target ? 1 : 0) - current) * ease;
      this.blend.set(name, next);
      action.setEffectiveWeight(next);
    }

    this.mixer.update(dt);
  }

  /** The single clip the cat wants to be in right now. */
  private selectClip(input: CatVisualInput): CatClipName | null {
    // Above everything, including one-shots - see the field's own comment.
    if (this.showcaseClip && this.actions.has(this.showcaseClip)) return this.showcaseClip;

    // A one-shot outranks the locomotion state for as long as it runs, except
    // that leaving the ground cancels a landing - the cat is demonstrably not
    // absorbing an impact any more.
    if (this.oneShot) {
      const airborneCancelsLand = this.oneShot.clip === 'land' && !input.grounded;
      if (!airborneCancelsLand) return this.oneShot.clip;
      this.oneShot = null;
    }

    // Above the stumble, and above everything else on the ground. A duck is the
    // one pose the player asked for by name, and showing them anything else
    // while the input is live reads as the press not having registered - which
    // matters more here than for any other state, because they are about to
    // find out whether it worked.
    if (input.ducking && this.actions.has('slide')) return 'slide';

    // The stumble *clip* is deliberately NOT driven by `input.state ===
    // Stumbling` here, even though that physics state also covers a hard
    // landing and a shield-absorbed hit - neither of which costs a life. It
    // used to be: PlayerController sets Stumbling directly on any hard
    // contact, before Game.ts has even decided whether the hit will be
    // absorbed, so the animation had already committed to playing by the
    // time the shield/life-loss branch was resolved. The clip is now a
    // one-shot fired explicitly by `onHurt()`, called only from
    // `Game.loseLife()` - the sole place a life is actually spent - so it
    // fires exactly on confirmed damage. See `updateAttitude`/`updateTail`
    // for the (unrelated, and correctly still state-driven) off-balance
    // wobble that plays for the full physics stumble regardless of cause.
    if (!input.grounded) return 'fall';

    // Hysteresis band, not a single threshold: enter 'run' above IDLE_SPEED,
    // but only fall back to 'idle' once speed drops below IDLE_SPEED_EXIT.
    // Hovering right at IDLE_SPEED (braking, stumble recovery) would
    // otherwise flip the blend target every frame - the eased blend never
    // snaps, but it never settles either, a subtle, persistent wobble.
    const threshold = this.wasRunning ? IDLE_SPEED_EXIT : IDLE_SPEED;
    this.wasRunning = input.horizontalSpeed > threshold;
    return this.wasRunning ? 'run' : 'idle';
  }

  /** Restarts a one-shot clip and hands it priority for its full duration. */
  private playOneShot(name: CatClipName): void {
    const action = this.actions.get(name);
    if (!action) return;
    action.reset();
    action.play();
    this.oneShot = { clip: name, remaining: action.getClip().duration };
  }

  /**
   * The fallback rig's lone walk clip, time-scaled by ground speed.
   *
   * Kept verbatim from before the kitty rig existed: that clip was authored as
   * a walk, so it needs a healthy multiplier before it reads as a sprint, and
   * it has no airborne pose at all - hence the freeze rather than a blend.
   */
  private updateLegacyWalkCycle(dt: number, input: CatVisualInput): void {
    for (const action of this.actions.values()) {
      if (!input.grounded) {
        // A running animation in mid-air reads as a bug.
        action.paused = true;
      } else {
        action.paused = false;
        action.timeScale = THREE.MathUtils.clamp(input.horizontalSpeed / 3.2, 0.15, 5.5);
      }
    }
    this.mixer!.update(dt);
  }

  /**
   * Whole-body attitude: roll into turns, pitch with vertical velocity, and a
   * spring-damped squash on impact.
   */
  private updateAttitude(dt: number, input: CatVisualInput): void {
    const smooth = 1 - Math.exp(-9 * dt);

    // --- Lean ---
    // Combine intent (steer) with what's actually happening (slip) so a cat
    // sliding sideways leans even when the player has let go of the stick.
    const slipLean = THREE.MathUtils.clamp(input.lateralSlip / PHYSICS.slipThreshold, -1.5, 1.5);
    const speedFactor = THREE.MathUtils.clamp(input.horizontalSpeed / PHYSICS.runSpeed, 0, 1);
    const targetLean = (input.steer * 0.32 + slipLean * 0.22) * speedFactor;
    this.leanAngle += (targetLean - this.leanAngle) * smooth;

    // --- Pitch ---
    let targetPitch = 0;
    if (!input.grounded) {
      // Nose up while rising, down while falling.
      targetPitch = THREE.MathUtils.clamp(-input.velocity.y / 14, -0.42, 0.42);
    }
    this.pitchAngle += (targetPitch - this.pitchAngle) * (1 - Math.exp(-6 * dt));

    // --- Squash spring ---
    // Damped close to critical (zeta ~0.9). At 16 the spring visibly overshot
    // and rang after every touchdown, which is most of what made ordinary
    // landings feel like heavy impacts.
    //
    // Integrated in fixed sub-steps rather than over the whole frame delta, and
    // that is not tidiness. Explicit Euler multiplies velocity by
    // `(1 - damping * dt)` each step, which passes -1 at exactly
    // `dt = 2 / damping` = 1/12 s - so below 12 fps the damping term amplified
    // velocity instead of removing it and the spring diverged, saturating the
    // clamp below at (0.878, 1.35, 0.878) one frame and (1.157, 0.55, 1.157)
    // the next. That was the reported "character stretches vertically", and it
    // only ever appeared on hardware slow enough to cross the threshold.
    //
    // Sub-stepping also makes the response the *same* at 10 fps as at 60 rather
    // than merely bounded, which matters on hardware that will sit at the low
    // end. The lean and pitch above already use frame-rate independent
    // smoothing; only this integrated raw, and only this blew up.
    const stiffness = 180;
    const damping = 24;

    let remaining = Math.min(dt, SQUASH_MAX_INTEGRATION);
    while (remaining > 0) {
      const step = Math.min(remaining, SQUASH_STEP);
      const accel = (1 - this.squash) * stiffness - this.squashVelocity * damping;
      this.squashVelocity += accel * step;
      this.squash += this.squashVelocity * step;
      // Clamped inside the loop, so at 60 fps this is exactly one sub-step and
      // the behaviour is unchanged from before the fix.
      this.squash = THREE.MathUtils.clamp(this.squash, 0.55, 1.35);
      remaining -= step;
    }

    // --- Lane hop ---
    // A half sine over the lane change's own duration, so the cat is back on
    // the ground exactly as it arrives in the new lane. Written to
    // groundOffset rather than attitude because it is a translation of the
    // whole cat, not a pose offset - keeping the two separate is what stops
    // the hop being scaled by the squash spring.
    let hop = 0;
    if (this.hopTimer > 0) {
      this.hopTimer = Math.max(0, this.hopTimer - dt);
      const t = 1 - this.hopTimer / this.hopDuration;
      hop = Math.sin(t * Math.PI) * LANE_HOP_HEIGHT;
    }

    // --- Duck ---
    // The clip does most of the work, but the cat has to visibly end up under
    // the cloth or the input feels like it did nothing. Eased rather than
    // snapped, and on the same node as the hop for the same reason: it is a
    // translation of the whole cat, so the squash spring must not scale it.
    this.duckBlend = THREE.MathUtils.damp(
      this.duckBlend,
      input.ducking ? 1 : 0,
      DUCK_BLEND_RATE,
      dt,
    );

    this.groundOffset.position.y =
      -capsuleFeetOffset() + hop - this.duckBlend * DUCK_DROP;

    this.attitude.rotation.set(this.pitchAngle, 0, this.leanAngle);
    const spread = 1 + (1 - this.squash) * 0.35;
    this.attitude.scale.set(spread, this.squash, spread);

    // A stumble should look like a stumble rather than a poised run.
    if (input.state === PlayerState.Stumbling) {
      this.attitude.rotation.x += Math.sin(performance.now() * 0.012) * 0.18;
    }
  }

  /**
   * Tail sway. Reacts to turning and goes stiff and high while airborne, which
   * is the readable "cat in flight" silhouette.
   */
  private updateTail(dt: number, input: CatVisualInput): void {
    if (this.tailBones.length === 0) return;

    this.tailPhase += dt * (2.5 + input.horizontalSpeed * 0.5);

    const slip = THREE.MathUtils.clamp(input.lateralSlip / PHYSICS.slipThreshold, -1, 1);
    const targetSway = input.steer * 0.5 + slip * 0.35;
    this.tailSway += (targetSway - this.tailSway) * (1 - Math.exp(-8 * dt));

    const idleWave = Math.sin(this.tailPhase) * 0.12;
    const airLift = input.grounded ? 0 : 0.28;
    const limp = input.state === PlayerState.Stumbling ? 0.35 : 0;

    for (let i = 0; i < this.tailBones.length; i++) {
      const bone = this.tailBones[i];
      const rest = this.tailRestQuats[i];
      // Later joints move more, giving the whip a natural taper.
      const weight = (i + 1) / this.tailBones.length;
      const lag = Math.sin(this.tailPhase - i * 0.55) * 0.1 * weight;

      _euler.set(
        (airLift + limp) * weight,
        (this.tailSway + lag) * weight * 0.9,
        idleWave * weight,
        'XYZ',
      );
      _q.setFromEuler(_euler);
      bone.quaternion.copy(rest).multiply(_q);
    }
  }

  /**
   * Kicks the squash spring on a landing.
   *
   * Kept light. A cat absorbs a landing in its legs, so a visible dip of a few
   * percent is enough to sell it; the previous 12-42% flattened the whole animal
   * on every hop.
   */
  onLand(impactSpeed: number): void {
    const t = THREE.MathUtils.clamp(impactSpeed / (PHYSICS.hardLandingSpeed * 1.6), 0, 1);
    this.squash = 1 - (0.05 + t * 0.15);
    this.squashVelocity = 0;
    this.playOneShot('land');
  }

  /**
   * The little hop that punctuates a lane change.
   *
   * @param duration the lane tween's own duration, so the two land together
   */
  onLaneHop(duration: number): void {
    this.hopDuration = Math.max(duration, 0.05);
    this.hopTimer = this.hopDuration;
    this.squash = LANE_HOP_STRETCH;
    this.squashVelocity = 0;
  }

  /** Small upward stretch when leaving the ground. */
  onJump(): void {
    this.squash = 1.1;
    this.squashVelocity = 0;
    this.playOneShot('jump');
  }

  /**
   * The damage/hurt animation. Call this - and only this - on a confirmed
   * life loss (`Game.loseLife()`, after the life count actually drops), not
   * from a raw collision or hard-landing event. Those still show up as the
   * physical stumble wobble (`updateAttitude`/`updateTail`, driven by
   * `PlayerController`'s own `Stumbling` state) even when no life is lost -
   * a shield absorbing a hit, or a hard landing, both still look and feel
   * like an impact - but the discrete hurt *pose* is reserved for the event
   * that actually cost something.
   */
  onHurt(): void {
    this.playOneShot('stumble');
  }


  reset(): void {
    this.leanAngle = 0;
    this.pitchAngle = 0;
    this.squash = 1;
    this.squashVelocity = 0;
    this.tailSway = 0;
    this.hopTimer = 0;
    this.hopDuration = 0;
    this.duckBlend = 0;
    this.attitude.rotation.set(0, 0, 0);
    this.attitude.scale.set(1, 1, 1);
    this.groundOffset.position.y = -capsuleFeetOffset();

    // A fresh run should never inherit the previous run's power-up glow.
    this.activePowerUps = [];
    this.activePowerUpsKey = '';
    this.powerUpPulsePhase = 0;
    for (const mat of this.materials) mat.emissiveIntensity = 0;

    this.shieldRemainingFrac = 0;
    this.shieldPulsePhase = 0;
    this.shieldSphere.visible = false;
    this.shieldSphere.position.y = SHIELD_SPHERE_PARK_Y;
    (this.shieldSphere.material as THREE.MeshBasicMaterial).opacity = 0;

    this.sneakersActive = false;
    for (const shoe of this.sneakers) shoe.visible = false;

    this.magnetActive = false;
    this.magnetSpinPhase = 0;
    this.magnetProp.visible = false;
    this.magnetProp.position.y = MAGNET_PARK_Y;

    this.oneShot = null;
    // A run must never inherit the attract screen's meal. Cleared here rather
    // than left to the caller so the default is always "the state machine is
    // in charge", and the one place that wants otherwise re-sets it after
    // calling this.
    this.showcaseClip = null;
    for (const [name, action] of this.actions) {
      action.reset();
      action.play();
      const weight = this.hasClipSet ? 0 : 1;
      action.setEffectiveWeight(weight);
      this.blend.set(name, weight);
    }
    // Start from a clean idle rather than whatever pose the last run died in.
    const idle = this.actions.get('idle');
    if (this.hasClipSet && idle) {
      idle.setEffectiveWeight(1);
      this.blend.set('idle', 1);
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const mat of this.materials) mat.dispose();
    this.materials.length = 0;
    this.baseOpacities.length = 0;
    for (const mat of this.fishMaterials) mat.dispose();
    this.fishMaterials.length = 0;
    this.fishBaseOpacities.length = 0;

    this.shieldSphere.geometry.dispose();
    (this.shieldSphere.material as THREE.Material).dispose();

    for (const shoe of this.sneakers) {
      shoe.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
      });
      shoe.removeFromParent();
    }
    this.sneakers.length = 0;

    // disposeIfOwned, not the manual traverse above - buildMagnetModel() may
    // have returned a clone of AssetRegistry's cached provided model, which
    // shares its geometry/material by reference (marked userData.shared).
    // Disposing those directly would free the resource every other clone
    // and the cache itself still needs.
    disposeIfOwned(this.magnetProp);
    this.magnetProp.removeFromParent();

    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Rig introspection
//
// The kitty rig names its joints (see CatRig), so a lookup is enough. The
// fallback rig names every bone "Bone.0NN", which carries no meaning at all, so
// its bones have to be identified by where they sit instead.
// ---------------------------------------------------------------------------

/** Tail links, base first. Must match the names CatRig builds. */
const TAIL_BONE_NAMES = ['tailA', 'tailB', 'tailC', 'tailD'] as const;

function boneNamed(model: THREE.Object3D, name: string): THREE.Bone | null {
  const found = model.getObjectByName(name) as THREE.Bone | undefined;
  return found?.isBone ? found : null;
}

/**
 * The tail chain, base first, or empty if the rig has no tail.
 *
 * The geometric fallback is gated behind "this rig names nothing", and that
 * gate is load-bearing rather than tidiness. It looks for a leaf bone behind
 * the body and above leg height, then walks up to the spine - and the imported
 * Meshy rig has no tail but *does* have `head_end`, a leaf sitting behind the
 * head. Ungated, the fallback identifies the skull as a tail tip and returns
 * the neck and spine as its chain, so `updateTail` would then whip the cat's
 * whole upper body around once per stride.
 */
function findTailChain(model: THREE.Object3D): THREE.Bone[] {
  const named = TAIL_BONE_NAMES.map((name) => boneNamed(model, name)).filter(
    (bone): bone is THREE.Bone => bone !== null,
  );
  if (named.length >= 2) return named;

  // A rig that names its joints and has no tail bones simply has no tail.
  if (hasSemanticNames(model)) return [];

  return findTailChainByGeometry(model);
}

/**
 * True when the rig uses meaningful joint names, in either scheme this game
 * has met: the generated one from CatRig, or the imported Meshy skeleton. The
 * legacy `cat.fbx` names every bone `Bone.0NN` and answers false.
 */
function hasSemanticNames(model: THREE.Object3D): boolean {
  return boneNamed(model, 'hips') !== null || boneNamed(model, 'Hips') !== null;
}

/** The head joint. Named on both rigs, but not with the same capitalisation. */
function findHeadBone(model: THREE.Object3D): THREE.Bone | null {
  return (
    boneNamed(model, 'head') ?? boneNamed(model, 'Head') ?? findHeadBoneByGeometry(model)
  );
}

/** Foot joints - `footL`/`footR` on the generated `CatRig` skeleton (see
 *  `CatRig.ts`), `LeftFoot`/`RightFoot` on the imported Meshy rig (see
 *  `CatAnimations.ts`'s `RETARGET` table). */
const FOOT_BONE_NAMES = ['footL', 'footR', 'LeftFoot', 'RightFoot'] as const;

/** The foot joints, for equipping the Catnip Rush sneaker prop. Named on
 *  both rigs this game has met; falls back to a geometric guess for the
 *  legacy `cat.fbx` rig, same gating `findTailChain`/`findHeadBone` use. */
function findFootBones(model: THREE.Object3D): THREE.Bone[] {
  const named = FOOT_BONE_NAMES.map((name) => boneNamed(model, name)).filter(
    (bone): bone is THREE.Bone => bone !== null,
  );
  if (named.length >= 1) return named;

  // A rig that names its joints and has no foot bones simply has none to
  // attach to - same reasoning findTailChain's gate documents.
  if (hasSemanticNames(model)) return [];

  return findFeetByGeometry(model);
}

/**
 * Finds up to two leaf bones near the ground as a best-effort "feet" guess
 * for an unnamed rig - the lowest-sitting leaf bones, preferring a
 * left/right pair spread apart in X over two bones on the same side.
 */
function findFeetByGeometry(model: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  if (bones.length === 0) return [];

  const box = new THREE.Box3().setFromObject(model);
  const groundBand = box.min.y + box.getSize(new THREE.Vector3()).y * 0.25;

  const leaves = bones
    .filter((bone) => !bone.children.some((c) => (c as THREE.Bone).isBone))
    .map((bone) => ({ bone, pos: bone.getWorldPosition(new THREE.Vector3()) }))
    .filter((b) => b.pos.y <= groundBand)
    .sort((a, b) => a.pos.y - b.pos.y);

  if (leaves.length === 0) return [];
  if (leaves.length === 1) return [leaves[0].bone];

  // Pick the widest-apart pair among the lowest few candidates, so two feet
  // on the same leg don't both get picked over an actual left/right pair.
  const pool = leaves.slice(0, Math.min(leaves.length, 6));
  let bestPair: [THREE.Bone, THREE.Bone] = [pool[0].bone, pool[1].bone];
  let bestSpread = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const spread = Math.abs(pool[i].pos.x - pool[j].pos.x);
      if (spread > bestSpread) {
        bestSpread = spread;
        bestPair = [pool[i].bone, pool[j].bone];
      }
    }
  }
  return bestPair;
}

/**
 * Finds the tail as the longest chain of bones running backwards from the body
 * while staying above leg height.
 */
function findTailChainByGeometry(model: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  if (bones.length === 0) return [];

  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Model forward is +Z after the yaw offset, so the tail trails toward -Z.
  const minHeight = box.min.y + size.y * 0.35;

  let best: THREE.Bone | null = null;
  let bestScore = -Infinity;

  for (const bone of bones) {
    // Leaf bones only - the tail tip has no children.
    if (bone.children.some((c) => (c as THREE.Bone).isBone)) continue;
    bone.getWorldPosition(_v);
    if (_v.y < minHeight) continue; // legs

    const backwards = centre.z - _v.z;
    if (backwards <= 0) continue;
    if (backwards > bestScore) {
      bestScore = backwards;
      best = bone;
    }
  }

  if (!best) return [];

  // Walk up from the tip until the chain reaches the body.
  const chain: THREE.Bone[] = [];
  let node: THREE.Object3D | null = best;
  while (node && (node as THREE.Bone).isBone && chain.length < 8) {
    const bone = node as THREE.Bone;
    bone.getWorldPosition(_v);
    if (_v.z > centre.z) break;
    chain.unshift(bone);
    node = bone.parent;
  }

  // A one-bone "chain" is more likely a misdetection than a tail.
  return chain.length >= 2 ? chain : [];
}

/** Finds the head as the highest bone furthest forward. */
function findHeadBoneByGeometry(model: THREE.Object3D): THREE.Bone | null {
  const bones: THREE.Bone[] = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  if (bones.length === 0) return null;

  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());

  let best: THREE.Bone | null = null;
  let bestScore = -Infinity;
  for (const bone of bones) {
    bone.getWorldPosition(_v);
    if (_v.y < centre.y) continue;
    const score = (_v.z - centre.z) * 2 + (_v.y - centre.y);
    if (score > bestScore) {
      bestScore = score;
      best = bone;
    }
  }
  return best;
}

function getWorldScale(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return (scale.x + scale.y + scale.z) / 3;
}

// ---------------------------------------------------------------------------
// Procedural geometry
// ---------------------------------------------------------------------------

/**
 * The provided fish model, once `setFishModel()` has been called with it -
 * used only for the fish carried in the cat's own mouth now. The endless
 * track's collectible used to share this (`Collectible.ts` called
 * `buildFish()` directly) but was given its own separate fish-coin visual
 * instead, specifically so it could be swapped for the provided coin art
 * without touching the mouth fish at all - see `Collectible.ts`'s own doc
 * comment. `null` until `Game.loadAssets()`'s item-model load resolves, and
 * permanently `null` if that load failed - either way `buildFish()` falls
 * back to the procedural fish below rather than the game shipping with no
 * fish at all.
 */
let fishPrototype: THREE.Object3D | null = null;

/** Called once, after the item models load - see `Game.loadAssets()`. */
export function setFishModel(model: THREE.Object3D): void {
  fishPrototype = model;
}

/** The stolen fish - the provided model if loaded, else built from primitives. */
export function buildFish(): THREE.Group {
  if (fishPrototype) return fishPrototype.clone(true) as THREE.Group;
  return buildProceduralFish();
}

function buildProceduralFish(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
  const grillMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
  const finMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), bodyMat);
  body.scale.set(1, 0.68, 2.1);
  group.add(body);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.16, 4), finMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -0.32;
  tail.scale.set(1, 1, 0.5);
  group.add(tail);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 3), finMat);
  dorsal.position.set(0, 0.09, -0.02);
  group.add(dorsal);

  // Grill marks - the fish is meant to look cooked, not raw.
  for (let i = 0; i < 3; i++) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.022), grillMat);
    mark.position.set(0, 0.075, -0.1 + i * 0.11);
    mark.rotation.z = 0.12;
    group.add(mark);
  }

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  );
  eye.position.set(0.07, 0.04, 0.2);
  group.add(eye);

  group.castShadow = true;
  return group;
}

/**
 * Emergency low-poly cat used only if cat.fbx fails to load, so a broken asset
 * degrades to a playable game rather than an empty screen.
 */
function buildFallbackCat(): THREE.Group {
  const group = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: 0xe08a3c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.3;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), fur);
  head.position.set(0, 0.42, 0.38);
  group.add(head);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 3), fur);
    ear.position.set(side * 0.09, 0.56, 0.36);
    group.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), dark);
    eye.position.set(side * 0.08, 0.45, 0.53);
    group.add(eye);
  }

  for (const side of [-1, 1]) {
    for (const front of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 3, 6), fur);
      leg.position.set(side * 0.13, 0.12, front * 0.2);
      group.add(leg);
    }
  }

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.34, 3, 6), fur);
  tail.position.set(0, 0.44, -0.34);
  tail.rotation.x = -0.7;
  group.add(tail);

  group.traverse((c) => {
    c.castShadow = true;
  });
  return group;
}
