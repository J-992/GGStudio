import * as THREE from 'three';

/**
 * Texture-based windows for the procedural skyline (`Buildings.ts`) and the
 * facade underneath a rooftop/gap (`ChunkBuilder.placeChunk`'s facade
 * placement).
 *
 * Explicitly texture, not geometry: a handful of small canvas textures
 * (`WINDOW_PATTERN_COUNT` of them per building colour, generated once and
 * cached) baked with a grid of window cells, tiled across a building's side
 * faces via `Texture.repeat`. No window mesh, no extra vertices, no extra
 * draw call per window - a building is still exactly the one box it always
 * was (`PlaceholderAssets.unitBoxGeometry`), just wearing a different
 * material on its side faces. Materials are cached by `(color, pattern)` the
 * same way `ProceduralProps.getMaterial` caches by color alone, so the whole
 * skyline shares a bounded, small set of (texture, material) pairs
 * regardless of how many buildings are on screen.
 *
 * The wall colour is baked directly into the texture (the whole canvas is
 * filled with it before any window is drawn), rather than left transparent
 * and tinted via `material.color` - that was the earlier design here, and
 * the actual root cause of "building facades render black": a canvas
 * cleared to transparent has RGB (0,0,0) with alpha 0 in the empty area,
 * and an opaque `MeshLambertMaterial` (no `transparent`/`alphaTest`) always
 * multiplies `diffuse` by the *sampled RGB*, alpha or not - so every wall
 * pixel between windows rendered as `color * (0,0,0)` = black, regardless of
 * what `color` actually was. Baking the real colour into the canvas removes
 * the multiply-by-black entirely: there is no transparent region left for
 * lighting/shading to expose.
 *
 * Each pattern's tile is a 2x2 grid of window cells, independently rolled
 * dark-glass / softly-lit / blank-wall per cell from a seed unique to that
 * pattern index - "a small set of reusable patterns" that each already reads
 * as a believable mixed facade, rather than a uniform grid of identical
 * windows.
 *
 * Guarded for the plain-Node test environment (`vitest.config.ts` runs with
 * no DOM): `document` is checked before any canvas call, and every consumer
 * treats a `null` material the same as a missing/failed asset elsewhere in
 * this codebase - fall back to the plain, windowless coloured box
 * (`ProceduralProps.getMaterial`) rather than throw.
 */

/** Each tile is a 2x2 grid of window cells, this many pixels per cell. */
const CELL_SIZE = 32;
const PATTERN_SIZE = CELL_SIZE * 2;

/** How many times a tile repeats across a building's side faces. Fixed
 *  rather than derived per-instance size (the geometry is one shared unit
 *  box scaled per building - see `Buildings.ts`) - windows read slightly
 *  denser on a narrower building and sparser on a wider one, an acceptable
 *  trade for a low-poly decorative skyline that never rebuilds geometry per
 *  instance. Tuned against a "typical" building (~10 wide, ~50 tall). */
const REPEAT_X = 3;
const REPEAT_Y = 10;

export const WINDOW_PATTERN_COUNT = 4;

/**
 * Unlit glass - glass with nobody home behind it.
 *
 * Was `['#1a2438', '#222f4a']`, and those two values are the whole of the
 * "the windows render black" report. They are near-black navies to begin
 * with (luma ~0.14), they are baked into a `map` that a `MeshLambertMaterial`
 * multiplies by incident light, and a building box has four side faces of
 * which at most two ever face the single directional sun. On the other two,
 * a colour that dark multiplied by ambient fill alone lands close enough to
 * #000 that the facade reads as a grid of holes punched in the wall.
 *
 * Physically, an unlit window in daylight is not dark - it is a mirror
 * showing the sky. These are that: mid-tone blues matching the endless
 * track's original flat sky colour (a fixed palette, not read live from
 * `ENDLESS_LIGHTING` - now that the sky itself is a sunset gradient, this is
 * a deliberately kept, separate design choice rather than an oversight),
 * light enough to survive being multiplied by an unlit face's ambient term
 * and still read as glass. Between this and the emissive mask below (which
 * is the belt to this braces - see `buildEmissiveTexture`), no window cell
 * can go black on any face, at any sun angle.
 */
const DARK_GLASS = ['#6d9dc4', '#8bb6d6'] as const;
const LIT_GLASS = ['#ffe6a1', '#ffd27a'] as const;
const FRAME = 'rgba(20, 22, 28, 0.55)';
/** Chance a given cell is left as blank wall rather than a window - a solid
 *  grid of windows on every single cell reads as a glass tower, not a mixed
 *  facade. */
const BLANK_CHANCE = 0.18;

/** How much of its own colour an *unlit* window contributes to the emissive
 *  mask. Enough to hold the pane off black on a face the sun never reaches,
 *  low enough that it still reads as a reflection rather than a light on. */
const UNLIT_EMISSIVE_ALPHA = 0.55;
/** Global scale on the emissive pass. The map already encodes per-window
 *  intensity, so this is just the master level; kept well under 1 so lit
 *  windows glow rather than blowing out to flat white. */
const EMISSIVE_INTENSITY = 0.6;

