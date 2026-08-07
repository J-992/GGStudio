/**
 * Defence meshes: the shield generator, the pulse emitter and the drone swarm
 * bay.
 *
 * The shield generator and the pulse emitter are both field devices — sealed
 * boxes that project something and never open — so they share a skeleton that
 * says so: an armoured plinth with a machined deck and a bolt ring, four
 * tapered cage posts, and hardware standing in the cage. What tells those two
 * apart is what the cage holds: a gyro-ringed shield core, or a stacked
 * concussion coil under a striker.
 *
 * The drone bay is deliberately not built on that skeleton. It is the one
 * defensive block whose hardware leaves the rig, so it is a hangar rather than
 * an emitter: a flat carrier deck with sliding bay doors, a lit launch trench,
 * a comms mast off one corner and drones on the pad. Same signal green, wholly
 * different silhouette — no player should have to read the label to tell it
 * from the shield generator.
 *
 * Only the structural body (plinth or hull) carries `placementSurface`; it
 * spans the cell footprint so the flanks and the underside still resolve as
 * build faces. All three reserve the cell above (`clearanceCells`), which is
 * what lets the hardware on top stand slightly proud of the cell without ever
 * colliding with a neighbour.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  STEEL,
  boltRing,
  edgesOf,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

/** Height of the cage posts' top, in cell units above the cell centre. */
const CAGE_TOP = 0.3;

/**
 * The shared lower half: armoured plinth, machined deck, bolt ring and the four
 * tapered posts that cage whatever the part emits.
 */
function emitterBase(color: number, opacity: number, accent: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();

  // Plinth: the block itself. Full footprint so the flanks reach the cell
  // boundary and neighbours can still be dropped against them.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.4, s * 0.98),
    lambert(shade(color, 0.62), opacity),
  );
  plinth.position.y = -s * 0.5 + s * 0.2;
  plinth.userData.placementSurface = true;
  group.add(plinth);
  const plinthEdges = edgesOf(plinth.geometry, opacity);
  plinthEdges.position.copy(plinth.position);
  group.add(plinthEdges);

  // Cooling louvres on each flank — three slots per side, standing a little
  // proud of the plinth so they read as raised fins rather than z-fighting
  // decals, and still short of the cell boundary so they never clip a
  // neighbouring block.
  const louvre = new THREE.BoxGeometry(s * 0.62, s * 0.045, s * 0.03);
  const louvreMaterial = lambert(DARK_STEEL, opacity);
  for (const turn of [0, 1, 2, 3]) {
    const bank = new THREE.Group();
    bank.rotation.y = (turn * Math.PI) / 2;
    for (const row of [-1, 0, 1]) {
      const slot = new THREE.Mesh(louvre, louvreMaterial);
      slot.position.set(0, -s * 0.4 + row * s * 0.08, s * 0.48);
      bank.add(slot);
    }
    group.add(bank);
  }

  // Machined deck: a stepped collar on top of the plinth, the surface the cage
  // and the emitter hardware are bolted through.
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.42, s * 0.46, s * 0.1, 8),
    lambert(STEEL, opacity),
  );
  deck.position.y = -s * 0.06;
  group.add(deck);
  group.add(
    boltRing({
      count: 8,
      radius: s * 0.38,
      headRadius: s * 0.04,
      length: s * 0.05,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, -s * 0.01, 0),
      phase: Math.PI / 8,
      opacity,
    }),
  );

  // Cage posts: tapered four-sided pillars at the deck corners, each capped by
  // a lit node so the device reads as powered from any angle.
  const post = new THREE.CylinderGeometry(s * 0.045, s * 0.075, s * 0.36, 4);
  const postMaterial = lambert(DARK_STEEL, opacity);
  const nodeGeometry = new THREE.OctahedronGeometry(s * 0.05);
  const nodeMaterial = glowLambert(accent, opacity, 0.85);
  for (const turn of [0, 1, 2, 3]) {
    const angle = Math.PI / 4 + (turn * Math.PI) / 2;
    const x = Math.cos(angle) * s * 0.34;
    const z = Math.sin(angle) * s * 0.34;

    const pillar = new THREE.Mesh(post, postMaterial);
    pillar.position.set(x, s * 0.12, z);
    pillar.rotation.y = angle;
    group.add(pillar);

    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    node.position.set(x, s * CAGE_TOP, z);
    group.add(node);
  }

  return group;
}

