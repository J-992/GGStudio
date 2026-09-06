// Loads every binary asset the game needs (models, the brainrot sprite atlas,
// and raw audio bytes) and exposes a small, frozen-shape API over them. This
// module touches three.js's loaders and, transitively, the DOM (Image/fetch),
// but never at import time — everything happens inside `loadAll()`, which is
// only ever called from `main.js` after the page has booted.
//
// Texture/UV convention (also documented in `docs/INTERFACES.md`): the
// brainrot atlas texture is loaded with `flipY = false`. `brainrot.json`'s
// rects are in top-left-origin, y-down pixel/UV space (row 0 of the source
// PNG is v=0). Three's default `flipY = true` re-flips the image on upload so
// that GL's bottom-left-origin v=0 lines up with a *bottom*-left-origin UV
// convention — exactly the opposite of what the JSON already assumes. Turning
// flipY off uploads the image byte-for-byte, so sampling with the JSON's
// `u0,v0,u1,v1` rects directly (no `1 - v` flip) lands on the right texels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MODEL_FILES = ['zed_1.glb', 'zed_3.glb', 'dressing.glb', 'rocks.glb', 'props.glb'];

const AUDIO_NAMES = [
  'ui-click', 'ui-place', 'ui-deny', 'wave-start', 'boss-alert', 'coin',
  'pistol-shot-1', 'turret-shot-1', 'impact-heavy', 'zombie-death-1',
  'zombie-attack-1', 'explosion-metal', 'mechanical-clunk', 'upgrade-confirm',
];

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

/**
 * @param {string} path Relative to the build directory, e.g. `assets/models/zed_1.glb`.
 * @returns {string}
 */
