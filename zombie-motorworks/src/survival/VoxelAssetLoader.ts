import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assetUrl } from '../core/assetVersion.ts';

const templates = new Map<string, Promise<THREE.Group>>();

/**
 * Above this width or height a texture is an atlas rather than a voxel palette,
 * and wants mipmaps.
 *
 * MagicaVoxel bakes its colours into a palette strip a few hundred pixels wide;
 * every texel on one of those is a flat colour block, so mipmapping it costs
 * memory and buys nothing. The prop atlases are a megapixel of real detail, and
 * sampling those at full resolution from across the arena is both the slowest
 * and the ugliest option — the shimmer on a distant fence line came from here.
 */
const MIPMAP_MIN_DIMENSION = 256;

function configureTexture(texture: THREE.Texture | null): void {
  if (!texture) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  const image = texture.image as { width?: number; height?: number } | null;
  const mipmapped =
    Math.max(image?.width ?? 0, image?.height ?? 0) > MIPMAP_MIN_DIMENSION;
  // Magnification stays nearest either way: up close this is pixel art, and
  // smoothing it is exactly the mush the pixel-ratio cap exists to avoid.
  texture.magFilter = THREE.NearestFilter;
  // Minification is where the two cases part. Nearest between mip levels keeps
  // each level crisp while still stepping down with distance.
  texture.minFilter = mipmapped
    ? THREE.NearestMipmapLinearFilter
    : THREE.NearestFilter;
  texture.generateMipmaps = mipmapped;
  texture.anisotropy = mipmapped ? 4 : 1;
  texture.needsUpdate = true;
}

/**
 * Geometry, materials and textures owned by a cached template.
 *
 * Instances are `clone(true)`, which shares all three, so an arena tearing
 * itself down must leave these alone — freeing them would hand the next arena a
 * template whose GPU buffers are already gone. `isTemplateOwned` is how
 * `ArenaBuilder.dispose` tells its own scratch resources from these.
 */
const ownedGeometries = new WeakSet<THREE.BufferGeometry>();
const ownedMaterials = new WeakSet<THREE.Material>();
const ownedTextures = new WeakSet<THREE.Texture>();

function claimTemplateResources(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    ownedGeometries.add(child.geometry);
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      ownedMaterials.add(material);
      const mapped = material as THREE.Material & { map?: THREE.Texture | null };
      if (mapped.map) ownedTextures.add(mapped.map);
    }
  });
}

/** True when a cached template still needs this resource alive. */
export function isTemplateOwned(resource: object): boolean {
  return (
    ownedGeometries.has(resource as THREE.BufferGeometry) ||
    ownedMaterials.has(resource as THREE.Material) ||
    ownedTextures.has(resource as THREE.Texture)
  );
}

function voxelMaterial(source: THREE.Material): THREE.MeshLambertMaterial {
  const original = source as THREE.MeshPhongMaterial;
  configureTexture(original.map);
  return new THREE.MeshLambertMaterial({
    color: original.color?.clone() ?? new THREE.Color(0xffffff),
    map: original.map ?? null,
    // Pipeline GLBs carry their paint in COLOR_0 rather than a texture, so the
    // flag has to survive the swap or the model comes through plain white.
    vertexColors: original.vertexColors,
    emissive: 0x000000,
    flatShading: true,
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
  });
}

function replaceMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map(voxelMaterial)
      : voxelMaterial(child.material);
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

/**
 * Load one of the few remaining OBJ props.
 *
 * The arena's props are compressed GLB, built by
 * `scripts/convert-voxel-assets.mjs`. Five scatter props — the palms and the
 * pines — stay OBJ because each carries two materials on one mesh, and
 * `loadVoxelInstanceSource` (which is how scattered props get instanced) needs
 * exactly one mesh per asset; a two-primitive glTF loads as two. Those five are
 * the only reason this loader is still here, and they are named without an
 * extension, which is what routes them to it.
 */
async function loadObjObject(baseUrl: string): Promise<THREE.Object3D> {
  const materials = await new MTLLoader().loadAsync(assetUrl(`${baseUrl}.mtl`));
  materials.preload();
  return new OBJLoader()
    .setMaterials(materials)
    .loadAsync(assetUrl(`${baseUrl}.obj`));
}