/**
 * Shield generator: a caged field core with a gyro ring cluster.
 *
 * The core is a faceted crystal rather than a dome — it catches the flat-shaded
 * lighting from every angle, and the three rings around it read as a projector
 * even when the shield itself is down.
 */
export function buildShieldGeneratorMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(emitterBase(color, opacity, shade(color, 1.5)));

  const coreY = s * 0.15;

  // Field core: a small, bright crystal floating on a projector stem.
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.12, s * 0.14, 8),
    lambert(STEEL, opacity),
  );
  stem.position.y = s * 0.01;
  group.add(stem);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(s * 0.19, 0),
    glowLambert(shade(color, 1.45), opacity, 1.1),
  );
  core.position.y = coreY;
  core.rotation.set(0.4, 0.6, 0);
  group.add(core);

  // Gyro rings: one horizontal, two upright and crossed. Steel with a lit
  // inner band, so the cluster still reads as hardware in flat light.
  const ringMaterial = lambert(shade(color, 0.78), opacity);
  const ringGeometry = new THREE.TorusGeometry(s * 0.31, s * 0.022, 6, 20);
  const rings: [number, number, number][] = [
    [Math.PI / 2, 0, 0],
    [0, 0, 0.22],
    [0, Math.PI / 2, -0.22],
  ];
  for (const [rx, ry, rz] of rings) {
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.y = coreY;
    ring.rotation.set(rx, ry, rz);
    group.add(ring);
  }

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.26, s * 0.012, 6, 20),
    glowLambert(shade(color, 1.6), opacity, 0.95),
  );
  halo.position.y = coreY;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  return group;
}

/**
 * Drone swarm bay: a flat carrier deck with the doors open and a drone up.
 *
 * Built to be unmistakable next to the shield generator, which is the block it
 * used to share a skeleton with. Everything the two had in common is gone: no
 * plinth, no bolted collar, no cage posts, no glowing core in a cradle. What is
 * here instead is a hangar — a squat armoured hull with a flush deck, two
 * sliding bay doors retracted to either side, and a lit launch trench down the
 * middle with an elevator plate holding a drone at the lip. A comms mast stands
 * off one corner, which breaks the symmetry every other emitter in the game
 * has and is most of what makes the block read at thumbnail size.
 *
 * The signal green is kept: the bay is still the defensive block whose hardware
 * leaves the rig, and the colour is what says so from across the yard.
 */
