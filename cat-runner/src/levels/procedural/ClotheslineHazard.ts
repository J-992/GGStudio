import * as THREE from 'three';
import { PALETTE } from '../../assets/ProceduralProps';
import { BEAM_LENGTH, BEAM_RADIUS, BEAM_HEIGHT } from './ChunkTypes';

/**
 * The duck-under hazard, built as a strung clothesline instead of a slab.
 *
 * `buildClotheslineHazard()` now prefers a real authored model
 * (`public/assets/obstacles/clothesline1.glb`, wired in via
 * `setClotheslineModel()` once `Game.loadAssets()` resolves it - see that
 * function's own doc comment for how its placement is derived) and falls back
 * to the hand-strung prop described below whenever it isn't loaded, the same
 * non-fatal-load contract every other provided model in this game has.
 *
 * What the fallback replaces and why
 * -----------------------------------
 * The hazard used to be one flat `unitBoxGeometry` panel in a solid orange
 * (`PlaceholderAssets.beamMaterial`) - a stand-in from when nothing on the
 * procedural track had art. It read as a wall, which is the correct *gameplay*
 * signal (see `ChunkTypes.BEAM_TOP`: the band is deliberately three times the
 * cat's height so it cannot be mistaken for something to hurdle), but it read
 * as a wall made of nothing in particular. The campaign already had the right
 * object for this - `buildLaundryLine(..., { hazard: true })` in
 * `ProceduralProps.ts` - a rope on posts with sheets pegged shoulder to
 * shoulder across it.
 *
 * This is that prop, rebuilt against the endless track's own constraints:
 *
 *   - **Pooled, not per-instance.** `ObstaclePool` builds one of these per
 *     streamer slot and reuses it forever, so every texture, geometry and
 *     material here is module-level and shared. `buildLaundryLine` allocates
 *     a fresh `TubeGeometry` per call, which is fine for a level built once
 *     and wrong for something rebuilt as chunks stream.
 *   - **Band-locked.** The group's origin is the hazard band's *centre*
 *     ({@link BEAM_HEIGHT} above the deck), because that is the transform
 *     `ChunkBuilder.placeChunk()` already hands the pooled beam group. Every
 *     child is positioned relative to that, so the sheets fill exactly
 *     [`BEAM_BOTTOM`, `BEAM_TOP`] - what the player sees stays exactly what
 *     `overlapsBeam()` can hit, which was the whole point of the flat panel
 *     and is not something a prettier prop is allowed to break.
 *   - **Textured, not flat-shaded.** Each sheet gets a woven canvas texture
 *     (stripes, gingham, a plain sheet with a hem) rather than a single
 *     colour, so the barrier reads as cloth at a run's distance instead of as
 *     a coloured rectangle.
 *
 * Colours stay saturated and high-contrast for the same reason
 * `PlaceholderAssets.PLACEHOLDER_COLOR` says they do: a hazard that blends
 * into the pastel building behind it is a hazard the player finds out about
 * by hitting it. The fabric tones are the campaign palette's, lifted toward
 * their brighter end.
 */

/** Sheets pegged across the span. Six at this span gives ~1.6-unit sheets -
 *  wide enough to read as bedsheets rather than as ribbons. */
const SHEET_COUNT = 6;

/** Sheets are cut wider than their share of the span so neighbours overlap.
 *  Straight from `buildLaundryLine`'s own reasoning: daylight between the
 *  sheets reads as something to weave through, which is the wrong answer. */
const SHEET_OVERLAP = 1.15;

/** Radius of the line itself. Thicker than the campaign's scenery line
 *  (0.012) for the same reason that prop's hazard variant is (0.03): it has
 *  to be visible at running distance, not admired from underneath. */
const ROPE_RADIUS = 0.045;

/** How far outside the sheet span the end posts stand. */
const POST_INSET = 0.14;
const POST_THICKNESS = 0.13;

/** Fabric tones, brightened from `PALETTE`'s own fabric set. Navy is
 *  deliberately absent: at this size it reads as a hole in the barrier
 *  against a bright sky rather than as cloth. */
const FABRIC = [
  { base: 0xff6b35, accent: 0xf7e2c8, pattern: 'stripeH' },
  { base: 0xf2e6ce, accent: 0xd94f3a, pattern: 'gingham' },
  { base: 0x2e9d90, accent: 0xf2e6ce, pattern: 'stripeV' },
  { base: 0xf0b93f, accent: 0xb33a3a, pattern: 'stripeH' },
  { base: 0xd94f3a, accent: 0xf7e2c8, pattern: 'plain' },
  { base: 0x4fb3c4, accent: 0xfff6ea, pattern: 'gingham' },
] as const;

/** Canvas size per sheet texture. Tall, matching a hanging sheet's aspect, so
 *  a horizontal stripe stays a horizontal stripe once the plane is scaled. */
const TEXTURE_W = 96;
const TEXTURE_H = 192;

// ---------------------------------------------------------------------------
// Shared, module-owned resources
// ---------------------------------------------------------------------------

