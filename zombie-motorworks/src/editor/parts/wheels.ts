/**
 * Wheel and tank-tread meshes.
 *
 * A wheel is built around its `WheelDefinition` so the drawn radius and width
 * are the ones the physics uses: a dark rubber tyre with tread blocks cut into
 * it, wrapped around a brightly coloured rim. Tread pattern *and* rim per part
 * id are a small table, the same shape the weapon barrels use.
 *
 * The rim is what tells the three wheels apart. Rubber is rubber — three tyres
 * differing only by a few points of near-black read as one part in the shop and
 * on the rig — so each wheel instead carries its own rim colour, rim diameter
 * and spoke pattern: a silver five-spoke alloy on the road wheel, an amber
 * beadlock with bolts on the off-road one, a red wire hoop on the racer. The
 * rim is only the *default* hub colour; a painted wheel takes the player's
 * paint there instead, which is what paint has always done.
 *
 * Everything a wheel draws lives under the `wheel-spin` group, which the shared
 * per-frame code rotates about its local +Y — so the hub and tread turn with
 * the tyre.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import { rotateVec } from '../../core/grid.ts';
import { boltRing, DARK_STEEL, lambert, partColor, shade, toVector3 } from './shared.ts';
import { addWheelUpgrades, placedUpgradeLevel } from './upgradeKit.ts';

interface WheelStyle {
  /** Tread blocks per row around the circumference. */
  lugCount: number;
  /** Rows of tread blocks across the tyre. */
  lugRows: number;
  /** Tread block height as a fraction of the wheel radius. */
  lugDepth: number;
  /** Total tread band width as a fraction of the tyre width, split over rows. */
  lugWidth: number;
  /** Skew per row, radians — staggered rows read as an aggressive pattern. */
  lugStagger: number;
  /** Rim/hub colour on an unpainted wheel. */
  rim: number;
  /** Rim barrel radius as a fraction of the tyre carcass radius. */
  rimRadius: number;
  /** Spokes across each rim face. */
  spokeCount: number;
  /** Spoke width as a fraction of the rim radius. */
  spokeWidth: number;
  /** Beadlock bolts per rim face; 0 for none. */
  boltCount: number;
}

const DEFAULT_STYLE: WheelStyle = {
  lugCount: 16,
  lugRows: 1,
  lugDepth: 0.2,
  lugWidth: 0.86,
  lugStagger: 0,
  rim: 0xb6c1cf,
  rimRadius: 0.64,
  spokeCount: 5,
  spokeWidth: 0.3,
  boltCount: 0,
};

const WHEEL_STYLES: Record<string, Partial<WheelStyle>> = {
  // Deep staggered paddles across the full tread: the off-road wheel should
  // look like it bites. Amber beadlock rim, bolted on, sunk deep inside a tall
  // sidewall — the shape a mud tyre actually has.
  'wheel-offroad': {
    lugCount: 11,
    lugRows: 2,
    lugDepth: 0.32,
    lugWidth: 0.96,
    lugStagger: 0.3,
    rim: 0xd4842a,
    rimRadius: 0.54,
    spokeCount: 6,
    spokeWidth: 0.44,
    boltCount: 8,
  },
  // Road tyre: blocky but shallower than the paddles, on a clean silver alloy.
  'wheel-standard': {
    lugCount: 15,
    lugRows: 1,
    lugDepth: 0.2,
    lugWidth: 0.88,
    rim: 0xb6c1cf,
    rimRadius: 0.66,
    spokeCount: 5,
    spokeWidth: 0.32,
  },
  // Racing hoop — narrow, so the tread stays fine. Big red wire rim under a
  // low-profile sidewall, which is the whole silhouette of a sport bike wheel.
  'wheel-moto': {
    lugCount: 20,
    lugRows: 1,
    lugDepth: 0.14,
    lugWidth: 0.92,
    rim: 0xcc4236,
    rimRadius: 0.78,
    spokeCount: 10,
    spokeWidth: 0.13,
  },
};

