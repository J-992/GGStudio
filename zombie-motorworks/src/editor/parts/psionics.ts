/**
 * The two ability blocks that carry no cage and no barrel: the Thumper and the
 * Mind Control Beam.
 *
 * They are here together because they are each other's opposite, and both used
 * to fall through to the generic block-plus-dome treatment in `meshes.ts` —
 * which meant the loudest kinetic ability on the shelf and the only psychic one
 * were drawn as the same lit crate.
 *
 * - The Thumper is a machine that hits things. Two opposed ram heads facing each
 *   other across a charged gap, held apart by a bank of pistons, caught in the
 *   instant before they slam. Everything about it is compression: the guide
 *   columns are thick, the heads are heavy, and the only light in it is the
 *   squeezed gap between them.
 * - The Mind Control Beam is a machine that thinks at things. A round emitter
 *   plinth with a lit dish on top, an exposed brain standing in the dish, and
 *   the control chip driving it pressed into the brain's crown. Nothing about
 *   it is armoured or enclosed: the read is that the thinking part is right
 *   there in the open, wired straight into the rig.
 *
 * Modelled at orient 0 and rotated by the placed orientation. Only the
 * structural body carries `placementSurface`, and it spans the cell footprint so
 * every flank still resolves as a build face; both parts reserve the cell above
 * (`clearanceCells`), which is what lets the hardware stand proud of the cell.
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

/** Pale grey matter, so the brain reads as tissue rather than as painted metal. */
const BRAIN_TISSUE = 0xe0a8c8;
/** The seam down the middle of the brain and the folds cut into each lobe. */
const BRAIN_FOLD = 0xa8628c;
/** Silicon body of the floating control chip. */
const CHIP_BODY = 0x2a2f38;

/**
 * Thumper: two opposed rams caught a moment before they meet.
 *
 * Built around a gap rather than around a core. The bottom ram sits on the
 * block's own bed pointing up; the top ram hangs off a yoke pointing down; a
 * ring of pistons and a lit charge column stand in the gap between the two
 * faces. The silhouette is a press, and the one thing it can plausibly do is
 * slam — which is the entire ability.
 */
