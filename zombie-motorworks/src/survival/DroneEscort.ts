/**
 * The Drone Swarm bay's flight, drawn in the air around the rig.
 *
 * The bay's point defence used to be invisible between intercepts: a die roll
 * every second and a green flash when it landed, with nothing in the world to
 * say the rig was screened at all. So the flight is drawn — little quadcopters
 * loitering in a loose ring above the chassis, one more of them for every level
 * on the bay. That makes the upgrade ladder something the player watches happen
 * rather than reads in the garage, and it makes an intercept legible: the
 * things that just swatted the box are right there.
 *
 * Presentation only. Nothing here decides whether a projectile is caught —
 * `SurvivalMode.updateDroneInterceptors` owns that and calls `flashIntercept`
 * after the fact, with the point the shot died at so the nearest of the flight
 * can be seen flying into it.
 *
 * The root lives in world space rather than under the vehicle group, and is
 * moved to the chassis every frame. Parented to the chassis the whole ring
 * would snap around with every steering input, which reads as the drones being
 * bolted to a pole; loitering in world space, they hold their heading while the
 * rig turns underneath them.
 */

import * as THREE from 'three';
import { DARK_STEEL, glowLambert, lambert, shade } from '../editor/parts/shared.ts';
import { VFX_PALETTE } from '../vfx/vfxConfig.ts';

/**
 * Drones in the air for a bay at this upgrade level (index = level - 1). One
 * more per link, so every upgrade shows up in the sky immediately — the
 * intercept chance behind it (`DRONE_INTERCEPT_CHANCE_BY_LEVEL`) is a number
 * the player can otherwise only infer from surviving.
 */
const ESCORT_DRONES_BY_LEVEL = [2, 3, 4, 5, 6, 7] as const;

/**
 * Hard ceiling across every bay on the rig. Two maxed bays would otherwise put
 * fourteen drones up, which stops reading as an escort and starts hiding the
 * chassis.
 */
const MAX_ESCORT_DRONES = 8;

/** Seconds between recounts of the live bays. */
const RECOUNT_INTERVAL_SECONDS = 0.25;

/** Seconds a drone takes to fade in when the bay it belongs to is upgraded. */
const FADE_SECONDS = 0.45;

/** Seconds the intercept bubble takes to swell and burst. */
const INTERCEPT_FLASH_SECONDS = 0.22;

/**
 * Seconds a drone spends off its lane hitting the shot it just caught. Longer
 * than the bubble on purpose: the bubble is a flicker that says the rig was
 * covered, the dive is the thing the player's eye follows out to the kill.
 */
const LUNGE_SECONDS = 0.42;

/** Fraction of the dive spent reaching the shot; the rest is the flight home. */
const LUNGE_STRIKE_FRACTION = 0.35;

/**
 * Drones that break formation on a catch. The whole flight converging reads as
 * the ring collapsing, so the two nearest go — the ones the player already
 * believes made the catch — and everyone else just leans that way.
 */
const LUNGING_DRONES = 2;

/** How far the drones left in the ring lean toward the catch, 0..1. */
const LEAN_FRACTION = 0.14;

/**
 * Furthest a drone will chase a catch, metres. The bay's intercept radius is
 * 16 m and a drone crossing that in a fifth of a second is a teleport, so a
 * distant catch gets a charge in its direction rather than a hit on it.
 */
const MAX_LUNGE_REACH_M = 7;

/** Peak opacity of the bubble's solid skin and of its lattice. */
const BUBBLE_OPACITY = 0.2;
const LATTICE_OPACITY = 0.55;

/** Metres the ring sits above the chassis centre, before each drone's offset. */
const RING_HEIGHT_M = 1.5;
/** Extra height between the ring's lowest and highest lane. */
const LANE_SPACING_M = 0.45;
/** Metres a drone bobs either side of its lane. */
const BOB_AMPLITUDE_M = 0.16;

/**
 * Ease one heading toward another the short way round, so a drone turning onto
 * a target that sits across the ±π seam banks through it instead of spinning
 * the long way home.
 */
function blendAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  return from + (delta < -Math.PI ? delta + Math.PI * 2 : delta) * t;
}

interface EscortDrone {
  readonly group: THREE.Group;
  /** Where in the ring this drone sits at t = 0, radians. */
  readonly phase: number;
  /** Radians per second around the rig; sign is the direction it loiters. */
  readonly speed: number;
  readonly radiusM: number;
  readonly heightM: number;
  /** Bob rate, radians per second, detuned per drone so the ring never pulses. */
  readonly bobRate: number;
  /** 0..1 fade — a drone eases in when its slot is filled and out when lost. */
  visibility: number;
  /**
   * How much of the way to the current catch this drone flies, 0..1. Set when
   * the intercept is armed and held for the dive, so a drone that drifts past
   * the shot mid-dive does not suddenly find itself the closest and jerk.
   */
  lungeWeight: number;
}

