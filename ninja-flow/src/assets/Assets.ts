import { AnimationClip, Group, LoadingManager, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { UNLOCKS, type CharacterId } from '../config';
import { registerCosmeticModel } from '../game/CosmeticModels';

export const ENEMY_MODEL_IDS = ['ronin', 'oni', 'tengu'] as const;
export type EnemyModelId = (typeof ENEMY_MODEL_IDS)[number];

/**
 * Progressive asset loading.
 *
 * The ESSENTIAL manifest is exactly what the first frame of combat needs: one
 * character mesh and its clip set. Everything else — the other three ninjas and
 * their clips, which supply the shared move pool and the selector previews —
 * streams in afterwards, one file at a time, so decoding never lands as a spike
 * during a fight.
 *
 * This is real deferral, not a promise started early and awaited later: `boot()`
 * resolves as soon as the essential set is parsed and the game starts there.
 */

export interface CharacterAsset {
  id: CharacterId;
  scene: Group;
  clips: AnimationClip[];
}

// public/ is copied verbatim, so these resolve against Vite's base — which is
// './' here, keeping every request relative to Poki's versioned sub-path.
const BASE = import.meta.env.BASE_URL;
const MODEL_URL = (id: string) => `${BASE}models/${id}.glb`;
const ANIM_URL = (id: string) => `${BASE}anims/${id}.glb`;
const ENEMY_URL = (id: string) => `${BASE}enemies/enemy-${id}.glb`;

export class Assets {
  private readonly loader: GLTFLoader;
  private readonly characters = new Map<CharacterId, CharacterAsset>();
  private readonly pending = new Map<CharacterId, Promise<CharacterAsset>>();
  /** Clips from every loaded character, keyed by clip name. Shared skeleton. */
  private readonly clipPool = new Map<string, AnimationClip>();
  private deferredDone = false;
  private readonly weapons = new Map<string, Group>();
  private weaponsPending: Promise<void> | null = null;
  private readonly enemies = new Map<EnemyModelId, Group>();
  private enemiesPending: Promise<void> | null = null;
  private cosmeticsPending: Promise<void> | null = null;

  constructor() {
    const manager = new LoadingManager();
    this.loader = new GLTFLoader(manager);
  }

  /**
   * Loads the essential set only.
   * @param preferred the character remembered from a previous session
   * @param onProgress 0..1, drives the loading bar
   */
  async boot(preferred: CharacterId, onProgress: (ratio: number) => void): Promise<CharacterAsset> {
    onProgress(0.05);
    const asset = await this.loadCharacter(preferred, (r) => onProgress(0.05 + r * 0.9));
    onProgress(1);
    return asset;
  }

  /**
   * Streams every remaining character in the background, sequentially and with
   * a yield between each so a long parse cannot stall a frame mid-combat.
   */
  async loadDeferred(idleGate: () => Promise<void>): Promise<void> {
    if (this.deferredDone) return;
    for (const id of UNLOCKS.order) {
      if (this.characters.has(id) || this.pending.has(id)) continue;
      await idleGate();
      try {
        await this.loadCharacter(id);
      } catch {
        // A missing optional ninja must never break a run in progress; the
        // selector simply keeps showing it as unavailable.
      }
    }
    this.deferredDone = true;
  }

  /**
   * Streams the armoury. Weapons are deferred like the extra characters: a
   * first frame needs one ninja, not twelve swords, and until they land the
   * enemies carry their procedural fallbacks.
   */
  loadWeapons(ids: readonly string[], idleGate: () => Promise<void>): Promise<void> {
    if (this.weaponsPending) return this.weaponsPending;
    this.weaponsPending = (async () => {
      for (const id of ids) {
        await idleGate();
        try {
          const { scene } = await this.loadGLB(`${BASE}weapons/${id}.glb`, () => {});
          scene.traverse((o) => {
            if (o instanceof Mesh) {
              o.castShadow = true;
              o.receiveShadow = false;
            }
          });
          this.weapons.set(id, scene);
        } catch {
          // A missing weapon leaves its owner on the procedural fallback.
        }
      }
    })();
    return this.weaponsPending;
  }

  /** Streams the original enemy cast before the optional hero catalogue. */
  loadEnemies(idleGate: () => Promise<void>): Promise<void> {
    if (this.enemiesPending) return this.enemiesPending;
    this.enemiesPending = (async () => {
      for (const id of ENEMY_MODEL_IDS) {
        await idleGate();
        try {
          const { scene } = await this.loadGLB(ENEMY_URL(id), () => {});
          scene.updateWorldMatrix(true, true);
          this.enemies.set(id, scene);
        } catch {
          // The procedural combat puppet remains visible if an optional model
          // fails to load, so a broken cosmetic can never stop a fight.
        }
      }
    })();
    return this.enemiesPending;
  }

  /**
   * Streams the wardrobe's model-backed pieces. Deferred like the weapons and
   * for the same reason: the character screen is a second-visit surface, so a
   * first load has no business carrying a hat nobody has chosen yet.
   */
  loadCosmetics(ids: readonly string[], idleGate: () => Promise<void>): Promise<void> {
    if (this.cosmeticsPending) return this.cosmeticsPending;
    this.cosmeticsPending = (async () => {
      for (const id of ids) {
        await idleGate();
        try {
          const { scene } = await this.loadGLB(`${BASE}cosmetics/${id}.glb`, () => {});
          registerCosmeticModel(id, scene);
        } catch {
          // A missing accessory simply stays unequippable; the catalogue entry
          // is still listed, and picking it leaves the character unchanged.
        }
      }
    })();
    return this.cosmeticsPending;
  }

  /** A fresh instance of a loaded weapon, or null if it has not landed yet. */
  weapon(id: string): Group | null {
    const template = this.weapons.get(id);
    return template ? (template.clone(true) as Group) : null;
  }

  get(id: CharacterId): CharacterAsset | null {
    return this.characters.get(id) ?? null;
  }

  /** A skeleton-safe cast member; geometry/material data stays GPU-shared. */
  enemyInstance(index: number): Group | null {
    const id = ENEMY_MODEL_IDS[index % ENEMY_MODEL_IDS.length];
    const template = this.enemies.get(id);
    return template ? (cloneSkeleton(template) as Group) : null;
  }

  isLoaded(id: CharacterId): boolean {
    return this.characters.has(id);
  }

  /**
   * Every clip loaded so far, from any character. All four rigs share the same
   * 24-joint skeleton and bone names, so any clip retargets onto any ninja.
   */
  clip(name: string): AnimationClip | null {
    return this.clipPool.get(name) ?? null;
  }

  /** Finds the first clip whose name matches one of the given patterns. */
  findClip(patterns: readonly string[]): AnimationClip | null {
    for (const p of patterns) {
      for (const [name, clip] of this.clipPool) {
        if (name.toLowerCase().includes(p.toLowerCase())) return clip;
      }
    }
    return null;
  }

  loadCharacter(id: CharacterId, onProgress?: (ratio: number) => void): Promise<CharacterAsset> {
    const existing = this.characters.get(id);
    if (existing) return Promise.resolve(existing);
    const inflight = this.pending.get(id);
    if (inflight) return inflight;

    const task = (async () => {
      let modelRatio = 0;
      let animRatio = 0;
      const report = () => onProgress?.(modelRatio * 0.7 + animRatio * 0.3);

      const [model, anims] = await Promise.all([
        this.loadGLB(MODEL_URL(id), (r) => {
          modelRatio = r;
          report();
        }),
        this.loadGLB(ANIM_URL(id), (r) => {
          animRatio = r;
          report();
        }),
      ]);

      for (const clip of anims.clips) {
        if (!this.clipPool.has(clip.name)) this.clipPool.set(clip.name, clip);
      }

      const asset: CharacterAsset = { id, scene: model.scene, clips: anims.clips };
      this.characters.set(id, asset);
      this.pending.delete(id);
      onProgress?.(1);
      return asset;
    })();

    this.pending.set(id, task);
    return task;
  }

  private loadGLB(
    url: string,
    onProgress: (ratio: number) => void,
  ): Promise<{ scene: Group; clips: AnimationClip[] }> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => resolve({ scene: gltf.scene as Group, clips: gltf.animations }),
        (e) => {
          // lengthComputable is false behind some CDNs; fall back to a nudge so
          // the bar still moves rather than sitting at zero.
          if (e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
          else onProgress(0.5);
        },
        (err) => reject(err),
      );
    });
  }
}

/** Resolves on the next idle slot, or the next frame if idle is unavailable. */
export function idleGate(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 900 });
    else setTimeout(resolve, 120);
  });
}
