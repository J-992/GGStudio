/** High-resolution product thumbnails rendered from the garage's real part meshes. */

import * as THREE from 'three';
import type { PartDefinition, PlacedPart } from '../core/types.ts';
import { buildPartMesh } from './meshes.ts';

const ICON_SIZE = 256;
const ICON_PADDING = 1.18;
const CAMERA_DIRECTION = new THREE.Vector3(4, 3.1, 5).normalize();

/**
 * Icons rendered so far, per renderer, and live rather than snapshotted.
 *
 * Callers hold this map and read from it as tiles are built, so an icon that
 * lands after the garage has drawn is still picked up by the next refresh
 * without anybody having to re-request the set.
 */
const iconCache = new WeakMap<THREE.WebGLRenderer, Map<string, string>>();
/** One in-flight incremental render per renderer; a second call joins it. */
const activeRuns = new WeakMap<THREE.WebGLRenderer, IconRun>();

/**
 * How many icons are rendered per animation frame.
 *
 * Each one is a mesh build, a draw, a GPU readback and a PNG encode, so the
 * whole catalogue in one go is a visible freeze on a phone — and it used to sit
 * in the EditorMode constructor, which is the first screen of the game. Four
 * keeps a frame comfortably inside budget while still finishing the catalogue
 * in well under a second.
 */
const ICONS_PER_FRAME = 4;

interface IconRun {
  /** Ids still to draw, in order. */
  readonly queue: string[];
  /** Everyone waiting to hear about newly drawn icons. */
  readonly listeners: Set<(defId: string, url: string) => void>;
  cancelled: boolean;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function framePart(
  camera: THREE.OrthographicCamera,
  part: THREE.Object3D,
): boolean {
  part.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(part);
  if (bounds.isEmpty()) return false;

  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z)
  ) {
    return false;
  }

  part.position.sub(centre);
  part.updateMatrixWorld(true);
  bounds.setFromObject(part);

  const diagonal = Math.max(size.length(), 0.1);
  const cameraDistance = Math.max(4, diagonal * 3.5);
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(cameraDistance);
  camera.near = Math.max(0.01, cameraDistance - diagonal * 2);
  camera.far = cameraDistance + diagonal * 2;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  let halfWidth = 0;
  let halfHeight = 0;
  const corner = new THREE.Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        halfWidth = Math.max(halfWidth, Math.abs(corner.x));
        halfHeight = Math.max(halfHeight, Math.abs(corner.y));
      }
    }
  }

  const halfExtent = Math.max(halfWidth, halfHeight, 0.05) * ICON_PADDING;
  camera.left = -halfExtent;
  camera.right = halfExtent;
  camera.top = halfExtent;
  camera.bottom = -halfExtent;
  camera.updateProjectionMatrix();
  return true;
}

function iconPart(definition: PartDefinition): PlacedPart {
  return {
    id: `icon:${definition.id}`,
    defId: definition.id,
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: {},
  };
}

/** Reject incomplete output and the exact repeated-placeholder regression. */
export function isCompleteDistinctIconSet(
  partIds: readonly string[],
  icons: ReadonlyMap<string, string>,
): boolean {
  const uniqueIds = new Set(partIds);
  if (icons.size !== uniqueIds.size) return false;

  const urls = new Set<string>();
  for (const id of uniqueIds) {
    const url = icons.get(id);
    if (!url?.startsWith('data:image/png;base64,')) return false;
    urls.add(url);
  }
  return urls.size === uniqueIds.size;
}

/**
 * The live icon map for a renderer. Empty until `renderPartIcons` fills it.
 *
 * Handed straight to the garage and to the threat alert, which read it as they
 * build tiles — so an icon that finishes rendering after a panel was drawn is
 * still there for the next refresh.
 */
export function partIconUrls(
  renderer: THREE.WebGLRenderer,
): ReadonlyMap<string, string> {
  return liveIconMap(renderer);
}

function liveIconMap(renderer: THREE.WebGLRenderer): Map<string, string> {
  let cached = iconCache.get(renderer);
  if (!cached) {
    cached = new Map<string, string>();
    iconCache.set(renderer, cached);
  }
  return cached;
}

/** One isolated thumbnail canvas plus the scene it draws parts into. */
interface IconStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  dispose(): void;
}

