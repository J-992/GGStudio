// Offscreen renderer that turns a weapon mesh into a small PNG for the
// weapon-select cards. Card art is a render of the actual weapon, not a
// hand-authored thumbnail: the model and the card can never drift apart, and
// it ships zero image bytes against a build that is already close to the
// budget (see the plan / ASSET_LICENSES.md for the byte accounting).
//
// It is one renderer for the whole grid, not one per card. A browser gives a
// page somewhere around sixteen WebGL contexts before it starts killing the
// oldest, and the game is already using one of them for the arena itself;
// six cards with a canvas each would fight the arena for contexts and could
// take it down. This renders each weapon once into a shared offscreen
// canvas, keeps the resulting data URL, and only gives the context back when
// `dispose()` is called (the caller does that when the weapon-select screen
// closes).
//
// Port of `../ninja-flow/src/ui/CosmeticIcons.ts`'s approach, adapted from a
// module-level singleton to an instantiable class since this game may want
// more than one call site (or none, if WebGL isn't available at all).
import * as THREE from 'three';

/** Three-quarter view: front-on, a rifle reads as a flat sliver. */
const YAW = -0.68;
const PITCH = 0.16;

export class WeaponIcons {
  /** @param {number} [size] Pixel size of the square icon. */
  constructor(size = 128) {
    this._size = size;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._cache = new Map();
  }

  /** Lazily creates the renderer/scene/camera. Returns null if no WebGL
   * context could be had (e.g. a low-end phone already at its context cap,
   * or a headless/test environment). */
  _ensure() {
    if (this._renderer && this._scene && this._camera) return true;
    try {
      // preserveDrawingBuffer: the pixels are read back with toDataURL after
      // the draw call rather than presented to the screen.
      this._renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch {
      this._renderer = null;
      return false;
    }
    this._renderer.setSize(this._size, this._size, false);
    this._renderer.setPixelRatio(1);
    this._renderer.setClearAlpha(0);

    this._scene = new THREE.Scene();
    // Lit comparably to `Arena.js#_buildLights` (hemisphere + directional
    // sun) so a weapon does not change character between its card and the
    // one held in the arena, and so its MeshLambertMaterial parts aren't
    // black — Lambert needs a light source to shade at all.
    this._scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1a12, 1.3));
    const key = new THREE.DirectionalLight(0xffe9c7, 1.4);
    key.position.set(2.2, 3.4, 2.6);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd0ff, 0.6);
    fill.position.set(-2.6, 1.0, -1.8);
    this._scene.add(fill);

    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
    return true;
  }

  /**
   * @param {string} id
   * @param {() => THREE.Object3D} build Builds the mesh to render. Called at
   *   most once per id; the result is cached.
   * @returns {string|null} A PNG data URL, or `null` if no WebGL context
   *   could be had — the caller then falls back to a text-only card.
   */
  iconFor(id, build) {
    const cached = this._cache.get(id);
    if (cached) return cached;

    if (!this._ensure()) return null;

    // Assumption: `build()` constructs a fresh THREE.Group/mesh tree with
    // geometries and materials owned by this one call (a weapon-select
    // preview, not a live in-arena weapon instance) — so it is safe to
    // dispose everything under it once the icon is rendered. If a future
    // `build` ever hands back shared/cached resources (e.g. a shared prop
    // geometry), this will over-dispose; that closure would need to say so.
    const piece = build();

    const pivot = new THREE.Group();
    pivot.rotation.set(PITCH, YAW, 0);
    pivot.add(piece);
    this._scene.add(pivot);
    pivot.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(pivot);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.x, size.y, 1e-4) * 0.6; // margin around the model
    this._camera.left = -half;
    this._camera.right = half;
    this._camera.top = half;
    this._camera.bottom = -half;
    this._camera.position.set(centre.x, centre.y, centre.z + 10);
    this._camera.lookAt(centre);
    this._camera.updateProjectionMatrix();

    this._renderer.render(this._scene, this._camera);
    const url = this._renderer.domElement.toDataURL('image/png');

    this._scene.remove(pivot);
    const seen = new Set();
    piece.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) seen.add(m);
    });
    for (const m of seen) m.dispose();

    this._cache.set(id, url);
    return url;
  }

  /** Releases the renderer and its WebGL context. Safe to call twice. */
  dispose() {
    if (!this._renderer) return;
    this._renderer.dispose();
    this._renderer.forceContextLoss();
    this._renderer = null;
    this._scene = null;
    this._camera = null;
  }
}