export class DroneEscort {
  readonly root = new THREE.Group();
  private readonly drones: EscortDrone[] = [];
  private readonly bubble: THREE.Mesh;
  private readonly bubbleMaterial: THREE.MeshBasicMaterial;
  private readonly lattice: THREE.Mesh;
  private readonly latticeMaterial: THREE.MeshBasicMaterial;
  /** Materials shared by every drone, kept for the rotor flare and disposal. */
  private readonly bodyMaterial: THREE.MeshLambertMaterial;
  private readonly armMaterial: THREE.MeshLambertMaterial;
  private readonly rotorMaterial: THREE.MeshLambertMaterial;
  private readonly eyeMaterial: THREE.MeshLambertMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Seconds of bubble left; 0 when no intercept is being shown. */
  private flashSeconds = 0;
  /** Seconds of dive left; 0 when nobody is off their lane. */
  private lungeSeconds = 0;
  /** Where the catch happened, in the ring's own space. */
  private readonly lungeTarget = new THREE.Vector3();
  /** Scratch for the lane-to-target leg, so a dive allocates nothing. */
  private readonly lungeLeg = new THREE.Vector3();
  private clock = 0;
  private recountIn = 0;
  private wanted = 0;
  private disposed = false;

  /**
   * @param chassisRadiusM Footprint radius of the rig the flight escorts. The
   *   ring is flown outside it and the bubble is sized to just clear it, so a
   *   long truck gets a wide screen and a buggy a tight one.
   */
  constructor(private readonly chassisRadiusM: number) {
    this.root.name = 'drone-escort';
    this.root.visible = false;

    const green = VFX_PALETTE.drone;
    const pale = VFX_PALETTE.dronePale;
    this.bodyMaterial = lambert(shade(green, 1.05));
    this.armMaterial = lambert(DARK_STEEL);
    this.rotorMaterial = glowLambert(shade(green, 1.75), 0.75, 0.7);
    this.eyeMaterial = glowLambert(0xff5a3c, 1, 1);

    const bubbleRadius = this.bubbleRadiusM();
    this.bubbleMaterial = new THREE.MeshBasicMaterial({
      color: green,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // Faceted rather than smooth, and green rather than blue: the shield
    // special already owns the smooth blue dome, and a point-defence catch has
    // to read as a different thing happening at a glance.
    this.bubble = new THREE.Mesh(
      this.track(new THREE.IcosahedronGeometry(bubbleRadius, 2)),
      this.bubbleMaterial,
    );
    this.bubble.visible = false;
    this.root.add(this.bubble);

    this.latticeMaterial = new THREE.MeshBasicMaterial({
      color: pale,
      transparent: true,
      opacity: 0,
      wireframe: true,
      depthWrite: false,
    });
    this.lattice = new THREE.Mesh(
      this.track(new THREE.IcosahedronGeometry(bubbleRadius * 1.01, 1)),
      this.latticeMaterial,
    );
    this.lattice.visible = false;
    this.root.add(this.lattice);

    for (let i = 0; i < MAX_ESCORT_DRONES; i++) this.drones.push(this.createDrone(i));
  }

  /** Drones the rig's bays are worth, given one bay's level per entry. */
  static droneCount(levels: readonly number[]): number {
    let total = 0;
    for (const level of levels) {
      const index = Math.min(Math.max(Math.round(level), 1), ESCORT_DRONES_BY_LEVEL.length) - 1;
      total += ESCORT_DRONES_BY_LEVEL[index];
    }
    return Math.min(total, MAX_ESCORT_DRONES);
  }

  /**
   * Whether the flight wants a fresh count of the rig's live bays. Walking the
   * part map every frame to find at most a couple of bays is waste, and a bay
   * torn off a quarter of a second ago is still a bay whose drones are on their
   * way home.
   */
  needsRecount(): boolean {
    return this.recountIn <= 0;
  }

  /** Tell the flight how many drones the rig's live bays are worth right now. */
  setDroneCount(count: number): void {
    this.wanted = Math.min(Math.max(count, 0), MAX_ESCORT_DRONES);
    this.recountIn = RECOUNT_INTERVAL_SECONDS;
  }

  /**
   * A drone just caught something: pop the bubble, and send the nearest of the
   * flight out to hit it. Called from the fixed step, so it only arms timers —
   * the swell and the dive are both drawn on frame time.
   *
   * @param point Where the shot was killed, in world space. Without it only the
   *   bubble goes off, which is all a caller that has no position can honestly
   *   show.
   */
  flashIntercept(point?: { x: number; y: number; z: number }): void {
    if (this.disposed) return;
    this.flashSeconds = INTERCEPT_FLASH_SECONDS;
    if (point !== undefined) this.armLunge(point);
  }

  /**
   * Pick who goes and where. The target is stored relative to the rig because
   * the root is dragged to the chassis every frame: kept in world space the
   * drones would chase a point that slides away under a moving truck, and a
   * catch taken at speed would end with the flight strung out behind.
   */
  private armLunge(point: { x: number; y: number; z: number }): void {
    this.lungeTarget.set(
      point.x - this.root.position.x,
      point.y - this.root.position.y,
      point.z - this.root.position.z,
    );

    const inFlight = this.drones.filter((drone) => drone.visibility > 0);
    const nearest = [...inFlight].sort(
      (a, b) =>
        a.group.position.distanceToSquared(this.lungeTarget) -
        b.group.position.distanceToSquared(this.lungeTarget),
    );
    for (const drone of this.drones) drone.lungeWeight = 0;
    for (const drone of inFlight) drone.lungeWeight = LEAN_FRACTION;
    for (const drone of nearest.slice(0, LUNGING_DRONES)) drone.lungeWeight = 1;

    this.lungeSeconds = LUNGE_SECONDS;
  }

  /**
   * Advance the flight for a frame. `centre` is the chassis position; the ring
   * and the bubble are both hung off it.
   */
  update(dt: number, centre: { x: number; y: number; z: number }): void {
    if (this.disposed) return;
    this.recountIn -= dt;

    const anyUp = this.wanted > 0 || this.drones.some((drone) => drone.visibility > 0);
    if (!anyUp) {
      if (this.root.visible) this.root.visible = false;
      this.flashSeconds = 0;
      this.lungeSeconds = 0;
      return;
    }
    this.root.visible = true;
    this.root.position.set(centre.x, centre.y, centre.z);
    this.clock += dt;

    const flash = this.stepFlash(dt);
    // Every rotor brightens together on a catch: the bubble says the rig was
    // covered, the rotors say by what.
    this.rotorMaterial.emissiveIntensity = 0.7 + flash * 1.6;

    const dart = this.stepLunge(dt);
    for (let i = 0; i < this.drones.length; i++) {
      this.stepDrone(this.drones[i], i < this.wanted, dt, dart);
    }
  }

  /**
   * Burn down the dive timer. Returns the 0..1 envelope every diving drone
   * flies on: snap out to the shot, then drift back to the ring, so the catch
   * lands on the frame the box dies rather than a beat after it.
   */
  private stepLunge(dt: number): number {
    if (this.lungeSeconds <= 0) return 0;
    this.lungeSeconds = Math.max(0, this.lungeSeconds - dt);
    const progress = 1 - this.lungeSeconds / LUNGE_SECONDS;
    if (progress <= LUNGE_STRIKE_FRACTION) {
      return (progress / LUNGE_STRIKE_FRACTION) ** 0.55;
    }
    const home = (progress - LUNGE_STRIKE_FRACTION) / (1 - LUNGE_STRIKE_FRACTION);
    return (1 - home) ** 1.4;
  }

  /**
   * Fly one drone round its lane and ease it in or out of the flight.
   *
   * @param dart 0..1 dive envelope shared by the flight; 0 when nobody is out.
   */
  private stepDrone(drone: EscortDrone, wanted: boolean, dt: number, dart: number): void {
    const step = dt / FADE_SECONDS;
    drone.visibility = wanted
      ? Math.min(1, drone.visibility + step)
      : Math.max(0, drone.visibility - step);
    if (drone.visibility <= 0) {
      drone.group.visible = false;
      return;
    }
    drone.group.visible = true;

    const angle = drone.phase + this.clock * drone.speed;
    const x = Math.cos(angle) * drone.radiusM;
    const z = Math.sin(angle) * drone.radiusM;
    const bob = Math.sin(this.clock * drone.bobRate + drone.phase) * BOB_AMPLITUDE_M;
    // A drone easing in drops into its lane rather than appearing in it.
    const settle = (1 - drone.visibility) * 0.9;
    const laneY = drone.heightM + bob - settle;
    drone.group.position.set(x, laneY, z);

    // Nose along the tangent, banked into the turn: the ring reads as flying
    // rather than as parts on a turntable.
    const heading = angle + (drone.speed >= 0 ? Math.PI / 2 : -Math.PI / 2);
    let yaw = Math.atan2(Math.cos(heading), Math.sin(heading));
    let roll = drone.speed >= 0 ? -0.2 : 0.2;
    let pitch = Math.sin(this.clock * drone.bobRate * 0.7) * 0.06;

    const commit = dart * drone.lungeWeight;
    if (commit > 0) {
      // Off the lane and into the shot. Levelled out of its bank and nosed at
      // the target, so the dive reads as one deliberate run rather than the
      // drone being slid sideways by something else.
      this.lungeLeg.copy(this.lungeTarget).sub(drone.group.position);
      if (this.lungeLeg.lengthSq() > MAX_LUNGE_REACH_M ** 2) {
        this.lungeLeg.setLength(MAX_LUNGE_REACH_M);
      }
      drone.group.position.addScaledVector(this.lungeLeg, commit);
      yaw = blendAngle(yaw, Math.atan2(this.lungeLeg.x, this.lungeLeg.z), commit);
      roll *= 1 - commit;
      pitch += commit * 0.35;
    }

    drone.group.rotation.set(pitch, yaw, roll);
    drone.group.scale.setScalar(0.45 + 0.55 * drone.visibility);
  }

  /**
   * Burn down the intercept timer and drive the bubble off it. Returns the
   * 0..1 envelope so the rotors can flare on the same curve.
   */
  private stepFlash(dt: number): number {
    if (this.flashSeconds <= 0) {
      if (this.bubble.visible) {
        this.bubble.visible = false;
        this.lattice.visible = false;
      }
      return 0;
    }
    this.flashSeconds = Math.max(0, this.flashSeconds - dt);
    const progress = 1 - this.flashSeconds / INTERCEPT_FLASH_SECONDS;
    // Snap up, ease down: a catch is an impact, not a swell.
    const envelope = Math.sin(Math.PI * progress) ** 0.6;
    const scale = 0.88 + progress * 0.2;

    this.bubble.visible = true;
    this.lattice.visible = true;
    this.bubble.scale.setScalar(scale);
    this.lattice.scale.setScalar(scale);
    this.bubbleMaterial.opacity = BUBBLE_OPACITY * envelope;
    this.latticeMaterial.opacity = LATTICE_OPACITY * envelope;
    return envelope;
  }

  /** Radius of the intercept bubble: clear of the chassis, inside the ring. */
  private bubbleRadiusM(): number {
    return Math.max(this.chassisRadiusM + 0.8, 2.6);
  }

  /**
   * One escort quadcopter, in metres: stubby body, lit sensor eye on the nose,
   * four arms out to glowing rotor discs. Deliberately the same read as the
   * drones parked on the bay's own mesh (`editor/parts/defence.ts`). Under half
   * a metre across — big enough to read from the chase camera, small enough
   * that a full flight of eight is an escort rather than a canopy over the rig.
   *
   * Geometry is built once per drone but the materials are shared, so the whole
   * flight flares together on an intercept and disposes as four materials.
   */
  private createDrone(index: number): EscortDrone {
    const group = new THREE.Group();
    group.visible = false;

    const body = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.17, 0.07, 0.23)),
      this.bodyMaterial,
    );
    group.add(body);

