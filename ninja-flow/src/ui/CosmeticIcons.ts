import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { type CosmeticItem, type Palette } from '../game/Cosmetics';

/**
 * Card art for the wardrobe, drawn from the wardrobe itself.
 *
 * Every icon is a render of the actual piece — the same builder the character
 * wears, or the same GLB — framed to the tile and composited over the item's
 * colour plate. Nothing is authored twice, so an icon cannot go stale: change a
 * hat and its card changes with it, and a piece that has not finished streaming
 * simply has no icon yet rather than a wrong one.
 *
 * It is one renderer for the whole grid, not one per card. A browser gives a
 * page somewhere around sixteen WebGL contexts before it starts killing the
 * oldest, and the game is already using one of them; thirty cards with a canvas
 * each would take the arena down with them. This renders each item once, keeps
 * the data URL, and hands the context back when the screen closes.
 */

const SIZE = 128;
/** Three-quarter view: a flat-on hat is a circle, and a boot is a rectangle. */
const YAW = -0.68;
const PITCH = 0.16;

let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: OrthographicCamera | null = null;
const cache = new Map<string, string>();

function ensure(): { renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera } | null {
  if (renderer && scene && camera) return { renderer, scene, camera };
  try {
    // preserveDrawingBuffer, because the pixels are read back with toDataURL
    // after the draw call rather than presented to the screen.
    renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    // No context to spare. Cards fall back to their colour plate.
    return null;
  }
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.setClearAlpha(0);

  scene = new Scene();
  // Lit the way the arena lights the hero, so a piece does not change character
  // between the card and the ninja wearing it.
  scene.add(new HemisphereLight(0xffffff, 0x40485c, 2.3));
  const key = new DirectionalLight(0xffffff, 1.9);
  key.position.set(2.2, 3.4, 2.6);
  scene.add(key);
  const fill = new DirectionalLight(0xbfd0ff, 0.7);
  fill.position.set(-2.6, 1.2, -1.8);
  scene.add(fill);

  camera = new OrthographicCamera(-1, 1, 1, -1, -50, 50);
  return { renderer, scene, camera };
}

/** Hands the context back. Everything already drawn stays cached as an image. */
export function releaseCosmeticIcons(): void {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
}

/**
 * @returns a PNG data URL, or null when there is nothing to draw — a "none"
 * entry, or a model still in flight.
 */
export function cosmeticIcon(item: CosmeticItem, palette: Palette, paletteKey: string): string | null {
  // A built piece takes the palette, so its icon depends on the outfit; a
  // model-backed one keeps its own colours and never does.
  const key = item.model ? item.id : `${item.id}:${paletteKey}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const anchor = item.anchors[0];
  if (!anchor || !item.build) return null;
  // Only the first anchor: a pair mounts twice on the character but would draw
  // one boot on top of the other here, since the spacing is the wardrobe's job.
  const piece = item.build(palette, anchor);
  if (piece.children.length === 0) return null;

  const parts = ensure();
  if (!parts) return null;

  const pivot = new Group();
  pivot.rotation.set(PITCH, YAW, 0);
  pivot.add(piece);
  parts.scene.add(pivot);
  pivot.updateMatrixWorld(true);

  const box = new Box3().setFromObject(pivot);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const half = Math.max(size.x, size.y, 1e-4) * 0.55;
  parts.camera.left = -half;
  parts.camera.right = half;
  parts.camera.top = half;
  parts.camera.bottom = -half;
  parts.camera.position.set(centre.x, centre.y, centre.z + 10);
  parts.camera.lookAt(centre);
  parts.camera.updateProjectionMatrix();

  parts.renderer.render(parts.scene, parts.camera);
  const url = parts.renderer.domElement.toDataURL('image/png');

  parts.scene.remove(pivot);
  // Materials built for this icon belong to it; a model clone's are shared with
  // every other copy of that model and are left alone, exactly as the wardrobe
  // leaves them.
  if (!item.model) {
    const seen = new Set<Material>();
    piece.traverse((o: Object3D) => {
      if (!(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) seen.add(m);
    });
    for (const m of seen) m.dispose();
  }

  cache.set(key, url);
  return url;
}