/**
 * glTF declares COLOR_0 to be linear, but the voxel pipeline bakes the source
 * texture's sRGB texels straight into it. Three.js takes the spec at its word,
 * so every value is re-encoded on the way to the screen and the whole model
 * comes out pale and chalky — a 0.45 mid-tone displays as 0.70. Undoing that
 * encode is what puts the paint back.
 */
function srgbToLinear(channel: number): number {
  return channel < 0.04045
    ? channel * 0.0773993808
    : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * Voxel bakes come back flatter than the art they were sampled from, so the
 * corrected colours get a deliberate push: saturation away from grey, and
 * contrast around a dark pivot, since these models are lit by a night
 * graveyard rather than a studio.
 */
const VERTEX_COLOR_SATURATION = 1.3;
const VERTEX_COLOR_CONTRAST = 1.2;
/** Linear-space mid-point the contrast stretch pivots around. */
const VERTEX_COLOR_PIVOT = 0.16;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Rewrite one mesh's baked colours in place; the template is loaded once. */
function correctVertexColors(object: THREE.Object3D): void {
  const corrected = new Set<
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  >();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const colors = child.geometry.getAttribute('color');
    if (!colors || corrected.has(colors)) return;
    corrected.add(colors);
    for (let i = 0; i < colors.count; i++) {
      const r = srgbToLinear(colors.getX(i));
      const g = srgbToLinear(colors.getY(i));
      const b = srgbToLinear(colors.getZ(i));
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colors.setXYZ(
        i,
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (r - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (g - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
        clamp01(
          VERTEX_COLOR_PIVOT +
            (luma + (b - luma) * VERTEX_COLOR_SATURATION - VERTEX_COLOR_PIVOT) *
              VERTEX_COLOR_CONTRAST,
        ),
      );
    }
    colors.needsUpdate = true;
  });
}

/**
 * Rigged characters out of `glb-rigger` arrive as a named node hierarchy — the
 * bones are plain Object3Ds, so a clone keeps the names and pose code can find
 * them with `getObjectByName`.
 */
/**
 * Only the glb-pipeline's plain (unrigged) output is meshopt-compressed —
 * the rigger writes its rigged exports uncompressed by design — but the
 * decoder is harmless to register unconditionally, so every `.glb` here
 * shares one loader instead of branching on which asset needs it.
 */
const glbLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function loadGlbObject(url: string): Promise<THREE.Object3D> {
  const scene = (await glbLoader.loadAsync(assetUrl(url))).scene;
  correctVertexColors(scene);
  return scene;
}

async function loadTemplate(baseUrl: string): Promise<THREE.Group> {
  const object = baseUrl.endsWith('.glb')
    ? await loadGlbObject(baseUrl)
    : await loadObjObject(baseUrl);
  replaceMaterials(object);

  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -bounds.min.y, -center.z);

  const root = new THREE.Group();
  root.add(object);
  claimTemplateResources(root);
  return root;
}

/** Attempts a template gets before its placements fall back to placeholders. */
const TEMPLATE_LOAD_ATTEMPTS = 3;
const TEMPLATE_RETRY_DELAY_MS = 160;

function afterDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * An arena asks for a hundred-odd assets at once, so a single dropped fetch is
 * the ordinary case rather than the exceptional one, and the cost of treating
 * it as fatal is a placeholder box standing where a prop should be for the
 * rest of the run. Retry before giving up.
 */