const sheetGeometry = new THREE.PlaneGeometry(1, 1);
const postGeometry = new THREE.BoxGeometry(1, 1, 1);
const pegGeometry = new THREE.BoxGeometry(1, 1, 1);
/** Unit cylinder laid along +X by the caller's rotation, so the one geometry
 *  serves the rope regardless of span. */
const ropeGeometry = new THREE.CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, 1, 6);

let sheetMaterials: THREE.MeshStandardMaterial[] | null = null;
let ropeMaterial: THREE.MeshStandardMaterial | null = null;
let postMaterial: THREE.MeshStandardMaterial | null = null;
let pegMaterial: THREE.MeshStandardMaterial | null = null;
const ownedTextures: THREE.CanvasTexture[] = [];

function hexToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The provided clothesline model, once `Game.loadAssets()` resolves it - see
 *  `setClotheslineModel()`. `buildClotheslineHazard()` prefers this, falling
 *  back to the hand-strung rope-and-sheets prop below whenever it's absent
 *  (load failure, or a checkout with no `clothesline1.glb`), the same
 *  non-fatal-load contract every other provided model in this game has. */
let clotheslinePrototype: THREE.Object3D | null = null;

/** Called once, after the obstacle model pack loads - see `Game.loadAssets()`. */
export function setClotheslineModel(model: THREE.Object3D): void {
  clotheslinePrototype = model;
}

const _clothesBox = new THREE.Box3();

/**
 * Clones the provided model and re-derives its placement from its own
 * measured proportions, rather than trusting authored numbers this file has
 * no control over.
 *
 * `AssetRegistry.loadObstacleModel('clothesline1', BEAM_TOP)` already scaled
 * the source uniformly so its full authored height (ground to rope) equals
 * `BEAM_TOP`, and sat it with its lowest point at y=0. Two things still need
 * fixing up here:
 *
 *   - **Origin.** Every other role in this group is placed relative to the
 *     hazard band's *centre* ({@link BEAM_HEIGHT} above the deck) - see this
 *     file's own header comment. The loaded model's "ground" is `BEAM_HEIGHT`
 *     below that, so it drops by exactly that much.
 *   - **Width.** A uniform height-only scale carries the source's own aspect
 *     ratio along for the ride, which measured out to about 9.4 units wide
 *     against this hazard's `BEAM_LENGTH` of 8.4 - close, but not the number
 *     that actually spans the lanes. Corrected with one more scale on X only,
 *     sized off the clone's own measured width rather than a hardcoded ratio,
 *     so this keeps working if the source file is ever re-exported at a
 *     different aspect ratio. The model is authored symmetric about its own
 *     local X origin (confirmed against the shipped file), so a pure X scale
 *     recentres nothing extra.
 */
function buildFromProvidedModel(): THREE.Group | null {
  if (!clotheslinePrototype) return null;

  const clone = clotheslinePrototype.clone(true) as THREE.Group;
  clone.updateMatrixWorld(true);
  _clothesBox.setFromObject(clone);
  const width = _clothesBox.max.x - _clothesBox.min.x;
  if (width > 1e-4) clone.scale.x *= BEAM_LENGTH / width;
  clone.position.y -= BEAM_HEIGHT;

  const group = new THREE.Group();
  group.visible = false;
  group.add(clone);
  return group;
}

/**
 * Draws one sheet's weave.
 *
 * Returns null in a non-DOM environment (the test suite runs in plain Node),
 * exactly the way `BuildingWindows.buildWindowTextures` does - the caller
 * falls back to a flat-coloured material, so the hazard is still built and
 * still the right size, just untextured.
 */
function buildFabricTexture(spec: (typeof FABRIC)[number]): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = hexToCss(spec.base);
  ctx.fillRect(0, 0, TEXTURE_W, TEXTURE_H);
  ctx.fillStyle = hexToCss(spec.accent);

  if (spec.pattern === 'stripeH') {
    for (let y = 18; y < TEXTURE_H; y += 34) ctx.fillRect(0, y, TEXTURE_W, 11);
  } else if (spec.pattern === 'stripeV') {
    for (let x = 10; x < TEXTURE_W; x += 26) ctx.fillRect(x, 0, 9, TEXTURE_H);
  } else if (spec.pattern === 'gingham') {
    // Half-opacity bands both ways: where they cross, the two passes stack to
    // full strength on their own, which is what makes a check read as a check
    // rather than as a grid drawn over a colour.
    ctx.globalAlpha = 0.5;
    for (let x = 0; x < TEXTURE_W; x += 32) ctx.fillRect(x, 0, 16, TEXTURE_H);
    for (let y = 0; y < TEXTURE_H; y += 32) ctx.fillRect(0, y, TEXTURE_W, 16);
    ctx.globalAlpha = 1;
  }

  // Hem top and bottom on every variant - the two edges the eye actually
  // lands on, and the cheapest thing that says "cut cloth" rather than
  // "rectangle".
  ctx.fillStyle = hexToCss(spec.accent);
  ctx.fillRect(0, 0, TEXTURE_W, 6);
  ctx.fillRect(0, TEXTURE_H - 8, TEXTURE_W, 8);

  // A soft vertical shade so a flat plane still has a fold's worth of depth
  // under the game's flat-ish daylight.
  const shade = ctx.createLinearGradient(0, 0, TEXTURE_W, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.22)');
  shade.addColorStop(0.35, 'rgba(0,0,0,0)');
  shade.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  shade.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, TEXTURE_W, TEXTURE_H);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function ensureMaterials(): void {
  if (sheetMaterials) return;

  sheetMaterials = FABRIC.map((spec) => {
    const texture = buildFabricTexture(spec);
    if (texture) ownedTextures.push(texture);
    return new THREE.MeshStandardMaterial({
      // The base colour stays on the material even when a map is present, so
      // the sheet keeps its identity if the texture ever fails to build.
      color: texture ? 0xffffff : spec.base,
      map: texture ?? null,
      roughness: 0.95,
      metalness: 0,
      // Ducking carries the camera straight through the curtain, so the back
      // faces are seen every single time the hazard is beaten.
      side: THREE.DoubleSide,
    });
  });

  ropeMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.rope,
    roughness: 0.9,
    metalness: 0,
  });
  postMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.metalDark,
    roughness: 0.7,
    metalness: 0.25,
  });
  pegMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.woodDark,
    roughness: 0.85,
    metalness: 0,
  });
}