/** Cleat, roller and hub colour on an unpainted tread. */
const TREAD_RIM = 0x8e97a1;

function styleFor(def: PartDefinition): WheelStyle {
  return { ...DEFAULT_STYLE, ...(WHEEL_STYLES[def.id] ?? {}) };
}

/**
 * Hardware colour for a wheel: the player's paint when they have chosen one,
 * otherwise the part's own rim colour.
 *
 * `color` arrives from `buildPartMesh` already resolved to paint-or-default,
 * and for a wheel that default is the tyre rubber — which is exactly the colour
 * the rim must not be. So the unpainted case is re-resolved here instead.
 */
function rimColor(placed: PlacedPart, color: number, fallback: number): number {
  return placed.config.paint ? color : fallback;
}

/**
 * Standard road/off-road/motorcycle wheel. `color` is the player's paint (or
 * the part default) and only reaches the rim and hub — tyre and tread stay
 * rubber, so a painted wheel still reads as a wheel.
 */
export function buildWheelMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const group = new THREE.Group();
  const w = def.wheel;
  if (!w) return group;
  const style = styleFor(def);
  const centre = cellCentreM(placed.pos);
  const rubber = partColor(def);
  const hardware = rimColor(placed, color, style.rim);
  const wheel = new THREE.Group();
  wheel.name = 'wheel-spin';

  // Two rubbers, not one: the carcass is the floor of the grooves, so it is the
  // darker of the pair and the tread blocks standing on it catch the light.
  // That is what makes a tread pattern read at all on a near-black tyre.
  const tyreMaterial = lambert(rubber, opacity);
  const carcassMaterial = lambert(shade(rubber, 0.72), opacity);

  // The tread blocks form the outer surface, so the carcass is cut back to the
  // groove floor: the silhouette still tops out at exactly the physics radius,
  // however deep the tread gets, instead of hovering the wheel off the ground.
  const lugHeight = w.radius * style.lugDepth;
  const carcassRadius = w.radius - lugHeight * 0.62;

  // The tyre is a tube, not a disc. A solid cylinder would bury the rim inside
  // it and leave the wheel a flat black coin from the side; an open band with a
  // sidewall annulus on each face lets the rim fill the middle, which is what
  // an actual wheel looks like.
  const rimRadius = carcassRadius * style.rimRadius;
  const carcass = new THREE.Mesh(
    new THREE.CylinderGeometry(carcassRadius, carcassRadius, w.width, 20, 1, true),
    carcassMaterial,
  );
  carcass.userData.placementSurface = true;
  wheel.add(carcass);

  // Sidewall: the wall of rubber between tread and rim, in the lighter of the
  // two rubbers so the wheel has a visible wall rather than one dark mass.
  for (const side of [-1, 1]) {
    const sidewall = new THREE.Mesh(
      new THREE.RingGeometry(rimRadius * 0.97, carcassRadius, 20),
      tyreMaterial,
    );
    // A ring lies in XY facing +Z; stand it up on the tyre's face.
    sidewall.rotation.x = (-side * Math.PI) / 2;
    sidewall.position.y = (side * w.width) / 2;
    sidewall.userData.placementSurface = true;
    wheel.add(sidewall);
  }

  // Tread blocks: one InstancedMesh for the whole pattern.
  const lugTotal = style.lugCount * style.lugRows;
  if (lugTotal > 0 && style.lugDepth > 0) {
    // Sized off the arc spacing so a low count means chunky blocks with real
    // gaps between them rather than thin fins on a wide tyre.
    const lugLength = ((Math.PI * 2 * w.radius) / style.lugCount) * 0.58;
    const lugGeometry = new THREE.BoxGeometry(
      lugLength,
      lugHeight * 1.6,
      (w.width * style.lugWidth) / style.lugRows,
    );
    const lugs = new THREE.InstancedMesh(lugGeometry, tyreMaterial, lugTotal);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const rowSpan = w.width * style.lugWidth;
    let index = 0;
    for (let row = 0; row < style.lugRows; row++) {
      const y =
        style.lugRows === 1
          ? 0
          : -rowSpan / 2 + ((row + 0.5) / style.lugRows) * rowSpan;
      for (let i = 0; i < style.lugCount; i++) {
        const angle = (i / style.lugCount) * Math.PI * 2 + row * style.lugStagger;
        // Block +Y points out of the tyre, +X follows the rolling direction and
        // +Z runs across the tread (the wheel's axle, local +Y).
        const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        quat.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)),
            out,
            new THREE.Vector3(0, 1, 0),
          ),
        );
        // Outer face lands on the physics radius; the rest sinks into the carcass.
        position.copy(out).multiplyScalar(w.radius - lugHeight * 0.8);
        position.y = y;
        lugs.setMatrixAt(index++, matrix.compose(position, quat, scale));
      }
    }
    lugs.instanceMatrix.needsUpdate = true;
    wheel.add(lugs);
  }

  // Rim barrel: the wheel's interior, and the one part of it that is not
  // rubber. Slightly narrower than the tyre, so it sits recessed between the
  // sidewalls with the spokes flush to the face.
  const rimMaterial = lambert(hardware, opacity);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(rimRadius, rimRadius, w.width * 0.82, 18),
    rimMaterial,
  );
  rim.userData.placementSurface = true;
  wheel.add(rim);

  // Spokes: a darker shade of the rim, standing proud of each rim face so the
  // wheel centre has a pattern instead of being a flat coin. One InstancedMesh
  // covers both faces — a ten-spoke racing hoop is still a single draw call.
  const hubRadius = Math.max(rimRadius * 0.28, w.radius * 0.12);
  if (style.spokeCount > 0) {
    const spokeMaterial = lambert(shade(hardware, 0.62), opacity);
    const spokeLength = rimRadius - hubRadius * 0.6;
    const spokeGeometry = new THREE.BoxGeometry(
      spokeLength,
      w.width * 0.14,
      rimRadius * style.spokeWidth,
    );
    const spokes = new THREE.InstancedMesh(
      spokeGeometry,
      spokeMaterial,
      style.spokeCount * 2,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    let index = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < style.spokeCount; i++) {
        // Half a spoke of offset between the faces, so the two sides never line
        // up into one thick bar when the wheel is seen edge-on.
        const angle =
          ((i + (side > 0 ? 0.5 : 0)) / style.spokeCount) * Math.PI * 2;
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
        position.set(
          Math.cos(angle) * (hubRadius * 0.6 + spokeLength / 2),
          side * w.width * 0.44,
          Math.sin(angle) * (hubRadius * 0.6 + spokeLength / 2),
        );
        spokes.setMatrixAt(index++, matrix.compose(position, quat, scale));
      }
    }
    spokes.instanceMatrix.needsUpdate = true;
    wheel.add(spokes);
  }

  // Beadlock bolts around the rim edge — the off-road wheel's tell.
  if (style.boltCount > 0) {
    for (const side of [-1, 1]) {
      wheel.add(
        boltRing({
          count: style.boltCount,
          radius: rimRadius * 0.88,
          headRadius: rimRadius * 0.11,
          length: w.width * 0.14,
          axis: new THREE.Vector3(0, side, 0),
          centre: new THREE.Vector3(0, side * w.width * 0.44, 0),
          color: DARK_STEEL,
          opacity,
        }),
      );
    }
  }

  // Hub, proud of the rim on both faces so the wheel has a centre.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubRadius, hubRadius, w.width * 1.2, 14),
    lambert(shade(hardware, 1.16), opacity),
  );
  hub.userData.placementSurface = true;
  wheel.add(hub);
  const capMaterial = lambert(shade(hardware, 0.5), opacity);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(hubRadius * 0.5, hubRadius * 0.5, w.width * 0.18, 10),
      capMaterial,
    );
    cap.position.y = side * w.width * 0.64;
    wheel.add(cap);
  }

  // Unlocked hardware rides inside the spin group, so rims and studs turn with
  // the tyre they are bolted to — and take the rim's colour, so a beadlock ring
  // reads as part of the same wheel rather than a lightened tyre.
  addWheelUpgrades(wheel, w, placedUpgradeLevel(placed), hardware, opacity);

  // Cylinder geometry runs along +Y; align that to the placed axle axis.
  const axle = rotateVec(placed.orient, w.axleAxis);
  wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toVector3(axle));
  wheel.position.set(centre.x, centre.y, centre.z);
  group.add(wheel);
  return group;
}