async function loadTemplateWithRetries(baseUrl: string): Promise<THREE.Group> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TEMPLATE_LOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) await afterDelay(TEMPLATE_RETRY_DELAY_MS * attempt);
    try {
      return await loadTemplate(baseUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function templateFor(baseUrl: string): Promise<THREE.Group> {
  let pending = templates.get(baseUrl);
  if (!pending) {
    // A rejection must never stay in the cache. Props are placed across many
    // async callbacks, so one transient failure used to be inherited by every
    // later placement of that asset — one dropped fetch turned every crate,
    // tomb or fence of that kind into a grey placeholder box, scattered around
    // wherever that prop happens to be authored.
    const load: Promise<THREE.Group> = loadTemplateWithRetries(baseUrl).catch(
      (error: unknown) => {
        // Only evict our own entry: a cache clear may already have replaced it
        // with a fresh load for the next arena.
        if (templates.get(baseUrl) === load) templates.delete(baseUrl);
        throw error;
      },
    );
    pending = load;
    templates.set(baseUrl, pending);
  }
  return pending;
}

function cloneMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

/**
 * Warm a model's template so a later `instantiateVoxelAsset` resolves from
 * cache instead of a fetch. Fire-and-forget: a failure here is not worth
 * surfacing, because the real load will report it.
 *
 * Worth doing for anything big that appears on a deadline. A boss's model is
 * several megabytes and is only requested at the instant it spawns, so without
 * this the boss stands there as the placeholder walker — fitted to its full
 * boss height, so unmistakably wrong — for as long as the download takes.
 */
export function preloadVoxelAsset(baseUrl: string): void {
  void templateFor(baseUrl).catch(() => undefined);
}

/** Loads each OBJ/MTL pair, FBX, or GLB once, then returns geometry-sharing clones. */
export async function instantiateVoxelAsset(
  baseUrl: string,
  uniqueMaterials = false,
): Promise<THREE.Group> {
  const instance = (await templateFor(baseUrl)).clone(true);
  if (uniqueMaterials) cloneMaterials(instance);
  return instance;
}

/**
 * Geometry, material and placement matrix for batching a single-mesh asset.
 *
 * `localMatrix` is the mesh's full transform within its template, and an
 * `InstancedMesh` built from `geometry` must apply it — it is not merely the
 * recentring offset. A compressed GLB stores positions as normalized integers
 * and carries the scale that decodes them on its node, so dropping that matrix
 * draws the prop at raw quantization units instead of metres.
 */
export async function loadVoxelInstanceSource(baseUrl: string): Promise<{
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly localMatrix: THREE.Matrix4;
}> {
  const root = await templateFor(baseUrl);
  root.updateMatrixWorld(true);
  const object = root.children[0];
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  if (meshes.length !== 1) {
    throw new Error(
      `loadVoxelInstanceSource: expected exactly one mesh in "${baseUrl}", found ${meshes.length}`,
    );
  }
  return {
    geometry: meshes[0].geometry,
    material: meshes[0].material as THREE.Material,
    // Relative to the template root rather than the mesh's own world matrix,
    // so this stays correct even if the root is ever given a transform.
    localMatrix: root.matrixWorld
      .clone()
      .invert()
      .multiply(meshes[0].matrixWorld),
  };
}

/**
 * The asset set currently worth keeping resident — in practice a biome id.
 * `null` means nothing is cached.
 */
let currentScope: string | null = null;

/**
 * Keep `scope`'s templates loaded, dropping whatever the previous scope left.
 *
 * The cache used to be wiped on every `ArenaBuilder.dispose`, which meant a
 * player bouncing between the Garage and the arena re-fetched and — far worse —
 * re-parsed the entire arena on every single wave. Templates now outlive one
 * arena and are only thrown away when the player actually changes biome, which
 * is the only time they stop being the right ones to hold.
 */
export function retainVoxelAssetScope(scope: string): void {
  if (currentScope === scope) return;
  clearVoxelAssetCache();
  currentScope = scope;
}

/**
 * Dispose and forget every cached template.
 *
 * Callers must be certain nothing on screen still points at these — instances
 * share the template's geometry, materials and textures. In practice that means
 * a biome change, where the whole arena is being replaced anyway.
 */
export function clearVoxelAssetCache(): void {
  currentScope = null;
  const pendingTemplates = [...templates.values()];
  templates.clear();
  for (const pending of pendingTemplates) {
    void pending.then(disposeTemplate).catch(() => undefined);
  }
}

function disposeTemplate(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    if (Array.isArray(child.material)) {
      for (const material of child.material) materials.add(material);
    } else {
      materials.add(child.material);
    }
  });
  for (const material of materials) {
    const mapped = material as THREE.Material & { map?: THREE.Texture | null };
    if (mapped.map) textures.add(mapped.map);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
}
