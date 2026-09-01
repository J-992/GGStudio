import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSET_BASE } from './assetBase';
import { megaKitColor } from './MegaKitPalette';
import { POWERUP_COLOR } from '../levels/procedural/PlaceholderAssets';
import { rigCat } from '../entities/CatRig';
import {
  buildCatClips,
  buildFbxClipSet,
  FBX_CLIP_FILES,
  type CatClipName,
} from '../entities/CatAnimations';
import { skinTexturePath } from '../entities/CatSkins';
import type { CatSkinId } from '../game/SaveManager';
import { capsuleFeetOffset } from '../physics/PhysicsConfig';

/**
 * Central loader and cache for every external model in the game.
 *
 * Four source packs are involved and they do NOT agree on scale:
 *
 *   - KayKit City Builder Bits ships at roughly 1/10 scale (a whole building is
 *     2 units wide), so it gets a large uplift.
 *   - KayKit Restaurant Bits is ~10x larger (a crate is 2 units wide).
 *   - Quaternius' Downtown City MegaKit is authored in real metres, which is
 *     already this game's world unit, so it needs no scaling at all.
 *   - The cat and dog rigs are whatever Blender exported.
 *
 * Rather than hard-code a magic multiplier per model, rigged characters are
 * normalised by measuring their bounding box and scaling to a requested height.
 * Static props use a per-pack constant, which is enough because each pack is
 * internally consistent.
 *
 * Everything is cached: a glTF is fetched once, and callers get clones that
 * share geometry and materials.
 */

/** Uniform scale applied to every model from a given pack. */
export const PACK_SCALE = {
  /** City pack authored at 1/10 scale; 12x puts a building at ~24 units wide. */
  city: 12,
  /** Restaurant pack is already near world scale. */
  restaurant: 1.2,
  /** MegaKit is authored in metres, which is already this game's world unit. */
  megakit: 1,
} as const;

export type PackName = keyof typeof PACK_SCALE;

/**
 * Target standing height, in world units, for the Meshy cat mesh.
 *
 * Matches the player capsule's total height (2 * (colliderHalfHeight +
 * colliderRadius) = 1.0) exactly, so the biped's ear tips sit level with the
 * top of the collider it stands on rather than poking through it or floating
 * inside it. This has to be a *height* target, not the horizontal-footprint
 * target `normaliseToLength` uses for the other rigs: the biped is 0.996 tall
 * against only 0.758 wide, so scaling it to match a horizontal measurement
 * (as `loadCat`'s default `targetLength` of 1.15 would) comes out to scale
 * 1.15/0.758 = 1.52 and a 1.51-unit-tall cat standing on a 1-unit capsule.
 */
const KITTY_TARGET_HEIGHT = 2 * capsuleFeetOffset();

/** Where each pack's glTF files live under `public/assets/`. */
const PACK_DIR: Record<PackName, string> = {
  city: 'kaykit/city',
  restaurant: 'kaykit/restaurant',
  megakit: 'megakit',
};

const ASSET_ROOT = `${ASSET_BASE}/assets`;

/**
 * Registry key -> file basename (see `extract-assets.mjs`'s `ITEM_FILES`,
 * which ships `<file>.obj` + `<file>_texture.webp` under `items/`) for every
 * OBJ item prop. Keys match what `PowerUpModels.ts`/`Cat.ts` ask for by name.
 */
const ITEM_MODEL_FILES: Record<string, string> = {
  'item/heart': 'heart',
  'item/shield': 'shield',
  'item/magnet': 'magnet',
  'item/fish': 'fish',
  'item/catnipRush': 'catnipRush',
};

/**
 * Registry key -> the power-up glow colour a provided item model should get.
 * `item/fish` is deliberately absent - it is the collectible/carried fish,
 * not a power-up, and should read as a plain fish, never glow.
 *
 * The procedural fallbacks in `PowerUpModels.ts` already glow (via
 * `PlaceholderAssets.glowing()`); a provided model was loading with a bare
 * `MeshLambertMaterial` and no emissive term at all, which is why pickups
 * with a real model were reported hard to notice against the track - this
 * gives the real models the same treatment as their own fallbacks.
 */
const ITEM_GLOW_COLOR: Partial<Record<string, number>> = {
  'item/shield': POWERUP_COLOR.shield,
  'item/heart': POWERUP_COLOR.nineLives,
  'item/magnet': POWERUP_COLOR.fishMagnet,
  'item/catnipRush': POWERUP_COLOR.catnipRush,
};

/**
 * Common footprint every item prop is scaled to (its largest dimension, in
 * world units) - close to the procedural shield/heart models' own ~0.5-0.65
 * unit span, and to the old procedural fish's ~0.6 unit nose-to-tail length,
 * so no caller needs a different scale just because the model changed.
 */
const ITEM_MODEL_SIZE = 0.6;

/**
 * The townhouse's wall finishes, in the order the seed indexes them.
 *
 * All five share the model's UV layout, so this is the entire cost of a varied
 * neighbourhood: one mesh, five maps. Mirrors BUILDING_TEXTURES in
 * `scripts/extract-assets.mjs`.
 */
const BUILDING_FINISHES = [
  'buildingtexture_beige',
  'buildingtexture_orangebrick',
  'buildingtexture_brownbrick',
  'buildingtexture_yellow',
  'buildingtexture_blue',
] as const;

