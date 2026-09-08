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
 * Nearest hit of a ray against the arena's two solid surfaces: the floor
 * (the plane `y = 0`, only where it lies inside the wall) and the wall (a
 * vertical cylinder of `arena.radius`, capped at `arena.wallHeight`).
 *
 * This is what gives a shot that misses every enemy somewhere to land — the
 * player is always inside the cylinder, so a level or downward shot always
 * hits one of the two. A shot angled over the wall top hits neither and
 * returns `null`.
 *
 * @param {{x:number, y:number, z:number}} origin
 * @param {{x:number, y:number, z:number}} dir Need not be normalised; `dist` is in units of `dir`'s length.
 * @param {number} maxDist Hits beyond this are discarded (the weapon's range).
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{x:number, y:number, z:number, dist:number, surface:'ground'|'wall'} | null}
 */
export function rayArenaHit(origin, dir, maxDist, cfg) {
  const { radius, wallHeight } = cfg.arena;
  let best = null;

  // Floor: y = 0. Only counts inside the wall — outside it the ray has
  // already left the arena over the top, and there is no floor to hit.
  if (dir.y < 0) {
    const t = -origin.y / dir.y;
    if (t > 0 && t <= maxDist) {
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      if (Math.hypot(x, z) <= radius) best = { x, y: 0, z, dist: t, surface: 'ground' };
    }
  }

  // Wall: the outward intersection with the cylinder, if it is below the top.
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 0) {
    const b = 2 * (origin.x * dir.x + origin.z * dir.z);
    const c = origin.x * origin.x + origin.z * origin.z - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b + Math.sqrt(disc)) / (2 * a);
      const y = origin.y + dir.y * t;
      if (t > 0 && t <= maxDist && y >= 0 && y <= wallHeight && (!best || t < best.dist)) {
        best = { x: origin.x + dir.x * t, y, z: origin.z + dir.z * t, dist: t, surface: 'wall' };
      }
    }
  }

  return best;
}