/**
 * Build the offscreen stage. Capturing its canvas directly avoids multisampled
 * render-target readback, which is not portable across all browser/GPU
 * combinations. Returns null when the rendering API is unavailable, and the
 * garage keeps its lightweight SVG fallbacks.
 */
function createIconStage(): IconStage | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const thumbnailRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    thumbnailRenderer.setPixelRatio(1);
    thumbnailRenderer.setSize(ICON_SIZE, ICON_SIZE, false);
    thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbnailRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbnailRenderer.toneMappingExposure = 1.15;
    thumbnailRenderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const hemisphere = new THREE.HemisphereLight(0xc9dded, 0x352a1f, 1.45);
    const warmKey = new THREE.DirectionalLight(0xffd6a1, 2.35);
    warmKey.position.set(4, 6, 4);
    const coolRim = new THREE.DirectionalLight(0x79aeff, 1.25);
    coolRim.position.set(-5, 2.5, -4);
    scene.add(hemisphere, warmKey, coolRim);

    return {
      renderer: thumbnailRenderer,
      canvas,
      scene,
      camera,
      dispose: () => {
        thumbnailRenderer.dispose();
        thumbnailRenderer.forceContextLoss();
      },
    };
  } catch {
    return null;
  }
}

/** Draw one part onto the stage. Returns its data URL, or null if it failed. */
function drawIcon(stage: IconStage, definition: PartDefinition): string | null {
  const part = buildPartMesh(definition, iconPart(definition));
  stage.scene.add(part);
  try {
    if (!framePart(stage.camera, part)) return null;
    stage.renderer.clear(true, true, true);
    stage.renderer.render(stage.scene, stage.camera);
    return stage.canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    stage.scene.remove(part);
    disposeObject(part);
  }
}

/**
 * Fill in any missing catalogue icons, a few per frame, into the renderer's
 * live map.
 *
 * This used to be one synchronous pass over the whole catalogue inside the
 * EditorMode constructor: twenty-eight mesh builds, draws, GPU readbacks and
 * PNG encodes, blocking the first screen a player ever sees. Spreading it over
 * frames costs nothing visible — every tile has an SVG fallback until its icon
 * lands, and `onIcon` swaps them in as they do.
 *
 * Returns a cancel function; calling it stops the run and releases the canvas.
 * A second call for the same renderer joins the run already in flight.
 */
export function renderPartIcons(
  renderer: THREE.WebGLRenderer,
  definitions: readonly PartDefinition[],
  onIcon?: (defId: string, url: string) => void,
): () => void {
  const icons = liveIconMap(renderer);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  const existing = activeRuns.get(renderer);
  if (existing) {
    if (onIcon) existing.listeners.add(onIcon);
    for (const id of byId.keys()) {
      if (!icons.has(id) && !existing.queue.includes(id)) existing.queue.push(id);
    }
    return () => {
      if (onIcon) existing.listeners.delete(onIcon);
    };
  }

  const queue = [...byId.keys()].filter((id) => !icons.has(id));
  const listeners = new Set<(defId: string, url: string) => void>();
  if (onIcon) listeners.add(onIcon);
  // Everything asked for is already drawn, so there is nothing to schedule and
  // nothing to cancel.
  if (queue.length === 0) return () => undefined;

  const run: IconRun = { queue, listeners, cancelled: false };
  activeRuns.set(renderer, run);

  const stage = createIconStage();
  if (stage === null) {
    activeRuns.delete(renderer);
    return () => undefined;
  }

  const finish = (): void => {
    if (activeRuns.get(renderer) === run) activeRuns.delete(renderer);
    stage.dispose();
  };

  const step = (): void => {
    if (run.cancelled) return finish();
    for (let drawn = 0; drawn < ICONS_PER_FRAME; drawn++) {
      const id = run.queue.shift();
      if (id === undefined) return finish();
      const definition = byId.get(id);
      if (definition === undefined) continue;
      const url = drawIcon(stage, definition);
      // A part that cannot be framed keeps its SVG fallback forever rather
      // than being retried every frame.
      if (url === null) continue;
      icons.set(id, url);
      for (const listener of run.listeners) listener(id, url);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  return () => {
    if (onIcon) run.listeners.delete(onIcon);
    run.cancelled = true;
  };
}