/** Tiny deterministic PRNG so a given (colour, pattern) pair always bakes
 *  the same texture - matches every other seeded-per-index generator in
 *  this system (`Buildings.ts`'s own `jitterRng`). */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761 + 1) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/**
 * Draws one window cell into the colour map and, in lockstep, into the
 * emissive mask.
 *
 * Both canvases are painted from the *same* `rng` draw sequence in one pass,
 * which is the only reason the two textures stay registered with each other.
 * Generating them in two separate passes would mean two independent walks of
 * the PRNG, and any future edit that changed how many numbers a cell consumes
 * would silently desynchronise the mask from the windows it is supposed to
 * mask - lighting up blank wall and leaving real windows dark.
 *
 * `emissiveCtx` is null when only the colour map is wanted.
 */
function drawWindowCell(
  ctx: CanvasRenderingContext2D,
  emissiveCtx: CanvasRenderingContext2D | null,
  cx: number,
  cy: number,
  rng: () => number,
): void {
  if (rng() < BLANK_CHANCE) return;

  const lit = rng() < 0.5;
  const palette = lit ? LIT_GLASS : DARK_GLASS;
  const color = palette[Math.floor(rng() * palette.length)];

  const margin = CELL_SIZE * 0.18;
  const size = CELL_SIZE - margin * 2;

  ctx.fillStyle = FRAME;
  ctx.fillRect(cx + margin - 1.5, cy + margin - 1.5, size + 3, size + 3);
  ctx.fillStyle = color;
  ctx.fillRect(cx + margin, cy + margin, size, size);

  // A single mullion bar - cheap "multi-pane" read at almost no extra cost.
  ctx.fillStyle = FRAME;
  ctx.fillRect(cx + CELL_SIZE / 2 - 1, cy + margin, 2, size);

  // The emissive mask: this cell's glass, and nothing else. The wall around it
  // stays pure black, and black in an emissiveMap emits nothing - so the glow
  // lands on windows only and the wall keeps shading normally. A lit window
  // carries its full colour; an unlit one is damped to a fraction of its own
  // sky-reflection tone, which is enough to keep it off black on an unlit face
  // without making an empty office look like it's glowing.
  if (!emissiveCtx) return;
  emissiveCtx.globalAlpha = lit ? 1 : UNLIT_EMISSIVE_ALPHA;
  emissiveCtx.fillStyle = color;
  emissiveCtx.fillRect(cx + margin, cy + margin, size, size);
  emissiveCtx.globalAlpha = 1;
}

function hexToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A tiled canvas texture set up the way every texture in this module is. */
function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(REPEAT_X, REPEAT_Y);
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

interface WindowTextures {
  readonly map: THREE.CanvasTexture;
  /** Window cells only; pure black everywhere else. */
  readonly emissive: THREE.CanvasTexture;
}

function buildWindowTextures(color: number, pattern: number): WindowTextures | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = PATTERN_SIZE;
  canvas.height = PATTERN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = PATTERN_SIZE;
  emissiveCanvas.height = PATTERN_SIZE;
  const emissiveCtx = emissiveCanvas.getContext('2d');
  if (!emissiveCtx) return null;

  // The wall colour, opaque, everywhere - see this module's own doc comment
  // for why this replaced a transparent background.
  ctx.fillStyle = hexToCss(color);
  ctx.fillRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);

  // The emissive mask starts fully black: wall emits nothing, and only the
  // cells `drawWindowCell` paints will light up.
  emissiveCtx.fillStyle = '#000000';
  emissiveCtx.fillRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);

  const rng = seeded(color * 97 + pattern + 1);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      drawWindowCell(ctx, emissiveCtx, col * CELL_SIZE, row * CELL_SIZE, rng);
    }
  }

  return { map: finishTexture(canvas), emissive: finishTexture(emissiveCanvas) };
}

const textureCache = new Map<string, WindowTextures | null>();

function getWindowTextures(color: number, pattern: number): WindowTextures | null {
  const index = ((pattern % WINDOW_PATTERN_COUNT) + WINDOW_PATTERN_COUNT) % WINDOW_PATTERN_COUNT;
  const key = `${color}|${index}`;
  if (!textureCache.has(key)) textureCache.set(key, buildWindowTextures(color, index));
  return textureCache.get(key) ?? null;
}

const windowMaterialCache = new Map<string, THREE.MeshLambertMaterial>();

/**
 * A window-textured material for wall colour `color`, pattern `pattern` -
 * the colour is baked into the texture itself (see the module doc comment),
 * so the material's own `color` stays the default white pass-through.
 * `null` if canvas textures aren't available in this environment (tests) -
 * callers fall back to `ProceduralProps.getMaterial(color)`, the same plain
 * box every building used before this module existed.
 */
export function getWindowMaterial(color: number, pattern: number): THREE.MeshLambertMaterial | null {
  const textures = getWindowTextures(color, pattern);
  if (!textures) return null;

  const key = `${color}|${pattern}`;
  let mat = windowMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      map: textures.map,
      flatShading: true,
      // Windows are the one part of a facade that should not go dark just
      // because its face is turned away from the sun. `emissive` white lets
      // the mask supply the colour per pane; the mask is black on wall, so
      // the wall itself is untouched and still shades normally.
      emissive: 0xffffff,
      emissiveMap: textures.emissive,
      emissiveIntensity: EMISSIVE_INTENSITY,
    });
    mat.userData.shared = true;
    windowMaterialCache.set(key, mat);
  }
  return mat;
}

/** Releases every cached window texture/material. Call once, on full teardown. */
export function disposeBuildingWindowCache(): void {
  for (const mat of windowMaterialCache.values()) mat.dispose();
  windowMaterialCache.clear();
  for (const textures of textureCache.values()) {
    textures?.map.dispose();
    textures?.emissive.dispose();
  }
  textureCache.clear();
}