export function assetUrl(path) {
  return `${window.__ASSET_BASE__}${path}`;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withRetries(fn) {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * attempt);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status}): ${url}`);
  return res.arrayBuffer();
}

/**
 * Every model texture (the zed palettes, the dressing/rocks textures,
 * props.glb's shared 512px atlas) gets plain `NearestFilter` in both
 * directions and no mipmaps, per the brief — unlike the brainrot sprite
 * atlas (`loadAll`'s atlas step, below), which is large and distant enough
 * to want `NearestMipmapLinearFilter` minification.
 * @param {THREE.Texture|null|undefined} texture
 */
function configureModelTexture(texture) {
  if (!texture) return;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

/**
 * @param {THREE.Mesh} mesh
 */
function replaceMeshMaterial(mesh) {
  const src = /** @type {THREE.MeshStandardMaterial} */ (
    Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  );
  configureModelTexture(src.map);
  const hasVertexColors = !!mesh.geometry.getAttribute('color');
  mesh.material = new THREE.MeshLambertMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map ?? null,
    vertexColors: hasVertexColors,
    flatShading: true,
    transparent: !!src.transparent,
    opacity: src.opacity ?? 1,
    alphaTest: src.alphaTest ?? 0,
    side: src.side ?? THREE.FrontSide,
  });
}

/**
 * @param {THREE.Object3D} root
 */
function replaceMaterials(root) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) replaceMeshMaterial(child);
  });
}

/**
 * Geometry/material/placement for one named mesh inside a loaded GLB, keyed
 * by mesh name so a multi-mesh file (`dressing.glb`, `props.glb`, ...) yields
 * one entry per mesh. `localMatrix` is relative to the GLB's own scene root —
 * see the long comment on `loadVoxelInstanceSource` in
 * `zombie-motorworks/src/survival/VoxelAssetLoader.ts` for why a compressed
 * (meshopt-quantized) GLB's per-node transform must be kept rather than
 * assumed to be identity: quantized positions are only correct once the
 * node's decode matrix is reapplied, and an `InstancedMesh` built straight
 * from `mesh.geometry` has no other way to pick that transform up.
 *
 * @typedef {object} InstanceSource
 * @property {THREE.BufferGeometry} geometry
 * @property {THREE.Material} material
 * @property {THREE.Matrix4} localMatrix
 */

/**
 * @param {THREE.Object3D} sceneRoot
 * @returns {Map<string, InstanceSource>}
 */
function collectInstanceSources(sceneRoot) {
  sceneRoot.updateMatrixWorld(true);
  const out = new Map();
  sceneRoot.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const localMatrix = sceneRoot.matrixWorld.clone().invert().multiply(child.matrixWorld);
    out.set(child.name, { geometry: child.geometry, material: child.material, localMatrix });
  });
  return out;
}

export class Assets {
  constructor() {
    /** @type {Map<string, InstanceSource>} */
    this._instanceSources = new Map();
    /** @type {THREE.Texture|null} */
    this._atlasTexture = null;
    /** @type {Record<string, any>|null} */
    this._atlasSprites = null;
    /** @type {Map<string, ArrayBuffer>} name -> raw, not-yet-decoded audio bytes. */
    this.audioBuffers = new Map();
  }

  /**
   * @param {string} name Mesh name, e.g. `'zed_1'`, `'SM-7-Fence'`, `'Gun_03'`.
   * @returns {InstanceSource}
   */
  instanceSource(name) {
    const source = this._instanceSources.get(name);
    if (!source) throw new Error(`assets.instanceSource: no mesh named "${name}"`);
    return source;
  }

  /**
   * A standalone `Mesh` positioned/rotated/scaled as it was authored (its
   * `localMatrix` decomposed onto the new mesh's transform), sharing geometry
   * with every other instance but carrying its own material clone so per-
   * instance material tweaks (a gate's emissive glow, recoil tint) never leak
   * across placements.
   *
   * @param {string} name
   * @returns {THREE.Mesh}
   */
  propMesh(name) {
    const source = this.instanceSource(name);
    const mesh = new THREE.Mesh(source.geometry, source.material.clone());
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    source.localMatrix.decompose(position, quaternion, scale);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    mesh.scale.copy(scale);
    return mesh;
  }

  /**
   * @returns {{ texture: THREE.Texture, sprites: Record<string, any> }}
   */
  atlas() {
    if (!this._atlasTexture || !this._atlasSprites) {
      throw new Error('assets.atlas: not loaded yet');
    }
    return { texture: this._atlasTexture, sprites: this._atlasSprites };
  }
}

/**
 * @param {(progress: number) => void} [onProgress] Called with 0..1 as tasks complete.
 * @returns {Promise<Assets>}
 */
export async function loadAll(onProgress) {
  const assets = new Assets();

  const totalTasks = MODEL_FILES.length + 1 /* atlas texture */ + 1 /* atlas json */ + AUDIO_NAMES.length;
  let done = 0;
  const tick = () => {
    done += 1;
    onProgress?.(Math.min(1, done / totalTasks));
  };

  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);

  const modelLoads = MODEL_FILES.map(async (file) => {
    const gltf = await withRetries(() => gltfLoader.loadAsync(assetUrl(`assets/models/${file}`)));
    replaceMaterials(gltf.scene);
    for (const [name, source] of collectInstanceSources(gltf.scene)) {
      assets._instanceSources.set(name, source);
    }
    tick();
  });

  const textureLoader = new THREE.TextureLoader();
  const atlasLoad = (async () => {
    const texture = await withRetries(() => textureLoader.loadAsync(assetUrl('assets/sprites/brainrot.webp')));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // see the file-top comment: matches brainrot.json's y-down UVs directly.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    assets._atlasTexture = texture;
    tick();
  })();

  const atlasJsonLoad = (async () => {
    const buf = await withRetries(() => fetchArrayBuffer(assetUrl('assets/sprites/brainrot.json')));
    const json = JSON.parse(new TextDecoder().decode(buf));
    assets._atlasSprites = json.sprites;
    tick();
  })();

  const audioLoads = AUDIO_NAMES.map(async (name) => {
    const buf = await withRetries(() => fetchArrayBuffer(assetUrl(`assets/audio/${name}.ogg`)));
    assets.audioBuffers.set(name, buf);
    tick();
  });

  await Promise.all([...modelLoads, atlasLoad, atlasJsonLoad, ...audioLoads]);

  return assets;
}
