import * as THREE from 'three';
import { getMaterial, PALETTE } from '../../assets/ProceduralProps';
import { DECK_A_LENGTH, DECK_WIDTH, GAP_LENGTH } from './ChunkTypes';

/**
 * Six reusable, texture-based brick materials for the rooftop deck surface -
 * a stylized running-bond paver pattern with darker mortar lines, not
 * individual brick geometry (`unitBoxGeometry` stays the one shared deck
 * mesh; only its material changes).
 *
 * Every deck-piece *role* (A, B - always the same length as A; the
 * gap-filler C; the turn corner patch) has one fixed, unchanging real-world
 * size everywhere in this game (nothing ever varies a chunk's own length),
 * so the correct brick tiling is baked directly into each texture per role
 * rather than resized at runtime via `Texture.repeat` - 6 colours x 3
 * distinct sizes (A/B share one) = 18 small baked textures, built once here
 * and shared forever after. `A`/`B` intentionally reuse the same material
 * set (`roleFor('B')` maps to `'A'`'s), since their world size is identical.
 *
 * Colour is picked per "building" - a short, deterministic run of
 * consecutive chunk indices, not per chunk - so the roof, its side border
 * (`RoofBorders.ts`, which imports `brickColorIndexFor` to match) and the
 * facade below all read as one coordinated building, and so a building
 * occasionally spans several chunks rather than recolouring every one.
 *
 * Guarded for the plain-Node test environment exactly like
 * `BuildingWindows.ts`: `document` is checked before any canvas call, and a
 * failed/missing canvas falls back to a flat-coloured material rather than
 * throwing - the roof is still the right colour, just untextured.
 */

/** Real-world brick size, in world units - the same physical brick
 *  everywhere, which is what makes "consistent brick scale across LOW,
 *  MEDIUM and HIGH" true for free: tier only ever changes a deck's Y, never
 *  its footprint or this texture's own tiling. */
const BRICK_WIDTH = 1.2;
const BRICK_HEIGHT = 0.5;
/** Pixels per brick cell. 32x16 keeps every baked texture within (or very
 *  close to) the requested 256-512px range at this game's actual deck
 *  sizes, while staying a clean multiple of the brick's own 2.4:1 aspect. */
const CELL_PX_W = 32;
const CELL_PX_H = 16;
/** Mortar line thickness, in cell pixels. */
const MORTAR_PX = 2;

export type RoofSurfaceRole = 'A' | 'B' | 'C' | 'corner';

/** `B` always shares `A`'s material set - see the module doc comment. */
function canonicalRole(role: RoofSurfaceRole): 'A' | 'C' | 'corner' {
  return role === 'B' ? 'A' : role;
}

/** Real-world (width, depth) for one deck-piece role - the same figures
 *  `ChunkBuilder`/`ObstaclePool` place that role's geometry at. */
const ROLE_SIZE: Readonly<Record<'A' | 'C' | 'corner', { width: number; depth: number }>> = {
  A: { width: DECK_WIDTH, depth: DECK_A_LENGTH },
  C: { width: DECK_WIDTH, depth: GAP_LENGTH },
  corner: { width: DECK_WIDTH / 2, depth: DECK_WIDTH / 2 },
};

/** The six named brick colours, in a fixed order - this order is also the
 *  index space `brickColorIndexFor()` and `RoofBorders.ts` share. */
export const BRICK_COLORS: readonly number[] = [
  PALETTE.roofTerracotta,
  PALETTE.coastalPeach,
  PALETTE.roofSand,
  PALETTE.roofCream,
  PALETTE.roofCoral,
  PALETTE.roofWarmGray,
];

function hexToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Mortar reads as the base colour, darkened - not a fixed grey, so every
 *  brick colour keeps its own warm cast in the seams instead of all six
 *  sharing one neutral mortar tone. */
function mortarShade(color: number): string {
  const c = new THREE.Color(color);
  c.multiplyScalar(0.62);
  return `#${c.getHexString()}`;
}

/**
 * Bakes one running-bond brick texture: alternate rows offset by half a
 * brick, darker mortar lines both ways. Returns null outside a DOM - see
 * the module doc comment.
 */