export function buildThumperMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  const steel = lambert(STEEL, opacity);
  const darkSteel = lambert(DARK_STEEL, opacity);
  const ramMetal = lambert(shade(color, 0.72), opacity);
  const charge = glowLambert(shade(color, 1.35), opacity, 1);

  // Bed: the block itself, and the only placement surface. Full footprint so
  // the flanks reach the cell boundary and neighbours drop against them.
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.3, s * 0.98),
    lambert(shade(color, 0.5), opacity),
  );
  bed.position.y = -s * 0.35;
  bed.userData.placementSurface = true;
  group.add(bed);
  const bedEdges = edgesOf(bed.geometry, opacity);
  bedEdges.position.copy(bed.position);
  group.add(bedEdges);

  group.add(
    boltRing({
      count: 4,
      radius: s * 0.4 * Math.SQRT2,
      headRadius: s * 0.05,
      length: s * 0.05,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, -s * 0.19, 0),
      phase: Math.PI / 4,
      opacity,
    }),
  );

  // Guide columns: two heavy uprights carrying the top ram over the bottom one.
  // Deliberately only two, and on the flanks — four would close the gap in and
  // hide the hardware the part is about.
  const columnGeometry = new THREE.BoxGeometry(s * 0.12, s * 0.84, s * 0.16);
  for (const x of [-0.4, 0.4]) {
    const column = new THREE.Mesh(columnGeometry, darkSteel);
    column.position.set(x * s, s * 0.06, 0);
    group.add(column);
  }

  /**
   * One ram: a heavy cylinder with a machined striker face on the business end
   * and a stack of shoulder rings behind it. `faceDir` is +1 for the ram that
   * strikes upward and -1 for the one that strikes down, so the two are mirror
   * images meeting in the middle.
   */
  function ram(y: number, faceDir: 1 | -1): void {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.34, s * 0.34, s * 0.2, 14),
      ramMetal,
    );
    body.position.y = y * s;
    group.add(body);

    // Striker face: a slightly proud disc on the side that does the hitting.
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.29, s * 0.33, s * 0.05, 14),
      steel,
    );
    face.position.y = (y + faceDir * 0.12) * s;
    // Flip the taper so the narrow end always points into the gap.
    face.rotation.z = faceDir > 0 ? 0 : Math.PI;
    group.add(face);

    // Shoulder rings around the ram body, behind the striking face.
    for (const step of [0.04, 0.085]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(s * 0.34, s * 0.022, 6, 16),
        darkSteel,
      );
      ring.position.y = (y - faceDir * step) * s;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
  }

  ram(-0.1, 1);
  ram(0.4, -1);

  // Pistons standing in the gap: four small rods around a lit charge column.
  // These are what say the two heads are held apart under load rather than
  // simply parked at different heights.
  const rodGeometry = new THREE.CylinderGeometry(s * 0.045, s * 0.045, s * 0.2, 8);
  const sleeveGeometry = new THREE.CylinderGeometry(s * 0.065, s * 0.065, s * 0.08, 8);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const x = Math.cos(angle) * s * 0.2;
    const z = Math.sin(angle) * s * 0.2;

    const rod = new THREE.Mesh(rodGeometry, steel);
    rod.position.set(x, s * 0.15, z);
    group.add(rod);

    // A sleeve at each end of the rod, so it reads as travelling inside a bore.
    for (const y of [0.05, 0.25]) {
      const sleeve = new THREE.Mesh(sleeveGeometry, darkSteel);
      sleeve.position.set(x, y * s, z);
      group.add(sleeve);
    }
  }

  // The charged gap: a lit column between the two faces, with a brighter disc
  // at the exact midpoint where they are about to meet.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.11, s * 0.11, s * 0.22, 10),
    charge,
  );
  column.position.y = s * 0.15;
  group.add(column);

  const spark = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.15, s * 0.15, s * 0.025, 14),
    glowLambert(shade(color, 1.45), opacity, 0.9),
  );
  spark.position.y = s * 0.15;
  group.add(spark);

  // Yoke over the top ram, tying the two columns together — the cap that takes
  // the recoil, and what stops the silhouette from ending in a bare cylinder.
  const yoke = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.92, s * 0.09, s * 0.3),
    lambert(shade(color, 0.62), opacity),
  );
  yoke.position.y = s * 0.58;
  group.add(yoke);

  // Accumulator bottles on the yoke: the pressure the slam is stored in.
  const bottleGeometry = new THREE.CylinderGeometry(s * 0.06, s * 0.06, s * 0.14, 8);
  for (const x of [-0.28, 0.28]) {
    const bottle = new THREE.Mesh(bottleGeometry, steel);
    bottle.position.set(x * s, s * 0.69, 0);
    group.add(bottle);
  }

  const armed = new THREE.Mesh(
    new THREE.OctahedronGeometry(s * 0.05),
    glowLambert(shade(color, 1.6), opacity, 1),
  );
  armed.position.set(-s * 0.28, s * 0.79, 0);
  group.add(armed);

  return group;
}

/**
 * Mind Control Beam: a brain sitting on a circular emitter base, wearing the
 * chip that drives it.
 *
 * Read bottom to top, the block is three things: a round plinth, a lit emitter
 * dish on top of it, and a large exposed brain standing in the dish with a
 * control chip pressed into its crown. Nothing here is a box and nothing is
 * hidden — the whole point of the part is that you can see exactly what is
 * doing the thinking.
 *
 * The brain carries the detail budget for the whole block. It is built as two
 * gyrus-wrapped hemispheres over a cerebellum lump rather than as a smooth
 * sphere, because at thumbnail size a lone sphere would read as another emitter
 * dome, which is exactly what this part is being taken off.
 */