export function buildDroneSwarmMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  // Hull: the block itself, and the only placement surface. Full footprint so
  // the flanks reach the cell boundary and neighbours drop against them; the
  // deck it leaves on top sits at DECK_Y.
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.62, s * 0.98),
    lambert(shade(color, 0.66), opacity),
  );
  hull.position.y = -s * 0.19;
  hull.userData.placementSurface = true;
  group.add(hull);
  const hullEdges = edgesOf(hull.geometry, opacity);
  hullEdges.position.copy(hull.position);
  group.add(hullEdges);
  const DECK_Y = 0.12;

  // Intake grilles down the flanks: slats standing proud of the hull, short of
  // the cell boundary so they never clip a neighbouring block.
  const slat = new THREE.BoxGeometry(s * 0.03, s * 0.05, s * 0.52);
  const slatMaterial = lambert(DARK_STEEL, opacity);
  for (const x of [-0.485, 0.485]) {
    for (const row of [-1, 0, 1]) {
      const fin = new THREE.Mesh(slat, slatMaterial);
      fin.position.set(x * s, (-0.3 + row * 0.11) * s, 0);
      group.add(fin);
    }
  }

  // Service hatch on the nose, bolted shut: the fore face needs something that
  // is not a louvre bank, and a round hatch on a square hull sells "hangar".
  const hatch = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.15, s * 0.15, s * 0.04, 12),
    lambert(STEEL, opacity),
  );
  hatch.position.set(0, -s * 0.2, s * 0.49);
  hatch.rotation.x = Math.PI / 2;
  group.add(hatch);
  group.add(
    boltRing({
      count: 8,
      radius: s * 0.21,
      headRadius: s * 0.035,
      length: s * 0.04,
      axis: new THREE.Vector3(0, 0, 1),
      centre: new THREE.Vector3(0, -s * 0.2, s * 0.49),
      opacity,
    }),
  );

  // Coaming: a raised rim right around the deck, so the flat top reads as a
  // deck something lands on rather than as the top of a crate.
  const rimMaterial = lambert(STEEL, opacity);
  const rimLong = new THREE.BoxGeometry(s * 0.98, s * 0.07, s * 0.08);
  const rimSide = new THREE.BoxGeometry(s * 0.08, s * 0.07, s * 0.98);
  for (const z of [-0.45, 0.45]) {
    const rim = new THREE.Mesh(rimLong, rimMaterial);
    rim.position.set(0, (DECK_Y + 0.035) * s, z * s);
    group.add(rim);
  }
  for (const x of [-0.45, 0.45]) {
    const rim = new THREE.Mesh(rimSide, rimMaterial);
    rim.position.set(x * s, (DECK_Y + 0.035) * s, 0);
    group.add(rim);
  }

  // Approach lights at the deck corners: four small lit nodes, the bay's
  // landing pattern. Cheap, and they keep the deck powered from any angle.
  const lampGeometry = new THREE.OctahedronGeometry(s * 0.04);
  const lampMaterial = glowLambert(shade(color, 1.7), opacity, 0.9);
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.42, 0.42]) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(x * s, (DECK_Y + 0.09) * s, z * s);
      group.add(lamp);
    }
  }

  // Launch trench: a lit slot straight down the middle of the deck, with the
  // two bay doors slid back off it. Doors open is the part's resting state —
  // this bay is never closed.
  const trench = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.3, s * 0.035, s * 0.78),
    glowLambert(shade(color, 1.75), opacity, 1),
  );
  trench.position.y = (DECK_Y + 0.015) * s;
  group.add(trench);

  const doorGeometry = new THREE.BoxGeometry(s * 0.3, s * 0.06, s * 0.78);
  const doorMaterial = lambert(shade(color, 0.88), opacity);
  const stripeGeometry = new THREE.BoxGeometry(s * 0.26, s * 0.02, s * 0.05);
  for (const x of [-0.3, 0.3]) {
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(x * s, (DECK_Y + 0.03) * s, 0);
    group.add(door);
    // Hazard bars across each door: deck markings, and the detail that reads
    // as machinery rather than as a lit panel when the block is small.
    for (const z of [-0.22, 0.22]) {
      const stripe = new THREE.Mesh(stripeGeometry, slatMaterial);
      stripe.position.set(x * s, (DECK_Y + 0.068) * s, z * s);
      group.add(stripe);
    }
  }

  // Elevator plate at the aft end of the trench, holding the next drone at the
  // lip: the bay is caught mid-cycle rather than parked.
  const elevator = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.26, s * 0.05, s * 0.26),
    rimMaterial,
  );
  elevator.position.set(0, (DECK_Y + 0.05) * s, -s * 0.22);
  group.add(elevator);

  // Comms mast off the port quarter: the asymmetric spike that separates this
  // block's silhouette from every other emitter on the rig.
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.03, s * 0.05, s * 0.4, 6),
    lambert(DARK_STEEL, opacity),
  );
  mast.position.set(-s * 0.36, (DECK_Y + 0.2) * s, -s * 0.36);
  group.add(mast);

  const radar = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.26, s * 0.02, s * 0.06),
    rimMaterial,
  );
  radar.position.set(-s * 0.36, (DECK_Y + 0.41) * s, -s * 0.36);
  radar.rotation.y = 0.6;
  group.add(radar);

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(s * 0.045),
    glowLambert(shade(color, 1.8), opacity, 1),
  );
  beacon.position.set(-s * 0.36, (DECK_Y + 0.46) * s, -s * 0.36);
  group.add(beacon);

  /**
   * One quadcopter: a stubby body, a lit sensor eye on the nose, four arms out
   * to blurred rotor discs. Built once per call rather than instanced because
   * the parked pair and the flying one differ only in where they sit — and
   * matched by the escort drones drawn around the rig in survival
   * (`survival/DroneEscort.ts`), so the bay and its flight read as one part.
   */
  const droneBody = new THREE.BoxGeometry(s * 0.11, s * 0.045, s * 0.14);
  const droneMaterial = lambert(shade(color, 1.05), opacity);
  const armGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.014, s * 0.014);
  const armMaterial = lambert(DARK_STEEL, opacity);
  const rotorGeometry = new THREE.CylinderGeometry(
    s * 0.055,
    s * 0.055,
    s * 0.008,
    8,
  );
  const rotorMaterial = glowLambert(shade(color, 1.75), opacity, 0.7);
  const eyeGeometry = new THREE.SphereGeometry(s * 0.02, 6, 4);
  const eyeMaterial = glowLambert(0xff5a3c, opacity, 1);

  function drone(): THREE.Group {
    const unit = new THREE.Group();
    const body = new THREE.Mesh(droneBody, droneMaterial);
    unit.add(body);

    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(0, 0, s * 0.07);
    unit.add(eye);

    for (const [ax, az] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const arm = new THREE.Mesh(armGeometry, armMaterial);
      arm.position.set(ax * s * 0.055, 0, az * s * 0.055);
      arm.rotation.y = ax * az > 0 ? Math.PI / 4 : -Math.PI / 4;
      unit.add(arm);

      const rotor = new THREE.Mesh(rotorGeometry, rotorMaterial);
      rotor.position.set(ax * s * 0.1, s * 0.018, az * s * 0.1);
      unit.add(rotor);
    }
    return unit;
  }

  // One riding the elevator up out of the trench, one parked on the starboard
  // door with its nose out over the rail.
  const onDeck: [number, number, number, number][] = [
    [0, -0.22, DECK_Y + 0.115, 0.12],
    [0.3, 0.2, DECK_Y + 0.09, -0.5],
  ];
  for (const [x, z, y, yaw] of onDeck) {
    const unit = drone();
    unit.position.set(x * s, y * s, z * s);
    unit.rotation.y = yaw;
    group.add(unit);
  }

  // The one already up, banked over the open trench and clear of the mast:
  // the bay is never idle, and something is always in the air over it.
  const airborne = drone();
  airborne.position.set(s * 0.06, s * (DECK_Y + 0.38), s * 0.08);
  airborne.rotation.set(0.16, 0.5, -0.1);
  airborne.scale.setScalar(1.2);
  group.add(airborne);

  return group;
}