export interface LoadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  fraction: number;
  currentItem: string;
}

/**
 * The three warnings three.js prints on every FBX this game loads, and why each
 * is noise rather than a defect worth fixing in the art.
 *
 *   - "Vertex has more than 4 skinning weights" - the exporter wrote 6-8
 *     influences per vertex. three.js skins with exactly 4, so it keeps the
 *     four heaviest and drops the rest. On these rigs the discarded weights are
 *     rounding dust; the deformation is the one that has always shipped.
 *   - "ShininessExponent map is not supported" / "ReflectionFactor map ..." -
 *     FBX material channels with no three.js equivalent. Every mesh out of
 *     these files is reassigned a `MeshLambertMaterial` here anyway, so the
 *     skipped maps could not have survived the load in any case.
 *
 * They are printed once per vertex cluster and once per material, which is a
 * few hundred lines across the three files - noise that buries the console for
 * anyone reading it, and the Poki Inspector's event log along with it. Matched
 * on the exact `console.warn` text three.js uses (including the unformatted
 * `%s` variant, which FBXLoader passes as a literal), so anything else the
 * loader has to say still gets through untouched.
 */
const FBX_KNOWN_WARNINGS = [
  'THREE.FBXLoader: Vertex has more than 4 skinning weights',
  'THREE.FBXLoader: %s map is not supported in three.js',
];

/**
 * How many FBX loads are in flight. The filter is installed for the first and
 * removed after the last: `loadCharacterCat()` and the building load overlap,
 * and a plain install/restore pair would have the inner one hand `console.warn`
 * back while the outer load was still parsing.
 */
let fbxLoadsInFlight = 0;
let originalWarn: typeof console.warn | null = null;

/**
 * Runs one FBX load with {@link FBX_KNOWN_WARNINGS} filtered out of the console.
 */
async function loadFbxQuietly(
  loader: FBXLoader,
  url: string,
): Promise<THREE.Group> {
  if (fbxLoadsInFlight === 0) {
    originalWarn = console.warn;
    const pass = originalWarn;
    console.warn = (...args: unknown[]): void => {
      const first = args[0];
      if (
        typeof first === 'string' &&
        FBX_KNOWN_WARNINGS.some((known) => first.startsWith(known))
      ) {
        return;
      }
      pass(...args);
    };
  }
  fbxLoadsInFlight++;

  try {
    return await loader.loadAsync(url);
  } finally {
    fbxLoadsInFlight--;
    if (fbxLoadsInFlight === 0 && originalWarn) {
      console.warn = originalWarn;
      originalWarn = null;
    }
  }
}

export class AssetRegistry {
  private manager = new THREE.LoadingManager();
  private gltfLoader = new GLTFLoader(this.manager);
  private fbxLoader = new FBXLoader(this.manager);
  private objLoader = new OBJLoader(this.manager);
  private textureLoader = new THREE.TextureLoader(this.manager);

  private models = new Map<string, THREE.Object3D>();
  private textures = new Map<string, THREE.Texture>();
  private pending = new Map<string, Promise<unknown>>();
  /** Shared wall finishes for the townhouse - see {@link buildingMaterial}. */
  private buildingMaterials = new Map<string, THREE.MeshLambertMaterial>();

  /** Animation clips keyed by model name. */
  private clips = new Map<string, THREE.AnimationClip[]>();

  /**
   * Which way up the cat's coat maps have to be loaded.
   *
   * The coats in `public/assets/cat/skins/` are one atlas shared by every cat
   * rig this file can load, but the rigs do not agree on where a UV origin is:
   * glTF puts (0,0) at the top-left of the image and FBX at the bottom-left.
   * So the same PNG is correct on `cat_model.glb` unflipped and correct on
   * `kittycat.fbx` flipped, and the answer is a property of whichever model
   * won {@link loadCat}'s fallback chain rather than of the coat.
   *
   * Defaults to the FBX answer, and {@link loadKitty} clears it if the GLB
   * loads. `Cat.load` awaits `loadCat()` before it binds a coat, so this is
   * always settled before {@link loadCatSkin} reads it - which matters because
   * {@link loadTexture} caches on URL alone and would hand back the first
   * orientation asked for.
   */
  private catSkinFlipY = true;

  onProgress: ((p: LoadProgress) => void) | null = null;