export function buildMindControlBeamMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  const darkSteel = lambert(DARK_STEEL, opacity);
  const steel = lambert(STEEL, opacity);

  // Footing: a shallow square pad at the very bottom of the cell, and the only
  // placement surface on the part. It has to be square and reach the cell
  // boundary — the editor resolves a build face by nudging the hit point along
  // its normal, so a round body inset from the cell would refuse neighbours.
  // Everything above it is free to be as round as it likes.
  const footing = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.16, s * 0.98),
    lambert(shade(color, 0.34), opacity),
  );
  footing.position.y = -s * 0.42;
  footing.userData.placementSurface = true;
  group.add(footing);
  const footingEdges = edgesOf(footing.geometry, opacity);
  footingEdges.position.copy(footing.position);
  group.add(footingEdges);

  // The circular base proper: a wide drum standing on the footing, and the
  // thing the block actually reads as from across the yard.
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.46, s * 0.49, s * 0.3, 20),
    lambert(shade(color, 0.52), opacity),
  );
  drum.position.y = -s * 0.19;
  group.add(drum);

  // Cooling ribs standing proud of the drum, and a vent slot behind each one.
  // Eight of them turn a plain cylinder into machined hardware, and they are
  // the only detail on the base that survives at thumbnail size.
  const ribGeometry = new THREE.BoxGeometry(s * 0.07, s * 0.24, s * 0.06);
  const ventGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.12, s * 0.02);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const rib = new THREE.Mesh(ribGeometry, darkSteel);
    rib.position.set(cos * s * 0.46, -s * 0.19, sin * s * 0.46);
    rib.rotation.y = -angle;
    group.add(rib);

    const vent = new THREE.Mesh(ventGeometry, darkSteel);
    vent.position.set(cos * s * 0.455, -s * 0.3, sin * s * 0.455);
    vent.rotation.y = -angle;
    group.add(vent);
  }

  // Machined collar between the drum and the dish, bolted right around.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.44, s * 0.46, s * 0.06, 20),
    steel,
  );
  collar.position.y = -s * 0.01;
  group.add(collar);
  group.add(
    boltRing({
      count: 12,
      radius: s * 0.4,
      headRadius: s * 0.035,
      length: s * 0.04,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, s * 0.02, 0),
      opacity,
    }),
  );

  // Emitter dish: a shallow lit bowl the brain stands in. Built as a cone
  // section rather than a flat disc so the light reads as coming up around the
  // tissue from every side.
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.4, s * 0.28, s * 0.08, 20, 1, true),
    glowLambert(shade(color, 1.3), opacity, 0.95),
  );
  dish.position.y = s * 0.06;
  dish.material.side = THREE.DoubleSide;
  group.add(dish);

  const dishFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.28, s * 0.28, s * 0.02, 20),
    glowLambert(shade(color, 1.5), opacity, 1.1),
  );
  dishFloor.position.y = s * 0.02;
  group.add(dishFloor);

  // Contact rim around the lip of the dish: the boundary the field is thrown
  // from, and the brightest line on the block.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.4, s * 0.02, 6, 24),
    glowLambert(shade(color, 1.6), opacity, 1),
  );
  rim.position.y = s * 0.1;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  // Four probe pins standing up out of the dish and into the underside of the
  // brain: what makes the tissue read as wired into the machine rather than
  // balanced on it.
  const probeGeometry = new THREE.CylinderGeometry(s * 0.014, s * 0.02, s * 0.14, 6);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const probe = new THREE.Mesh(probeGeometry, steel);
    probe.position.set(
      Math.cos(angle) * s * 0.19,
      s * 0.11,
      Math.sin(angle) * s * 0.19,
    );
    group.add(probe);
  }

  // ---- The brain -------------------------------------------------------
  // Sits in the dish, tilted a few degrees off square so it reads as a
  // specimen someone put there rather than as a moulded part of the housing.
  const brain = new THREE.Group();
  brain.position.y = s * 0.35;
  brain.rotation.set(0.08, 0.42, -0.05);
  group.add(brain);

  const tissue = lambert(BRAIN_TISSUE, opacity);
  const deepTissue = lambert(shade(BRAIN_TISSUE, 0.86), opacity);
  const foldMaterial = lambert(BRAIN_FOLD, opacity);

  // Two hemispheres, wide and slightly flattened, meeting on the midline.
  const lobeGeometry = new THREE.SphereGeometry(s * 0.23, 12, 10);
  for (const x of [-0.11, 0.11]) {
    const lobe = new THREE.Mesh(lobeGeometry, tissue);
    lobe.position.set(x * s, 0, 0);
    lobe.scale.set(0.88, 0.82, 1.08);
    brain.add(lobe);
  }

  // Frontal bulges on the front of each hemisphere, so the brain has a nose
  // rather than being symmetric front to back. Most of what makes it read as
  // anatomy at a glance.
  const frontalGeometry = new THREE.SphereGeometry(s * 0.12, 10, 8);
  for (const x of [-0.1, 0.1]) {
    const frontal = new THREE.Mesh(frontalGeometry, tissue);
    frontal.position.set(x * s, -s * 0.02, s * 0.16);
    frontal.scale.set(0.95, 0.85, 1);
    brain.add(frontal);
  }

  // Cerebellum: a smaller ridged lump tucked under the back of the hemispheres.
  const cerebellum = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.13, 10, 8),
    deepTissue,
  );
  cerebellum.position.set(0, -s * 0.13, -s * 0.17);
  cerebellum.scale.set(1.25, 0.72, 0.85);
  brain.add(cerebellum);

  for (const z of [-0.12, -0.17, -0.22]) {
    const ridge = new THREE.Mesh(
      new THREE.TorusGeometry(s * 0.12, s * 0.014, 5, 12),
      foldMaterial,
    );
    ridge.position.set(0, -s * 0.12, z * s);
    ridge.rotation.set(Math.PI / 2, 0, 0);
    ridge.scale.set(1, 1, 0.35);
    brain.add(ridge);
  }

  // Longitudinal fissure: the deep seam down the midline, sunk between the two
  // hemispheres rather than sitting on top of them.
  const fissure = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.03, s * 0.3, s * 0.44),
    foldMaterial,
  );
  fissure.position.y = s * 0.02;
  brain.add(fissure);

  // Gyri: rings of fold wrapped around each hemisphere at varying radius, tilt
  // and height. Five per side, each squashed flat along one axis so it hugs the
  // surface — this is the detail that makes the tissue look convoluted instead
  // of like a pair of painted bubbles.
  const gyri: readonly (readonly [number, number, number, number])[] = [
    // [radius, y, tilt about Z, yaw about Y]
    [0.2, 0.08, 0.15, 0],
    [0.21, 0.0, -0.1, 0.5],
    [0.19, -0.07, 0.28, 1.1],
    [0.16, 0.13, -0.45, 0.3],
    [0.17, -0.02, 0.62, 1.9],
  ];
  for (const side of [-1, 1] as const) {
    for (const [radius, y, tilt, yaw] of gyri) {
      const gyrus = new THREE.Mesh(
        new THREE.TorusGeometry(s * radius, s * 0.02, 5, 14),
        foldMaterial,
      );
      gyrus.position.set(side * 0.11 * s, y * s, 0);
      // Rings lie in the XY plane by default; stand them around the lobe and
      // then tip each one so no two folds run parallel.
      gyrus.rotation.set(Math.PI / 2, yaw * side, tilt * side);
      gyrus.scale.set(1, 1, 0.42);
      brain.add(gyrus);
    }
  }

  // Brain stem, running down out of the underside into the dish. The brain sits
  // on the base now, and this is the join.
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.05, s * 0.075, s * 0.16, 8),
    deepTissue,
  );
  stem.position.set(0, -s * 0.2, -s * 0.04);
  brain.add(stem);

  // ---- The control chip, mounted on the brain --------------------------
  // Pressed into the crown of the left hemisphere and tilted onto its curve, so
  // it reads as an implant rather than as a component that happens to be
  // nearby. Everything in this group is in brain-local space, so the chip tips
  // with the tissue it is driving.
  const chip = new THREE.Group();
  chip.position.set(-s * 0.08, s * 0.21, s * 0.02);
  chip.rotation.set(-0.18, 0.34, 0.26);
  brain.add(chip);

  const die = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.2, s * 0.04, s * 0.2),
    lambert(CHIP_BODY, opacity),
  );
  chip.add(die);
  chip.add(edgesOf(die.geometry, opacity));

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.11, s * 0.014, s * 0.11),
    glowLambert(shade(color, 1.5), opacity, 1.15),
  );
  core.position.y = s * 0.027;
  chip.add(core);

  // Etched traces on the die face, running out from the core to the pin banks.
  const traceGeometry = new THREE.BoxGeometry(s * 0.015, s * 0.008, s * 0.055);
  const traceMaterial = glowLambert(shade(color, 1.7), opacity, 1);
  for (const z of [-1, 1]) {
    for (const x of [-0.05, 0, 0.05]) {
      const trace = new THREE.Mesh(traceGeometry, traceMaterial);
      trace.position.set(x * s, s * 0.026, z * s * 0.085);
      chip.add(trace);
    }
  }

  // Pins pressed down into the tissue on all four sides — bent down rather than
  // sticking out flat, which is what says the chip is *in* the brain.
  const pinGeometry = new THREE.BoxGeometry(s * 0.018, s * 0.055, s * 0.018);
  const pinMaterial = lambert(shade(color, 1.15), opacity);
  for (const [dx, dz, lean] of [
    [-0.11, 0, 0.5],
    [0.11, 0, -0.5],
    [0, -0.11, -0.5],
    [0, 0.11, 0.5],
  ] as const) {
    for (const offset of [-0.06, 0.06]) {
      const pin = new THREE.Mesh(pinGeometry, pinMaterial);
      pin.position.set(
        (dx === 0 ? offset : dx) * s,
        -s * 0.025,
        (dz === 0 ? offset : dz) * s,
      );
      // Splay the pins outward down the curve of the hemisphere.
      if (dx === 0) pin.rotation.x = lean * 0.5;
      else pin.rotation.z = lean * 0.5;
      chip.add(pin);
    }
  }

  return group;
}