/**
 * One pooled clothesline, origin at the hazard band's centre.
 *
 * Local axes match the chunk frame `ChunkBuilder.placeChunk()` rotates this
 * group by: +X runs across the lanes, +Z runs along the track (so the sheets,
 * built from an untransformed `PlaneGeometry`, already face the runner), and
 * +Y is up with the deck at `-BEAM_HEIGHT`.
 */
export function buildClotheslineHazard(): THREE.Group {
  const provided = buildFromProvidedModel();
  if (provided) return provided;

  ensureMaterials();
  const materials = sheetMaterials!;

  const group = new THREE.Group();
  group.visible = false;

  const sheetHeight = BEAM_RADIUS * 2;
  const slot = BEAM_LENGTH / SHEET_COUNT;
  const sheetWidth = slot * SHEET_OVERLAP;
  const ropeY = BEAM_RADIUS;

  for (let i = 0; i < SHEET_COUNT; i++) {
    const x = -BEAM_LENGTH / 2 + slot * (i + 0.5);

    const sheet = new THREE.Mesh(sheetGeometry, materials[i % materials.length]);
    sheet.scale.set(sheetWidth, sheetHeight, 1);
    // Centred on the band's centre by construction: the sheet is exactly as
    // tall as the band, so its own centre and the band's are the same point.
    sheet.position.set(x, 0, 0);
    // A hair of tilt each way, deterministic per index. Enough that the row
    // does not look stamped; small enough that no sheet turns edge-on, which
    // would be a sheet the player cannot see coming.
    sheet.rotation.z = (((i * 53) % 10) / 10 - 0.5) * 0.05;
    // Sheets are staggered a few centimetres apart along the track so the
    // overlapping edges never land on the same plane - coplanar quads
    // z-fight, and a flickering seam down a hazard is worse than no overlap.
    sheet.position.z = (i % 2 === 0 ? 1 : -1) * 0.02;
    group.add(sheet);

    const peg = new THREE.Mesh(pegGeometry, pegMaterial!);
    peg.scale.set(0.07, 0.13, 0.07);
    peg.position.set(x, ropeY + 0.02, 0);
    group.add(peg);
  }

  const rope = new THREE.Mesh(ropeGeometry, ropeMaterial!);
  // The unit cylinder stands along +Y; a quarter turn about Z lays it across
  // the lanes, and the scale then reads as length along that axis.
  rope.rotation.z = Math.PI / 2;
  rope.scale.set(1, BEAM_LENGTH + POST_INSET * 2, 1);
  rope.position.set(0, ropeY, 0);
  group.add(rope);

  // Posts run from the rope down to the deck, which sits at -BEAM_HEIGHT in
  // this group's own frame. Without them the curtain floats, and a floating
  // barrier reads as scenery rather than as something installed in the way.
  const postHeight = BEAM_HEIGHT + BEAM_RADIUS;
  for (const side of [-1, 1] as const) {
    const post = new THREE.Mesh(postGeometry, postMaterial!);
    post.scale.set(POST_THICKNESS, postHeight, POST_THICKNESS);
    post.position.set(side * (BEAM_LENGTH / 2 + POST_INSET), ropeY - postHeight / 2, 0);
    group.add(post);
  }

  return group;
}

/** Frees the shared geometry, materials and canvas textures. Paired with
 *  `disposePlaceholderAssets()` - both are one-time, whole-module teardown. */
export function disposeClotheslineAssets(): void {
  sheetGeometry.dispose();
  postGeometry.dispose();
  pegGeometry.dispose();
  ropeGeometry.dispose();

  for (const texture of ownedTextures) texture.dispose();
  ownedTextures.length = 0;

  for (const material of sheetMaterials ?? []) material.dispose();
  ropeMaterial?.dispose();
  postMaterial?.dispose();
  pegMaterial?.dispose();

  sheetMaterials = null;
  ropeMaterial = null;
  postMaterial = null;
  pegMaterial = null;
}