  constructor() {
    this.manager.onProgress = (url, loaded, total) => {
      this.onProgress?.({
        loaded,
        total,
        fraction: total > 0 ? loaded / total : 0,
        currentItem: url.split('/').pop() ?? url,
      });
    };
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Loads a KayKit prop. Returns the cached root; use {@link getModel} to get a
   * usable clone.
   */
  async loadProp(pack: PackName, name: string): Promise<THREE.Object3D> {
    const key = `${pack}/${name}`;
    const cached = this.models.get(key);
    if (cached) return cached;

    const existing = this.pending.get(key) as Promise<THREE.Object3D> | undefined;
    if (existing) return existing;

    const url = `${ASSET_ROOT}/${PACK_DIR[pack]}/${name}.gltf`;
    const promise = this.gltfLoader
      .loadAsync(url)
      .then((gltf: GLTF) => {
        const root = gltf.scene;
        root.scale.setScalar(PACK_SCALE[pack]);
        this.prepareMaterials(root, pack);
        root.updateMatrixWorld(true);
        this.models.set(key, root);
        return root;
      })
      .catch((err) => {
        // A missing prop must not take the whole level down - callers fall back
        // to procedural geometry.
        console.warn(`[assets] failed to load ${url}`, err);
        const empty = new THREE.Group();
        this.models.set(key, empty);
        return empty as THREE.Object3D;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, promise);
    return promise;
  }

  /** Loads several props concurrently. */
  async loadProps(pack: PackName, names: readonly string[]): Promise<void> {
    await Promise.all(names.map((n) => this.loadProp(pack, n)));
  }

  /**
   * Loads an obstacle model from `public/assets/obstacles/<name>.glb`.
   *
   * Separate from {@link loadProp} for two reasons that both come down to these
   * not being a KayKit pack: the URL is `.glb` rather than `.gltf`, and the
   * files carry no shared authoring scale to key a `PACK_SCALE` entry off - they
   * are individual exports, each arbitrarily sized. So each one is measured and
   * normalised to the world size the level asked for instead.
   *
   * Cached under `obstacle/<name>`, and {@link getModel} clones from there.
   */
  async loadObstacleModel(name: string, targetHeight: number): Promise<THREE.Object3D> {
    const key = `obstacle/${name}`;
    const cached = this.models.get(key);
    if (cached) return cached;

    const pending = this.pending.get(key);
    if (pending) return pending as Promise<THREE.Object3D>;

    const promise = this.gltfLoader
      .loadAsync(`${ASSET_ROOT}/obstacles/${name}.glb`)
      .then((gltf: GLTF) => {
        const root = gltf.scene;
        normaliseToHeight(root, targetHeight);
        // Sit the model on the ground rather than on its own origin: these are
        // exported about their centre, so an un-shifted one is half buried.
        const box = new THREE.Box3().setFromObject(root);
        root.position.y -= box.min.y;

        this.toLambert(root);
        root.updateMatrixWorld(true);
        this.models.set(key, root);
        return root;
      })
      .catch((err) => {
        // A missing model must not take the level down - ObstacleFactory falls
        // back to the procedural block of the same size.
        console.warn(`[assets] failed to load obstacle ${name}`, err);
        const empty = new THREE.Group();
        this.models.set(key, empty);
        return empty as THREE.Object3D;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, promise);
    return promise;
  }

  /** Loads several obstacle models concurrently. */
  async loadObstacleModels(specs: ReadonlyArray<readonly [string, number]>): Promise<void> {
    await Promise.all(specs.map(([name, height]) => this.loadObstacleModel(name, height)));
  }

  /**
   * Loads the townhouse every rooftop stands on, cached under `building`, and
   * the five wall finishes that dress it.
   *
   * Deliberately **not** normalised, unlike every other model here. It is
   * authored with its origin at the base at roughly the width the level roofs
   * are authored at, so it tiles under them at its own scale. Rescaling it would
   * be throwing away the one property that makes the tiling work.
   *
   * The finishes all share the model's UV layout, so a whole neighbourhood is
   * one geometry and five materials - see {@link buildingMaterial}. The model's
   * own embedded PBR maps are dropped by {@link toLambert} along with the
   * materials that referenced them; nothing here samples a roughness map, and
   * they are three 2048px images per building otherwise held for the whole run.
   */
  async loadBuilding(): Promise<THREE.Object3D> {
    const key = 'building';
    const cached = this.models.get(key);
    if (cached) return cached;

    const pending = this.pending.get(key);
    if (pending) return pending as Promise<THREE.Object3D>;

    const promise = loadFbxQuietly(this.fbxLoader, `${ASSET_ROOT}/building/townhouse.fbx`)
      .then(async (root: THREE.Group) => {
        this.toLambert(root);
        root.updateMatrixWorld(true);
        this.models.set(key, root);

        await this.loadBuildingFinishes();
        return root as THREE.Object3D;
      })
      .catch((err) => {
        // ObstacleFactory falls back to the MegaKit facade, then to the
        // procedural cream block.
        console.warn('[assets] failed to load townhouse.fbx', err);
        const empty = new THREE.Group();
        this.models.set(key, empty);
        return empty as THREE.Object3D;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * One shared Lambert per wall finish, built once and handed to every tile.
   *
   * This is the whole variety budget: five materials over one 327-vertex mesh,
   * so a street of visibly different townhouses adds five draw calls rather than
   * five models. Marked `shared` so level teardown leaves them alone.
   */
  private async loadBuildingFinishes(): Promise<void> {
    await Promise.all(
      BUILDING_FINISHES.map(async (name, index) => {
        const key = `buildingFinish/${index}`;
        if (this.buildingMaterials.has(key)) return;

        const map = await this.loadTexture(`${ASSET_ROOT}/building/${name}.webp`, {
          flipY: true,
          smooth: true,
        });
        const material = new THREE.MeshLambertMaterial({ map });
        material.userData.shared = true;
        this.buildingMaterials.set(key, material);
      }),
    );
  }

  /**
   * The wall finish for a building, chosen deterministically from `seed`.
   *
   * Returns null before the finishes have loaded or if they failed to, in which
   * case the tiles keep the model's own material and the street is uniform
   * rather than absent.
   */
  buildingMaterial(seed: number): THREE.MeshLambertMaterial | null {
    const count = this.buildingMaterials.size;
    if (count === 0) return null;
    const index = Math.abs(Math.round(seed)) % count;
    return this.buildingMaterials.get(`buildingFinish/${index}`) ?? null;
  }

  /** How many distinct wall finishes are available. */
  get buildingFinishCount(): number {
    return this.buildingMaterials.size;
  }

  /**
   * Converts a glTF's PBR materials to the Lambert the rest of the game uses,
   * and drops the map channels nothing here reads.
   *
   * Meshy exports ship 2K normal/roughness/metalness/emissive maps that this
   * renderer never samples; left attached they are uploaded to the GPU and held
   * for the life of the run for nothing.
   *
   * This is also the reason `scripts/bake-assets.py` strips those maps out of
   * the shipped files entirely - dropping them here saves the GPU memory but
   * still pays the download and the decode. If this ever becomes a
   * `MeshStandardMaterial`, the bake's `base_colour_images()` has to be
   * revisited in the same change, or the maps it now needs will not be there.
   */
  private toLambert(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const source = mesh.material as THREE.MeshStandardMaterial;
      const lambert = new THREE.MeshLambertMaterial({
        color: source.color?.clone() ?? new THREE.Color(0xffffff),
        map: source.map ?? null,
        side: THREE.DoubleSide,
        // Dropping these silently turns any alpha-cutout source material (a
        // cloth/foliage plane using its map's alpha channel to cut a shape
        // out of transparency) into a solid opaque quad - the region that
        // should read as sky instead renders as a flat black rectangle,
        // exactly the class of bug BuildingWindows.ts's own header comment
        // already documents for baked canvas textures. `clothesline1.glb`'s
        // cloth plane ships `transparent: true`, which is what surfaced this.
        transparent: source.transparent,
        opacity: source.opacity,
        alphaTest: source.alphaTest,
        alphaMap: source.alphaMap ?? null,
      });

      for (const unused of [
        source.normalMap,
        source.roughnessMap,
        source.metalnessMap,
        source.emissiveMap,
      ]) {
        unused?.dispose();
      }
      source.dispose();

      mesh.material = lambert;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  /**
   * Loads the player cat.
   *
   * Three models can answer to this, best first:
   *
   *   1. `kittycat.fbx` - the character pack's rigged biped, 794 vertices on a
   *      24-joint skeleton, animated by the five takes beside it and skinned
   *      by whichever coat the player has equipped. This is what ships.
   *   2. `cat_model.glb` - a Meshy export: one static 1129-vertex mesh, no
   *      skeleton and no animation, given a generated skeleton by
   *      {@link rigCat} and a hand-authored gait by `buildCatClips`.
   *   3. `cat.fbx` - an older rigged quadruped with one walk cycle, so a failed
   *      download still leaves a moving cat rather than a blank screen.
   *
   * `cat_model.glb` was briefly promoted above the pack - it is 47 KB against
   * the pack's 5.9 MB, and every coat is unwrapped for its UV atlas. It was
   * put back because a generated rig is not a substitute for an authored one
   * on *this* mesh, and the failure is not subtle. Binding is inverse-distance
   * with finite support, so a joint with a wide `reach` claims anything near
   * it, and this mesh's rear vertices sit inside the foot joints' radius:
   * `footL` ends up owning more than half the tail, and the arm chain owns
   * nearly half the hip band. The run cycle then swings the tail with the left
   * foot, which reads as the tail stretching across the model, and the pack's
   * authored takes are lost on top of that.
   *
   * Fixing that means rigging the mesh rather than tuning this table: it needs
   * a skeleton and skin weights authored against the geometry, exported in the
   * GLB, at which point it can go back to position 1 and keep the pack's takes
   * by retargeting through `buildFbxClipSet`.
   *
   * `kitty_model.glb` (V1, a quadruped) and `kitty_modelV2.glb` (the previous
   * Meshy biped) are no longer loaded at all - see CatRig's header comment.
   *
   * @param targetLength desired horizontal footprint, in world units, for the
   *   `cat.fbx` fallback only. Both kitty models are sized against the player
   *   capsule's height instead - see {@link KITTY_TARGET_HEIGHT}.
   */
  async loadCat(targetLength = 1.15): Promise<{ model: THREE.Object3D; clips: THREE.AnimationClip[] }> {
    const key = 'cat';
    if (this.models.has(key)) {
      return { model: this.models.get(key)!, clips: this.clips.get(key) ?? [] };
    }

    const character = await this.loadCharacterCat();
    if (character) {
      this.models.set(key, character.model);
      this.clips.set(key, character.clips);
      return character;
    }

    const kitty = await this.loadKitty();
    if (kitty) {
      this.models.set(key, kitty.model);
      this.clips.set(key, kitty.clips);
      return kitty;
    }

    return this.loadLegacyCat(targetLength);
  }

  /**
   * Loads `kittycat.fbx` plus the animation takes that drive it - the takes
   * ship as GLB, not FBX, purely for size: the same motion data with none of
   * FBX's per-file overhead.
   *
   * The rig and its takes ship as separate files against one shared skeleton,
   * which is what makes six skins affordable: the rig carries no texture
   * reference at all, so a coat is a map bound here rather than another 5 MB
   * copy of the same mesh per variant.
   *
   * The clip set is assembled by {@link buildFbxClipSet}, which takes run, jump
   * and slide straight from the pack and retargets the four states it has no
   * take for. That has to happen **here**, on the freshly loaded rig, because
   * retargeting reads each joint's bind rotation - once a mixer has posed the
   * skeleton those are gone.
   *
   * Returns `null` rather than throwing, so {@link loadCat} can fall back.
   */
  private async loadCharacterCat(): Promise<{
    model: THREE.Object3D;
    clips: THREE.AnimationClip[];
  } | null> {
    const states = Object.keys(FBX_CLIP_FILES) as Array<keyof typeof FBX_CLIP_FILES>;

    let model: THREE.Group;
    let takes: Partial<Record<CatClipName, THREE.AnimationClip[]>>;
    try {
      // The rig itself stays FBX (`kittycat.fbx`) - only the per-state takes
      // are GLB. `THREE.AnimationClip` is loader-agnostic once parsed, so
      // `buildFbxClipSet()` below needs no changes: it only ever sees clip
      // objects, never cares which loader produced them. GLB carries the same
      // motion data as FBX at a fraction of the size (no per-clip file
      // overhead), which is why these ship as GLB despite the name
      // `FBX_CLIP_FILES` (kept as-is - it's a filename-stem table, not a
      // format declaration, and renaming it churns every reference for no
      // behavioural reason).
      const [rig, ...loaded] = await Promise.all([
        loadFbxQuietly(this.fbxLoader, `${ASSET_ROOT}/cat/kittycat.fbx`),
        ...states.map((state) =>
          this.gltfLoader.loadAsync(`${ASSET_ROOT}/cat/anim/${FBX_CLIP_FILES[state]}.glb`),
        ),
      ]);

      model = rig;
      takes = {};
      states.forEach((state, i) => {
        takes[state] = loaded[i].animations ?? [];
      });
    } catch (err) {
      console.warn('[assets] the character pack failed to load, falling back', err);
      return null;
    }

    // Untextured white until a skin is bound - the pack's coats are separate
    // maps and `Cat.setSkin` chooses between them. Lambert to match the rest of
    // the game's lighting, double-sided because the export is not a closed
    // shell and culling backfaces punches holes in the ears.
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      for (const old of previous) old?.dispose();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned bounds go stale as the rig moves, so the cat pops out of view
      // at the screen edge if this is left on.
      mesh.frustumCulled = false;
    });

    normaliseToHeight(model, KITTY_TARGET_HEIGHT);
    model.updateMatrixWorld(true);

    const clips = buildFbxClipSet(takes, model);
    if (!clips) return null;

    return { model, clips };
  }

  /**
   * Loads one of the cat's coats, cached under its own URL.
   *
   * Loaded on demand rather than up front: a skin is a 1024px map, and with
   * eighteen coats on the roster holding them all resident to show one would
   * cost around 70 MB of texture memory for seventeen cats nobody is looking
   * at. That is also why the shop's preview swaps `material.map` instead of
   * building a cat per card.
   *
   * See {@link catSkinFlipY} for why the orientation is not a constant.
   */
  async loadCatSkin(id: CatSkinId): Promise<THREE.Texture> {
    return this.loadTexture(`${ASSET_ROOT}/${skinTexturePath(id)}`, {
      flipY: this.catSkinFlipY,
      smooth: true,
    });
  }

  /**
   * Loads every OBJ+texture item prop (the three power-up pickups this asks
   * for a real model, plus the fish) up front, alongside the rest of boot
   * loading - see {@link loadItemModel}. Cached under `models` exactly like
   * every other pack, so `getModel('item/<name>')` hands out ready-to-use
   * clones from then on with no caller ever awaiting a load.
   */
  async loadItemModels(): Promise<void> {
    await Promise.all(
      Object.entries(ITEM_MODEL_FILES).map(([key, file]) => this.loadItemModel(key, file)),
    );
  }

  /**
   * The endless track's fish-coin collectible: a flat PNG, not an OBJ+texture
   * item prop like {@link loadItemModel}, so it goes through `loadTexture`
   * directly rather than the model pipeline - `Collectible.ts` builds a
   * plain textured disc from it (see `setFishCoinTexture`), not a 3D model.
   *
   * `flipY: true` for the same reason the item textures and building
   * finishes pass it: {@link loadTexture} defaults it *off* because most of
   * its callers are binding maps onto glTF-authored UVs (top-left origin),
   * and this is a plain image on procedural `CircleGeometry` (bottom-left
   * origin) - without it every coin in the game renders upside down. It is a
   * property of the texture, not of any instance, so this one flag fixes
   * every coin at once: they all share the single `coinMaterial` singleton.
   */
  async loadFishCoinTexture(): Promise<THREE.Texture> {
    return this.loadTexture(`${ASSET_ROOT}/items/fish_coin.webp`, { flipY: true });
  }

  /**
   * The Catnip Rush *world pickup's* model: `items/energydrink.glb`.
   *
   * A self-contained GLB rather than the OBJ+separate-texture pair
   * {@link loadItemModel} handles, so it goes through the glTF pipeline
   * ({@link loadObstacleModel}'s shape - load, measure, normalise, sit on the
   * ground) instead, and lands in the same `models` cache under
   * `item/energyDrink` so `getModel()` hands out clones like everything else.
   *
   * Two things it does that `loadObstacleModel` does not:
   *
   *  - The normalised transform is put on an *inner* group, with a plain
   *    identity-scale wrapper handed out as the prototype. `PowerUps.ts`
   *    writes `scale.setScalar(PICKUP_SCALE)` onto whatever model it is
   *    given, which would otherwise wipe the normalisation outright and
   *    render this at whatever raw scale the file was authored at (6 MB of
   *    GLB whose units nothing here controls). The wrapper absorbs that
   *    write; the measured scale underneath survives it.
   *  - It is re-centred horizontally as well as dropped to the ground -
   *    a pickup spins about its parent's origin every frame (see
   *    `ChunkBuilder.updatePowerUps`), so an off-centre model would orbit
   *    rather than turn in place.
   *
   * It also gets the same emissive treatment {@link ITEM_GLOW_COLOR} gives
   * the provided power-up models, using Catnip Rush's own colour, so
   * `pulsePowerUpGlow()` keeps driving the existing idle pulse on it
   * unchanged - swapping the mesh is not meant to cost the VFX.
   *
   * Deliberately NOT wired to `PowerUpModels.setCatnipPickupModel()`: that
   * prototype is shared with the shoes equipped on the cat's own feet
   * (`Cat.attachSneakers()`), and this is only meant to replace what sits in
   * the world.
   */
  async loadEnergyDrinkModel(targetHeight = ITEM_MODEL_SIZE): Promise<THREE.Object3D> {
    const key = 'item/energyDrink';
    const cached = this.models.get(key);
    if (cached) return cached;

    const pending = this.pending.get(key);
    if (pending) return pending as Promise<THREE.Object3D>;

    const promise = this.gltfLoader
      .loadAsync(`${ASSET_ROOT}/items/energydrink.glb`)
      .then((gltf: GLTF) => {
        const inner = gltf.scene;
        normaliseToHeight(inner, targetHeight);

        inner.updateMatrixWorld(true);
        const centre = new THREE.Box3().setFromObject(inner).getCenter(new THREE.Vector3());
        inner.position.x -= centre.x;
        inner.position.z -= centre.z;

        this.toLambert(inner);
        inner.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material as THREE.MeshLambertMaterial;
          // No emissive glow (removed per request - it read as a blob of
          // light rather than the model itself; a low-rate green ember
          // particle effect near the pickup replaces it instead, see
          // `Game.ts`'s energy-drink ember timer). Leaving `glowBase`
          // unstamped already makes `pulsePowerUpGlow()` skip this material
          // (its `typeof base !== 'number'` guard), so no other file needs
          // to change.
          mesh.geometry.userData.shared = true;
          material.userData.shared = true;
        });

        const root = new THREE.Group();
        root.add(inner);
        root.updateMatrixWorld(true);
        this.models.set(key, root);
        return root as THREE.Object3D;
      })
      .catch((err) => {
        // Non-fatal, like every other optional asset here - PowerUpModels
        // falls back to the procedural sneaker.
        console.warn('[assets] failed to load energydrink.glb', err);
        const empty = new THREE.Group();
        this.models.set(key, empty);
        return empty as THREE.Object3D;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Loads one item prop: an OBJ with no embedded material (these ship as a
   * bare mesh plus a single colour-map PNG, same as the dog rig used to),
   * so the texture is bound manually. Scaled and re-centred to a common
   * footprint on the way in - see {@link normaliseItemModel} - so every
   * pickup floats and spins about its own visual centre regardless of
   * whatever scale/pivot the source file happened to author.
   *
   * Failure is non-fatal: whatever falls back to procedural geometry (see
   * `PowerUpModels.ts`/`Cat.buildFish`) keeps the game playable without
   * this model, the same contract every other external asset in this file
   * already has.
   */
  private async loadItemModel(key: string, file: string): Promise<void> {
    if (this.models.has(key)) return;
    try {
      const [obj, tex] = await Promise.all([
        this.objLoader.loadAsync(`${ASSET_ROOT}/items/${file}.obj`),
        this.loadTexture(`${ASSET_ROOT}/items/${file}_texture.webp`, { flipY: true }),
      ]);

      const glowColor = ITEM_GLOW_COLOR[key];
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = new THREE.MeshLambertMaterial({ map: tex });
        if (glowColor !== undefined) {
          // Same glow treatment `PlaceholderAssets.glowing()` gives the
          // procedural fallback - see `ITEM_GLOW_COLOR`'s doc comment.
          material.emissive.setHex(glowColor);
          material.emissiveIntensity = 0.6;
          material.userData.glowBase = material.emissiveIntensity;
        }
        mesh.material = material;
        mesh.castShadow = true;
        // Every caller of getModel(key) gets its own clone of this prototype
        // that SHARES this geometry/material by reference (THREE's default,
        // cheap clone) - marked here so a pool disposing its own clone on
        // teardown doesn't free the resource every other clone (and this
        // cached prototype) still needs. See PowerUpModels.ts's
        // disposeIfOwned(), the consumer-side half of this contract.
        mesh.geometry.userData.shared = true;
        mesh.material.userData.shared = true;
      });

      normaliseItemModel(obj, ITEM_MODEL_SIZE);
      this.models.set(key, obj);
    } catch (err) {
      console.warn(`[assets] item model "${file}" failed to load`, err);
    }
  }

  /**
   * Loads `cat_model.glb` and gives it a skeleton and a clip set.
   *
   * The file is a Meshy export - a single static mesh with no skin and no
   * animations - so everything that makes it posable is generated here. See
   * {@link rigCat} for the skeleton and {@link buildCatClips} for the gait.
   *
   * Returns `null` rather than throwing, so {@link loadCat} can fall back.
   */
  private async loadKitty(): Promise<{ model: THREE.Object3D; clips: THREE.AnimationClip[] } | null> {
    let gltf: GLTF;
    try {
      gltf = await this.gltfLoader.loadAsync(`${ASSET_ROOT}/cat/cat_model.glb`);
    } catch (err) {
      console.warn('[assets] cat_model.glb failed to load, falling back to the character pack', err);
      return null;
    }

    // Do this before rigging: rigCat hands the material straight to the
    // SkinnedMesh it builds, and the game's lighting is Lambert throughout.
    const source = gltf.scene;
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.MeshStandardMaterial
        | undefined;

      // Untextured white until a coat is bound, exactly like the character
      // pack below. Every map the export ships is dropped, base colour
      // included: the file's only image is `__meshy_uv_placeholder_img__`, a
      // UV checker rather than a coat, so binding it would show a
      // chequerboard cat for the frames before `Cat.setSkin` resolves - and
      // permanently, on the one path where a coat fails to load. The real
      // coats are the maps in `public/assets/cat/skins/`.
      mesh.material = new THREE.MeshLambertMaterial({
        // The export declares itself double-sided and the generated shell is
        // not reliably closed, so culling backfaces punches holes in it.
        side: THREE.DoubleSide,
      });

      // Dropping the material is not enough to release what it referenced:
      // GLTFLoader has already decoded every embedded image by the time we
      // get here, and those bitmaps outlive the material that named them.
      for (const unused of [src?.map, src?.normalMap, src?.roughnessMap, src?.metalnessMap, src?.emissiveMap]) {
        unused?.dispose();
      }
      src?.dispose();
    });

    const rig = rigCat(source);
    if (!rig) {
      console.warn('[assets] cat_model.glb has no mesh to rig, falling back to the character pack');
      return null;
    }

    // glTF authors UVs from the top-left, FBX from the bottom-left, and the
    // coats are one atlas shared by both rigs - so which model won decides
    // which way up its maps have to be loaded. See `catSkinFlipY`.
    this.catSkinFlipY = false;

    normaliseToHeight(rig.root, KITTY_TARGET_HEIGHT);

    return { model: rig.root, clips: buildCatClips() };
  }

  /**
   * The original cat rig. Its FBX references its texture by an absolute Blender
   * path that will not resolve, so the skin is loaded separately and bound here.
   */
  private async loadLegacyCat(
    targetLength: number,
  ): Promise<{ model: THREE.Object3D; clips: THREE.AnimationClip[] }> {
    const key = 'cat';
    const [fbx, skin] = await Promise.all([
      loadFbxQuietly(this.fbxLoader, `${ASSET_ROOT}/cat/cat.fbx`),
      this.loadTexture(`${ASSET_ROOT}/cat/catskin.webp`),
    ]);

    const clips = fbx.animations ?? [];

    fbx.traverse((child) => {
      const mesh = child as THREE.Mesh | THREE.SkinnedMesh;
      if (!(mesh as THREE.Mesh).isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.material = new THREE.MeshLambertMaterial({ map: skin });
      mesh.frustumCulled = false; // skinned bounds go stale during animation
    });

    // Normalise: the FBX arrives in Blender/centimetre-ish units.
    normaliseToLength(fbx, targetLength);

    this.models.set(key, fbx);
    this.clips.set(key, clips);
    return { model: fbx, clips };
  }

  /**
   * @param options.flipY glTF authors UVs from the top-left and needs this off,
   *   which is why it defaults off; FBX authors them from the bottom-left, so
   *   the character coats and townhouse finishes pass `true` or arrive upside
   *   down.
   * @param options.smooth palette atlases bleed badly under linear
   *   magnification and stay on nearest; the pack's 1024px colour maps are
   *   continuous-tone and go blocky on it.
   */
  async loadTexture(
    url: string,
    options: { flipY?: boolean; smooth?: boolean } = {},
  ): Promise<THREE.Texture> {
    const cached = this.textures.get(url);
    if (cached) return cached;

    const existing = this.pending.get(url) as Promise<THREE.Texture> | undefined;
    if (existing) return existing;

    const promise = this.textureLoader
      .loadAsync(url)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = options.flipY ?? false;
        tex.magFilter = options.smooth ? THREE.LinearFilter : THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        this.textures.set(url, tex);
        return tex;
      })
      .finally(() => this.pending.delete(url));

    this.pending.set(url, promise);
    return promise;
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Returns a clone of a cached model. Geometry and materials are shared with
   * the original, so clones are cheap.
   */
  getModel(key: string): THREE.Object3D | null {
    const source = this.models.get(key);
    if (!source) return null;
    const copy = source.clone(true);
    copy.updateMatrixWorld(true);
    return copy;
  }

  /**
   * The cached root itself, uncloned. Only for callers that read geometry and
   * materials without keeping or mutating the object - cloning a prototype
   * hundreds of times to immediately bake it into a merge would be pure waste.
   * Anything that puts a model in the scene wants {@link getModel} instead.
   */
  getRawModel(pack: PackName, name: string): THREE.Object3D | null {
    return this.models.get(`${pack}/${name}`) ?? null;
  }

  /** Clone that preserves skeleton bindings. Use for the cat and dogs. */
  getSkinnedModel(key: string): THREE.Object3D | null {
    const source = this.models.get(key);
    if (!source) return null;
    return cloneSkinned(source);
  }

  getClips(key: string): THREE.AnimationClip[] {
    return this.clips.get(key) ?? [];
  }

  getClip(key: string, name: string): THREE.AnimationClip | null {
    const list = this.clips.get(key);
    if (!list) return null;
    return (
      list.find((c) => c.name === name) ??
      list.find((c) => c.name.toLowerCase().includes(name.toLowerCase())) ??
      null
    );
  }

  has(key: string): boolean {
    return this.models.has(key);
  }

  // -------------------------------------------------------------------------

  /** Converts imported materials to the cheap unlit-ish setup the game uses. */
  private prepareMaterials(root: THREE.Object3D, pack: PackName): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // getModel() hands out clones that SHARE this geometry, so whatever the
      // clone's owner does on teardown must not free it. Only dispose() below
      // may.
      if (mesh.geometry) mesh.geometry.userData.shared = true;

      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.MeshStandardMaterial
        | undefined;

      // The MegaKit ships without textures on purpose, so its materials arrive
      // as untinted white. Its material *names* survived extraction, and they
      // are what the palette is keyed on - see MegaKitPalette.
      const color =
        pack === 'megakit'
          ? new THREE.Color(megaKitColor(src?.name))
          : (src?.color ?? new THREE.Color(0xffffff));

      // Lambert is materially cheaper than Standard and the flat-shaded look of
      // every pack here does not benefit from PBR.
      const lambert = new THREE.MeshLambertMaterial({
        map: pack === 'megakit' ? null : (src?.map ?? null),
        color,
      });
      // Shared with every clone of this prototype, and with packMaterial()'s
      // InstancedMesh users. Registry-owned, not caller-owned.
      lambert.userData.shared = true;

      // Palette colours collide by design - several MegaKit materials share one
      // - so the original name is kept for consumers that need to tell them
      // apart. BuildingFacade uses it to drop interior wall faces.
      if (pack === 'megakit' && src?.name) lambert.userData.megakitSource = src.name;

      if (lambert.map) {
        lambert.map.magFilter = THREE.NearestFilter;
        lambert.map.minFilter = THREE.LinearMipmapLinearFilter;
        lambert.map.colorSpace = THREE.SRGBColorSpace;
        lambert.map.needsUpdate = true;
      }

      mesh.material = lambert;
    });
  }

  /** Releases every GPU resource this registry owns. */
  dispose(): void {
    for (const model of this.models.values()) {
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      });
    }
    for (const material of this.buildingMaterials.values()) material.dispose();
    for (const tex of this.textures.values()) tex.dispose();

    this.models.clear();
    this.textures.clear();
    this.buildingMaterials.clear();
    this.clips.clear();
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------

