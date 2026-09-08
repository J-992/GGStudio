/**
 * Pure geometry for the circular arena: gate/slot layout, and the linear map
 * between world metres and the build-overlay's normalised map units.
 *
 * Degrees→radians conversion lives ONLY in this module — everywhere else
 * (waves, enemy/boss brains, the overlay) works in whichever unit it already
 * has and calls into here to cross the boundary.
 *
 * World convention: +z is "down" on the build-phase map (and, symmetrically,
 * screen-down in the top-down overlay). Gate angle 0° points to -z ("up"/
 * north); angle increases clockwise, the way a compass bearing does, so 90°
 * points to +x ("right"/east).
 */

const DEG2RAD = Math.PI / 180;

/**
 * @param {number} angleDeg
 * @param {number} radius
 * @returns {{x: number, z: number}}
 */
function pointOnCircle(angleDeg, radius) {
  const a = angleDeg * DEG2RAD;
  return { x: radius * Math.sin(a), z: -radius * Math.cos(a) };
}

/**
 * @param {import('./types.js').GameConfig} cfg `CONFIG` (or any object with an `.arena` shaped the same way).
 * @returns {{ id: number, angleDeg: number, x: number, z: number }[]} One entry per `arena.gateAngles`, in order.
 */
export function gatePositions(cfg) {
  const { gateAngles, gateRadius } = cfg.arena;
  return gateAngles.map((angleDeg, id) => ({ id, angleDeg, ...pointOnCircle(angleDeg, gateRadius) }));
}

/**
 * 9 build slots: for every gate, one slot each at `gate angle + slotOffsets[i]`
 * degrees, all at `arena.slotRadius`. With the default 3 gates x 3 offsets
 * that is 9 slots, none closer to a gate's own angle than the smallest
 * configured offset — comfortably outside `gateWidth`.
 *
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ id: number, gateId: number, angleDeg: number, x: number, z: number }[]}
 */
export function slotPositions(cfg) {
  const { gateAngles, slotOffsets, slotRadius } = cfg.arena;
  const slots = [];
  let id = 0;
  for (let gateId = 0; gateId < gateAngles.length; gateId++) {
    for (const offset of slotOffsets) {
      const angleDeg = gateAngles[gateId] + offset;
      slots.push({ id: id++, gateId, angleDeg, ...pointOnCircle(angleDeg, slotRadius) });
    }
  }
  return slots;
}

/**
 * World metres -> normalised build-overlay map units (matching the overlay's
 * `viewBox="-100 -100 200 200"`, arena wall at ~90).
 *
 * @param {number} x
 * @param {number} z
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ x: number, z: number }}
 */
export function worldToMap(x, z, cfg) {
  const scale = 90 / cfg.arena.radius;
  return { x: x * scale, z: z * scale };
}

/**
 * Inverse of {@link worldToMap}.
 *
 * @param {number} mx
 * @param {number} mz
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ x: number, z: number }}
 */
export function mapToWorld(mx, mz, cfg) {
  const scale = cfg.arena.radius / 90;
  return { x: mx * scale, z: mz * scale };
}

/**
 * Clamps a point to lie within (or on) a circle of the given radius centred
 * on the origin — used to keep the player inside the arena wall.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius Must be >= 0.
 * @returns {{ x: number, z: number }}
 */
export function clampToArena(x, z, radius) {
  const dist = Math.hypot(x, z);
  if (dist <= radius || dist === 0) return { x, z };
  const scale = radius / dist;
  return { x: x * scale, z: z * scale };
}

/**
 * {@link slotPositions} with every position already converted to build-overlay
 * map units by {@link worldToMap} — the form `ui/BuildOverlay.js` needs, since
 * its `viewBox` is in map units (arena wall at 90), not world metres. Placing
 * raw world coordinates into that viewBox squeezes all 9 slots into the middle
 * ~16 units of the map, where the markers of the 3 slots sharing a gate
 * overlap each other completely.
 *
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{ id: number, gateId: number, angleDeg: number, x: number, z: number }[]}
 */
export function slotMapPositions(cfg) {
  return slotPositions(cfg).map((slot) => {
    const { x, z } = worldToMap(slot.x, slot.z, cfg);
    return { ...slot, x, z };
  });
}
