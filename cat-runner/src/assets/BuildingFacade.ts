import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRegistry } from './AssetRegistry';
import { getMaterial, PALETTE } from './ProceduralProps';
import { MEGAKIT_INTERIOR_MATERIAL } from './MegaKitPalette';

/**
 * Builds the building underneath a rooftop from the Downtown City MegaKit's
 * modular facade panels.
 *
 * This replaces a single cream box with two windows-per-floor stamped on it,
 * which was the same box under every rooftop in every level - the reason the
 * city read as one repeated asset.
 *
 * -------------------------------------------------------------------------
 * WHY THE KIT WORKS FOR THIS
 * -------------------------------------------------------------------------
 * Every panel is on a strict grid: 2 m wide, 3 m per floor, 0.2 m thick, origin
 * centred on X with its base at y=0 and its body extending -Z (so the panel's
 * *front* faces +Z). That regularity means a facade is just a nested loop, and
 * the same twenty meshes generate an unbounded number of distinct buildings.
 *
 * -------------------------------------------------------------------------
 * WHY IT MERGES INSTEAD OF INSTANCING
 * -------------------------------------------------------------------------
 * A tall building is a few hundred panels. Instancing would need one draw call
 * per (panel type x material), and these are static geometry that never moves,
 * so merging by colour is strictly better: a whole building collapses to one
 * draw call per palette colour it uses - typically three - and the merged
 * geometry is a few thousand triangles. The panels are 4-210 triangles each,
 * which is what makes that affordable.
 *
 * Everything here is visual only. The rooftop platform owns the collider; the
 * building below it is scenery, and the player never touches it.
 */

/** Panel footprint on the kit's grid. */
const PANEL_WIDTH = 2;
const PANEL_HEIGHT = 3;

/** Every panel this module may ask the registry for. */
export const MEGAKIT_PANELS = [
  'Brick_Plain_3',
  'Brick_Window_Square_Single',
  'Brick_Window_Trim',
  'Brick_TopTrim',
  'Metal_Plain_3',
  'Metal_FullWindow',
  'Metal_FirstFloor_Wall',
  'Trim_Plain_3',
  'Trim_Window',
  'Trim_FirstFloor_Wall',
  'Cornice_Brick_Center',
  'Cornice_Metal_Center',
  'Cornice_Trim_Center',
] as const;

/**
 * A coherent set of panels. Mixing brick walls with metal windows looks like a
 * mistake, so a building picks one family and stays in it.
 */
interface PanelFamily {
  wall: string;
  window: string;
  /** Closes off the lowest detailed course. */
  ground: string;
  cornice: string;
  /** Colour of the plain shaft below the detailed floors. */
  base: number;
}

const FAMILIES: readonly PanelFamily[] = [
  {
    wall: 'Brick_Plain_3',
    window: 'Brick_Window_Square_Single',
    ground: 'Brick_TopTrim',
    cornice: 'Cornice_Brick_Center',
    base: PALETTE.coastalPeach,
  },
  {
    wall: 'Trim_Plain_3',
    window: 'Trim_Window',
    ground: 'Trim_FirstFloor_Wall',
    cornice: 'Cornice_Trim_Center',
    base: PALETTE.coastalCream,
  },
  {
    wall: 'Metal_Plain_3',
    window: 'Metal_FullWindow',
    ground: 'Metal_FirstFloor_Wall',
    cornice: 'Cornice_Metal_Center',
    base: PALETTE.coastalBlue,
  },
  {
    wall: 'Brick_Plain_3',
    window: 'Brick_Window_Trim',
    ground: 'Brick_TopTrim',
    cornice: 'Cornice_Brick_Center',
    base: PALETTE.coastalYellow,
  },
];