/**
 * Scales an object so its longest horizontal axis matches `targetLength`, and
 * drops it so its feet sit at y = 0.
 *
 * Measuring beats hard-coding because the cat and dog were exported from
 * different Blender scenes with different unit settings.
 */
/**
 * Scales an item prop so its largest dimension matches `targetSize`, and
 * re-centres its geometry on the object's own local origin.
 *
 * Unlike {@link normaliseToLength}/{@link normaliseToHeight}, this does NOT
 * drop the object to sit on y = 0 - these are pickups that float and spin in
 * place, not grounded characters, so the thing that matters is that rotating
 * the returned object spins it about its own visual middle rather than
 * whatever pivot the source file happened to author it around. Geometry is
 * translated in place (not the object's own transform) so the object's
 * position stays at the identity its callers expect to move freely.
 */
function normaliseItemModel(object: THREE.Object3D, targetSize: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.translate(-center.x, -center.y, -center.z);
  });

  const scale = targetSize / Math.max(size.x, size.y, size.z, 1e-6);
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);
}

function normaliseToLength(object: THREE.Object3D, targetLength: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());

  const longest = Math.max(size.x, size.z, 1e-6);
  const scale = targetLength / longest;
  object.scale.multiplyScalar(scale);

  object.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(object);
  object.position.y -= scaled.min.y;
  object.updateMatrixWorld(true);
}

/**
 * Scales an object so its vertical extent matches `targetHeight`, and drops it
 * so its feet sit at y = 0.
 *
 * Used only for the biped kitty rig - see {@link KITTY_TARGET_HEIGHT}. The
 * quadruped fallback (`cat.fbx`) and the dog keep {@link normaliseToLength}:
 * both are low, long-bodied rigs whose *horizontal* footprint is the
 * proportion that actually matters against the level geometry they run
 * through, exactly the opposite of a standing biped.
 */
function normaliseToHeight(object: THREE.Object3D, targetHeight: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());

  const scale = targetHeight / Math.max(size.y, 1e-6);
  object.scale.multiplyScalar(scale);

  object.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(object);
  object.position.y -= scaled.min.y;
  object.updateMatrixWorld(true);
}