    const eye = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.032, 6, 4)),
      this.eyeMaterial,
    );
    eye.position.set(0, 0, 0.115);
    group.add(eye);

    const armGeometry = this.track(new THREE.BoxGeometry(0.22, 0.024, 0.024));
    const rotorGeometry = this.track(new THREE.CylinderGeometry(0.085, 0.085, 0.014, 8));
    for (const [ax, az] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const arm = new THREE.Mesh(armGeometry, this.armMaterial);
      arm.position.set(ax * 0.085, 0, az * 0.085);
      arm.rotation.y = ax * az > 0 ? Math.PI / 4 : -Math.PI / 4;
      group.add(arm);

      const rotor = new THREE.Mesh(rotorGeometry, this.rotorMaterial);
      rotor.position.set(ax * 0.155, 0.03, az * 0.155);
      group.add(rotor);
    }
    this.root.add(group);

    // Lanes are spread by the golden angle and detuned in radius, height and
    // rate, so however many drones are up the ring never falls into a pattern
    // and never has two of them flying the same line.
    const golden = Math.PI * (3 - Math.sqrt(5));
    const lane = index % 3;
    const outward = index % 2 === 0 ? 1 : -1;
    return {
      group,
      phase: golden * index,
      speed: outward * (0.5 + 0.09 * lane),
      radiusM: this.chassisRadiusM + 1.5 + lane * 0.45,
      heightM: RING_HEIGHT_M + lane * LANE_SPACING_M,
      bobRate: 1.6 + 0.23 * index,
      visibility: 0,
      lungeWeight: 0,
    };
  }

  /** Remember a geometry so `dispose` can free it. */
  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.bodyMaterial.dispose();
    this.armMaterial.dispose();
    this.rotorMaterial.dispose();
    this.eyeMaterial.dispose();
    this.bubbleMaterial.dispose();
    this.latticeMaterial.dispose();
  }
}