/**
 * Budget. A 30x80 rooftop is 55 panels around its perimeter and seven floors
 * tall, and the window panels run 174-636 triangles each - laid out literally
 * that is 150k triangles for one building, and level 1 has six.
 *
 * Two caps bring it back to something sane, and neither is visible in play:
 *
 *  - Panels may stretch up to `MAX_PANEL_WIDTH`, roughly halving the count on a
 *    long face. This is a cap on panel *width*, not on the number of columns: a
 *    flat column cap makes windows on a 68 m face twice the size of windows on a
 *    26 m one, and mismatched window sizes are obvious in a way that a panel
 *    being three metres wide instead of two is not.
 *  - Only the top `DETAIL_FLOORS` are built from panels. The player is on the
 *    roofs; everything below the roofline is either occluded by the next
 *    building or rushing past during a fall, so the shaft underneath is one box.
 *
 * Both were loosened once the numbers were actually measured: at a 4 m cap and
 * three detailed floors, level 1's five facades came to 72k triangles, which
 * after the background skyline was removed was 58% of everything the frame
 * drew - spent almost entirely on courses below the roofline that the camera
 * only ever sees edge-on across a gap. The values below cost roughly half that
 * for a facade that still reads as the same building from the only vantage the
 * player has.
 */
const MAX_PANEL_WIDTH = 6;
const DETAIL_FLOORS = 2;

/** The four faces of the box, as the yaw that turns a panel's +Z front outward. */
const FACES: readonly { yaw: number; alongX: boolean; sign: number }[] = [
  { yaw: 0, alongX: true, sign: 1 }, // +Z
  { yaw: Math.PI, alongX: true, sign: -1 }, // -Z
  { yaw: Math.PI / 2, alongX: false, sign: 1 }, // +X
  { yaw: -Math.PI / 2, alongX: false, sign: -1 }, // -X
];

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * @param width  rooftop footprint on X
 * @param depth  rooftop footprint on Z
 * @param height how far the building extends *below* the group origin
 * @param seed   any integer; the same seed always produces the same building
 * @returns the assembled facade, or null if the kit isn't loaded
 */
export function buildMegaKitFacade(
  registry: AssetRegistry,
  width: number,
  depth: number,
  height: number,
  seed: number,
): THREE.Object3D | null {
  const rand = seededRandom(seed);
  const family = FAMILIES[Math.floor(rand() * FAMILIES.length) % FAMILIES.length];

  // Panels are stretched slightly rather than left with gaps, so the grid always
  // divides the footprint exactly and the building stays a closed box.
  const floors = Math.max(1, Math.round(height / PANEL_HEIGHT));
  const floorHeight = height / floors;
  const detailFloors = Math.min(floors, DETAIL_FLOORS);
  /** Y of the lowest panel course. Everything below this is the plain shaft. */
  const detailBase = -detailFloors * floorHeight;

  // How much of each floor is glazed. Varying this per building is most of what
  // makes two buildings of the same family read as different.
  const windowChance = 0.3 + rand() * 0.45;
  const hasCornice = rand() > 0.35;

  const buckets = new Map<number, THREE.BufferGeometry[]>();

  for (const face of FACES) {
    const span = face.alongX ? width : depth;
    const columns = Math.max(1, Math.ceil(span / MAX_PANEL_WIDTH));
    const columnWidth = span / columns;

    for (let c = 0; c < columns; c++) {
      const along = -span / 2 + columnWidth * (c + 0.5);
      const offset = (face.alongX ? depth : width) / 2;

      for (let f = 0; f < detailFloors; f++) {
        // The lowest detailed course closes onto the shaft below, and the
        // topmost carries the cornice.
        const isBottom = f === 0;
        const name = isBottom
          ? family.ground
          : rand() < windowChance
            ? family.window
            : family.wall;

        _position.set(
          face.alongX ? along : face.sign * offset,
          detailBase + floorHeight * f,
          face.alongX ? face.sign * offset : along,
        );
        _quaternion.setFromAxisAngle(_up, face.yaw);
        _scale.set(columnWidth / PANEL_WIDTH, floorHeight / PANEL_HEIGHT, 1);
        _matrix.compose(_position, _quaternion, _scale);

        collectPanel(registry, name, _matrix, buckets);
      }

      if (!hasCornice) continue;

      // Cornice sits on top of the last floor, capping the facade where it meets
      // the rooftop the player actually runs on.
      _position.set(
        face.alongX ? along : face.sign * offset,
        -floorHeight * 0.15,
        face.alongX ? face.sign * offset : along,
      );
      _quaternion.setFromAxisAngle(_up, face.yaw);
      _scale.set(columnWidth / PANEL_WIDTH, 1, 1);
      _matrix.compose(_position, _quaternion, _scale);

      collectPanel(registry, family.cornice, _matrix, buckets);
    }
  }

  if (buckets.size === 0) return null;

  const group = new THREE.Group();
  for (const [color, parts] of buckets) {
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, getMaterial(color));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // A flat cap so the building is not hollow when seen from an adjacent roof
  // - a rooftop colour, not a building-wall one, since that's what it is.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.96, 0.4, depth * 0.96),
    getMaterial(PALETTE.roofSand),
  );
  cap.position.y = -0.2;
  group.add(cap);

  // The undetailed shaft, running from the lowest panel course down to street
  // level. Inset very slightly so it never z-fights the 0.2 m thick panels
  // sitting on top of it.
  const shaftHeight = height + detailBase;
  if (shaftHeight > 0.1) {
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.02, shaftHeight, depth - 0.02),
      getMaterial(family.base),
    );
    shaft.position.y = detailBase - shaftHeight / 2;
    shaft.receiveShadow = true;
    group.add(shaft);
  }

  return group;
}