function buildBrickTexture(color: number, cols: number, rows: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cols * CELL_PX_W));
  canvas.height = Math.max(1, Math.round(rows * CELL_PX_H));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const brickFill = hexToCss(color);
  const mortarFill = mortarShade(color);

  // Mortar base coat - the brick fills drawn on top leave exactly a
  // MORTAR_PX-wide seam showing through on every side.
  ctx.fillStyle = mortarFill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row * CELL_PX_H < canvas.height; row++) {
    const y = row * CELL_PX_H;
    const h = Math.min(CELL_PX_H, canvas.height - y) - MORTAR_PX;
    if (h <= 0) continue;
    // Running bond: odd rows start half a brick early (off-canvas), so the
    // seam between bricks alternates every other row instead of lining up
    // into a grid - the one detail that reads as "brick" rather than "tile".
    const offset = row % 2 === 0 ? 0 : -CELL_PX_W / 2;
    for (let x = offset; x < canvas.width; x += CELL_PX_W) {
      const left = Math.max(0, x);
      const right = Math.min(canvas.width, x + CELL_PX_W);
      const w = right - left - MORTAR_PX;
      if (w <= 0) continue;
      ctx.fillStyle = brickFill;
      ctx.fillRect(left, y + MORTAR_PX, w, h);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

const materialCache = new Map<string, THREE.MeshLambertMaterial>();
const ownedTextures: THREE.CanvasTexture[] = [];

/** Cached `(role, colourIndex)` -> material. Built lazily, once, the first
 *  time a given combination is actually needed. */
function brickMaterialFor(role: 'A' | 'C' | 'corner', colorIndex: number): THREE.MeshLambertMaterial {
  const key = `${role}|${colorIndex}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const color = BRICK_COLORS[colorIndex];
  const { width, depth } = ROLE_SIZE[role];
  const cols = Math.max(1, Math.round(width / BRICK_WIDTH));
  const rows = Math.max(1, Math.round(depth / BRICK_HEIGHT));

  const texture = buildBrickTexture(color, cols, rows);
  if (texture) ownedTextures.push(texture);

  const material = new THREE.MeshLambertMaterial({
    // Baked directly into the texture regardless, so the base colour here
    // only matters as the untextured (no-DOM) fallback - see
    // BuildingWindows.ts's own note on why colour is never left to
    // `material.color` tinting a transparent/absent map.
    color: texture ? 0xffffff : color,
    map: texture,
  });
  materialCache.set(key, material);
  return material;
}

/**
 * Deterministic "which building does this chunk belong to" - a short,
 * variable-length run of consecutive indices, found by scanning backward
 * from `chunkIndex` for the nearest run start. Bounded (`MAX_GROUP_SIZE`),
 * so this is a cheap, pure function of `chunkIndex` alone, not a running
 * scan from the start of the route.
 */
const MAX_GROUP_SIZE = 6;
/** ~1 in 3 chunks starts a new building, on average - short enough that a
 *  material change is common, long enough that "several chunks read as the
 *  same building" actually happens instead of being vanishingly rare. */
const NEW_BUILDING_CHANCE = 1 / 3;

function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 16;
  // `^` returns a *signed* int32 in JS regardless of its operands' sign, so
  // the result of that last XOR can read as negative even though every value
  // involved was conceptually unsigned - re-coerce once, at the very end,
  // exactly the way Buildings.ts's own `jitterRng` does (`state >>>= 0`
  // right before its division, not after every intermediate step). Without
  // this, `x / 0xffffffff` could come out negative and hand `brickColorIndexFor`
  // a negative array index.
  x >>>= 0;
  return x / 0xffffffff;
}

function isBuildingStart(chunkIndex: number): boolean {
  // Index 0 (and, via positive-mod-free clamping, anything before it) is
  // always a start - there is no earlier building for the very first chunk
  // to continue.
  if (chunkIndex <= 0) return true;
  return hash(chunkIndex) < NEW_BUILDING_CHANCE;
}

function buildingGroupStart(chunkIndex: number): number {
  let i = Math.max(0, chunkIndex);
  const floor = i - MAX_GROUP_SIZE;
  while (i > floor && !isBuildingStart(i)) i--;
  return i;
}

/** Which of `BRICK_COLORS` this chunk's building uses - exported so
 *  `RoofBorders.ts` can pick the exact same colour for that chunk's
 *  border. */
export function brickColorIndexFor(chunkIndex: number): number {
  const start = buildingGroupStart(chunkIndex);
  return Math.floor(hash(start * 97 + 13) * BRICK_COLORS.length) % BRICK_COLORS.length;
}

/** The brick material this chunk's deck piece (`role`) should use. */
export function brickMaterialForChunk(
  chunkIndex: number,
  role: RoofSurfaceRole,
): THREE.MeshLambertMaterial {
  return brickMaterialFor(canonicalRole(role), brickColorIndexFor(chunkIndex));
}

/** The flat, untextured border colour matching this chunk's brick choice -
 *  reuses `ProceduralProps.getMaterial`'s own cache, so this needs none of
 *  its own. */
export function brickBorderMaterialForChunk(chunkIndex: number): THREE.MeshLambertMaterial {
  return getMaterial(BRICK_COLORS[brickColorIndexFor(chunkIndex)]);
}

/** Frees every baked texture/material - one-time, whole-module teardown,
 *  paired with the other module-owned caches (`disposeClotheslineAssets()`
 *  and friends). */
export function disposeRoofBrickAssets(): void {
  for (const texture of ownedTextures) texture.dispose();
  ownedTextures.length = 0;
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
}