/**
 * Pulse emitter: a stacked concussion coil under a striker.
 *
 * Three coil plates of shrinking radius separated by lit gaps, braced by radial
 * vanes, with a hex-headed striker sitting on top of the stack — a part that
 * looks like it slams downwards, which is exactly what the ability does.
 */
export function buildPulseEmitterMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(emitterBase(color, opacity, shade(color, 1.55)));

  // Coil stack: plate, lit gap, plate — each tier narrower than the one below.
  const plateMaterial = lambert(shade(color, 0.9), opacity);
  const gapMaterial = glowLambert(shade(color, 1.55), opacity, 1);
  const tiers: [number, number][] = [
    [0.34, 0.03],
    [0.28, 0.14],
    [0.21, 0.24],
  ];
  for (const [radius, y] of tiers) {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * s, radius * s * 1.06, s * 0.07, 12),
      plateMaterial,
    );
    plate.position.y = y * s;
    group.add(plate);

    const gap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * s * 0.94, radius * s * 0.94, s * 0.035, 12),
      gapMaterial,
    );
    gap.position.y = (y + 0.05) * s;
    group.add(gap);
  }

  // Radial vanes bracing the stack to the deck: what takes the recoil when the
  // ring goes off.
  const vaneGeometry = new THREE.BoxGeometry(s * 0.035, s * 0.26, s * 0.16);
  const vaneMaterial = lambert(DARK_STEEL, opacity);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const vane = new THREE.Mesh(vaneGeometry, vaneMaterial);
    vane.position.set(Math.cos(angle) * s * 0.3, s * 0.06, Math.sin(angle) * s * 0.3);
    vane.rotation.y = -angle;
    group.add(vane);
  }

  // Striker: a short ram under a hex head, standing in the cage.
  const ram = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.09, s * 0.12, 8),
    lambert(STEEL, opacity),
  );
  ram.position.y = s * 0.32;
  group.add(ram);

  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.15, s * 0.11, s * 0.09, 6),
    lambert(shade(color, 0.7), opacity),
  );
  head.position.y = s * (CAGE_TOP + 0.08);
  group.add(head);

  return group;
}