/**
 * Adds one placed panel's geometry to the per-colour buckets.
 *
 * Geometry is baked into world space here rather than kept as a transform,
 * because the whole point is to end up with a handful of merged meshes.
 */
function collectPanel(
  registry: AssetRegistry,
  name: string,
  placement: THREE.Matrix4,
  buckets: Map<number, THREE.BufferGeometry[]>,
): void {
  const prototype = registry.getRawModel('megakit', name);
  if (!prototype) return;

  prototype.updateMatrixWorld(true);
  prototype.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const material = mesh.material as THREE.MeshLambertMaterial | undefined;
    // The inner face of every panel. Facades are closed boxes, so it is never
    // visible - and at four faces per building it is a third of the triangles.
    if (material?.userData?.megakitSource === MEGAKIT_INTERIOR_MATERIAL) return;

    const geometry = normaliseForMerge(mesh.geometry);
    if (!geometry) return;
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.applyMatrix4(placement);

    const color = material?.color?.getHex() ?? PALETTE.coastalCream;
    const bucket = buckets.get(color);
    if (bucket) bucket.push(geometry);
    else buckets.set(color, [geometry]);
  });
}

/**
 * Reduces a panel's geometry to just what merging needs: position, normal, and
 * an index.
 *
 * `mergeGeometries` refuses any batch whose members don't agree on their exact
 * attribute set, and the MegaKit does not agree with itself - some panels carry
 * `uv2`, some carry `color_1`, some carry neither. Left alone it fails per batch
 * and returns null, which silently drops whole colours out of the facade.
 *
 * Discarding UVs and vertex colours costs nothing here: the kit ships without
 * textures, and colour comes from the palette material the merged mesh is given.
 */
function normaliseForMerge(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const position = source.getAttribute('position');
  if (!position) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position.clone());

  const normal = source.getAttribute('normal');
  if (normal) geometry.setAttribute('normal', normal.clone());

  // All-indexed or all-not is the other thing merging insists on, so anything
  // arriving unindexed gets a trivial one rather than forcing the whole batch
  // to expand to non-indexed.
  if (source.index) {
    geometry.setIndex(source.index.clone());
  } else {
    const count = position.count;
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  if (!normal) geometry.computeVertexNormals();
  return geometry;
}

/** Deterministic LCG, so a building looks identical on every retry. */
function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) * 1103515245 + 12345) & 0x7fffffff;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
