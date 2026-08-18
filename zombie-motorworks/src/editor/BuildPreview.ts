/**
 * Tiny self-contained spinning render of a whole rig, used by the first-run
 * build picker so a new player can look at the three builds before committing
 * to one instead of picking a name off a list.
 *
 * Each canvas gets its own renderer and scene — three small, short-lived
 * contexts that exist only while the modal is open, so there is no need to
 * share one with the main viewport. The returned stop function frees the GL
 * context and must be called as soon as the canvas is hidden; browsers cap how
 * many live WebGL contexts a page may hold, and leaking three per dialog open
 * would eventually take the garage's own viewport down with it.
 *
 * Adapted from the single-part preview the old weapon prompt used: the camera
 * fit is the same, but a rig is a dozen parts spread across a grid rather than
 * one block at the origin, so the framing works off the assembled bounds.
 */

import * as THREE from 'three';
import type { VehicleBlueprint } from '../core/types.ts';
import { getPartDef } from '../core/parts.ts';
import { buildPartMesh } from './meshes.ts';

/**
 * Mounts a spinning preview of `bp` into `host`. Call the returned function to
 * stop the loop and free the GL context.
 *
 * The canvas is created here and destroyed with the preview rather than being
 * handed in and reused, because releasing the context properly requires
 * `forceContextLoss`, and that permanently poisons the element it is called
 * on. A caller that kept one canvas across dialog opens would get a working
 * preview the first time and a dead one after that. `ThreatAlert` rebuilds its
 * canvas for the same reason.
 */
export function mountSpinningRigPreview(
  host: HTMLElement,
  bp: VehicleBlueprint,
): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'build-prompt__preview';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x1a1410, 0.9));
  const key = new THREE.DirectionalLight(0xfff2df, 1.4);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fe3ff, 0.6);
  rim.position.set(-2.4, 1.6, -2);
  scene.add(rim);

  // The rig, built exactly the way the garage builds it — the point of the
  // preview is that what spins here is what the player will be handed.
  const rig = new THREE.Group();
  for (const part of bp.parts) {
    let def;
    try {
      def = getPartDef(part.defId);
    } catch {
      continue;
    }
    rig.add(buildPartMesh(def, part, 1));
  }

  // A rig is laid out across the build grid, not centred on the origin, so it
  // is shifted inside a pivot until its true centre sits at the pivot's origin.
  // Spinning the rig itself would orbit the whole vehicle around empty space.
  const pivot = new THREE.Group();
  pivot.add(rig);
  scene.add(pivot);

  const bounds = new THREE.Box3().setFromObject(rig);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  rig.position.sub(center);

  // Half the bounding box's diagonal, not half its longest axis: a sphere of
  // that radius contains the whole rig from any viewing angle, so a rotating
  // three-quarter camera cannot clip a corner the way a straight-on fit would.
  const boundingRadius = Math.max(size.length() / 2, 0.4);
  const halfVFov = (camera.fov * Math.PI) / 360;
  const margin = 1.15;
  const distance = (boundingRadius / Math.sin(halfVFov)) * margin;
  const yaw = (34 * Math.PI) / 180;
  const pitch = (20 * Math.PI) / 180;
  camera.position.set(
    Math.sin(yaw) * Math.cos(pitch) * distance,
    Math.sin(pitch) * distance,
    Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(0, 0, 0);

  let frame = 0;
  let disposed = false;
  const resize = (): void => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const tick = (): void => {
    if (disposed) return;
    pivot.rotation.y += 0.008;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line))
        return;
      const renderable = child as THREE.Mesh | THREE.Line;
      renderable.geometry.dispose();
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of materials) material.dispose();
    });
    renderer.dispose();
    // `dispose` only releases the resources three is tracking; the GL context
    // itself stays live until the canvas is collected, which may be a long way
    // off. Browsers cap live contexts per page and evict the *oldest* on
    // overflow — which is the main viewport — so three strays per dialog open
    // eventually take the game's own canvas down. This is the half that
    // actually hands the context back, and matches what `PartIconRenderer` and
    // `ThreatAlert` already do.
    renderer.forceContextLoss();
    // Poisoned by the call above, so it never gets reused — the next open
    // builds a fresh one.
    canvas.remove();
  };
}