/**
 * Tank tread: a static belt spanning the part's cells along local Z, with
 * rollers inside it that spin. Only the rollers go in `wheel-spin` — rotating
 * the belt itself would read as a giant wheel.
 */
export function buildTreadMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const group = new THREE.Group();
  const w = def.wheel;
  if (!w) return group;
  const s = CELL_SIZE;
  const centre = cellCentreM(placed.pos);
  const span = (def.cells.length - 1) * s; // end-roller centre separation
  const rollerR = w.radius * 0.86;
  const beltMaterial = lambert(partColor(def), opacity);
  const treadGroup = new THREE.Group();

  // Belt: a slab between the end caps, plus a rounded cap at each end.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w.width, rollerR * 2, span), beltMaterial);
  slab.userData.placementSurface = true;
  treadGroup.add(slab);
  for (const end of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(rollerR, rollerR, w.width, 14),
      beltMaterial,
    );
    cap.rotation.z = Math.PI / 2; // cylinder +Y -> local X (the axle)
    cap.position.set(0, 0, (end * span) / 2);
    cap.userData.placementSurface = true;
    treadGroup.add(cap);
  }

  // Cleats around the belt perimeter, in the paint colour so a painted tread
  // still reads as the player's — and in bare steel when it is unpainted, which
  // is the only thing that separates them from the belt they sit on.
  const cleatMaterial = lambert(rimColor(placed, color, TREAD_RIM), opacity);
  const cleatGeometry = new THREE.BoxGeometry(w.width * 1.08, s * 0.1, s * 0.16);
  const cleatsPerSide = def.cells.length * 2;
  for (let i = 0; i < cleatsPerSide; i++) {
    const z = -span / 2 + ((i + 0.5) / cleatsPerSide) * span;
    for (const side of [-1, 1]) {
      const cleat = new THREE.Mesh(cleatGeometry, cleatMaterial);
      cleat.position.set(0, side * rollerR, z);
      treadGroup.add(cleat);
    }
  }

  // Spinning rollers, visible through the gap between the cleats.
  const rollerGroup = new THREE.Group();
  const rollerMaterial = lambert(shade(rimColor(placed, color, TREAD_RIM), 0.62), opacity);
  const rollerGeometry = new THREE.CylinderGeometry(
    rollerR * 0.55,
    rollerR * 0.55,
    w.width * 1.12,
    10,
  );
  for (let i = 0; i < def.cells.length; i++) {
    const roller = new THREE.Mesh(rollerGeometry, rollerMaterial);
    // Cylinder axis is +Y, which the roller basis below puts on the axle.
    roller.position.set(0, 0, -span / 2 + (i / (def.cells.length - 1)) * span);
    rollerGroup.add(roller);
  }
  rollerGroup.name = 'wheel-spin';

  const axleV = toVector3(rotateVec(placed.orient, w.axleAxis)).normalize();
  const longV = toVector3(rotateVec(placed.orient, { x: 0, y: 0, z: 1 })).normalize();
  const upV = new THREE.Vector3().crossVectors(longV, axleV).normalize();

  // Belt basis: local X is the axle, local Z the belt's long axis, matching how
  // the slab and caps were built above.
  treadGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axleV, upV, longV));
  // Roller basis: local Y is the axle, because the shared per-frame code spins
  // wheels with rotateY.
  rollerGroup.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(axleV, longV).normalize(),
      axleV,
      longV,
    ),
  );
  for (const part of [treadGroup, rollerGroup]) {
    part.position.set(centre.x, centre.y, centre.z);
    group.add(part);
  }
  return group;
}
