import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { Cat, type CatVisualInput } from '../entities/Cat';
import { PlayerState } from '../physics/PlayerController';
import { PHYSICS } from '../physics/PhysicsConfig';
import type { CatSkinId } from '../game/SaveManager';

/**
 * Shared, static fields for the preview's per-frame input - `position`,
 * `velocity` and the rest never change frame to frame, so they're read-only
 * template values. `rotation` is deliberately NOT here: `Cat.update()` does
 * `this.root.quaternion.copy(input.rotation)` every call, and the preview
 * turns slowly in place (see `CatPreview.previewInput`/`previewYaw`), so
 * each `CatPreview` instance needs to own (and mutate) its own quaternion
 * rather than share one module-level object another instance could stomp.
 *
 * `horizontalSpeed` is `PHYSICS.runSpeed` - the actual gameplay pace - not
 * an arbitrary "looks about right" number, so the preview's run cycle plays
 * at its authentic speed. The cat never actually translates: `input.position`
 * stays pinned at the origin every frame, so this only ever changes which
 * clip/pose `Cat.update()` selects, not where the model sits.
 */
const IDLE_INPUT_BASE: Omit<CatVisualInput, 'rotation'> = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  horizontalSpeed: PHYSICS.runSpeed,
  lateralSlip: 0,
  steer: 0,
  grounded: true,
  state: PlayerState.Running,
  ducking: false,
};

/** Radians/sec the preview cat spins around its own vertical axis - slow
 *  enough to read as a turntable, not a spin. */
const PREVIEW_ROTATE_RATE = 0.35;
const UP = new THREE.Vector3(0, 1, 0);

const MAX_FRAME_DELTA = 0.1;

/**
 * A small, self-contained 3D view of the cat for the Shop screen.
 *
 * Owns its own scene/camera/renderer and `requestAnimationFrame` loop rather
 * than sharing the main game's - there's no scissor/viewport precedent
 * anywhere in this codebase, and a second canvas keeps this fully isolated
 * from (and unable to interfere with) `Game`'s own render loop. `start()`/
 * `stop()` are the seam `Game` uses to make sure only one of these loops is
 * ever running at a time.
 */
export class CatPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;

  private cat: Cat | null = null;
  private rafHandle = 0;
  private lastTime = 0;
  /** Bumped on every `load()` call so a slow in-flight load can detect it has
   *  been superseded (or the preview disposed) and discard its result instead
   *  of resurrecting a `Cat` nobody wants any more. */
  private loadToken = 0;

  /** This instance's own turntable state - see `IDLE_INPUT_BASE`'s doc
   *  comment for why `rotation` can't be a shared module-level object. */
  private readonly previewInput: CatVisualInput = { ...IDLE_INPUT_BASE, rotation: new THREE.Quaternion() };
  private previewYaw = 0;

  constructor(
    private readonly registry: AssetRegistry,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const ambient = new THREE.AmbientLight(0xfff4e6, 0.8);
    const key = new THREE.DirectionalLight(0xfff2df, 1.6);
    key.position.set(2.2, 3, 2.4);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.35);
    fill.position.set(-2, 1.2, -1.5);
    this.scene.add(ambient, key, fill);

    this.resize();
  }

  /** Re-reads the canvas's CSS size. Call on load and whenever the layout
   *  might have changed (e.g. the window resize handler `Game` already has). */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Loads the cat rig once (subsequent calls just swap the skin) and shows
   * `skinId`. Safe to call again before a previous call has finished -
   * `loadToken` makes a superseded/cancelled load a no-op instead of a race.
   */
  async load(skinId: CatSkinId): Promise<void> {
    // The canvas was hidden (display: none, via `.screen[hidden]`) until the
    // moment this screen was entered, so the constructor's own `resize()`
    // call may have measured a zero/stale rect - and `frameCamera()` below
    // needs an accurate `camera.aspect` to fit the cat without cropping it,
    // not the value left over from whatever the canvas measured last (or
    // never, on the very first entry). `start()` also calls `resize()`, but
    // that runs *after* this method returns, too late for this frame's fit.
    this.resize();

    if (this.cat) {
      await this.cat.setSkin(skinId);
      return;
    }

    const token = ++this.loadToken;
    const cat = new Cat(this.registry);
    await cat.load(skinId);

    if (token !== this.loadToken) {
      // Disposed, or superseded by a second load() call, while this one was
      // in flight.
      cat.dispose();
      return;
    }

    // The preview is about the coat, not the "stolen fish" gameplay prop -
    // showing it here would just be a distraction in a skin-select widget.
    cat.setFishVisible(false);

    this.cat = cat;
    this.scene.add(cat.root);
    this.frameCamera(cat);
  }

  async setSkin(id: CatSkinId): Promise<void> {
    await this.cat?.setSkin(id);
  }

  /**
   * Fits the camera to whatever the rig's actual authored size turns out to
   * be, rather than guessing fixed distances that would drift out of frame
   * if the model is ever re-authored at a different scale.
   *
   * Uses `Cat.getVisualBounds()` rather than a raw `Box3.setFromObject` on
   * the root - the shield sphere parks itself far below the model when
   * inactive instead of detaching, and a naive box would include that parked
   * position, framing the camera around a phantom giant box instead of the
   * cat (the cat ends up a speck, or outside the far plane entirely).
   *
   * Regression: this used to measure `radius` as half the box's *largest
   * single axis* (its height, for a standing cat) and then divide the
   * resulting "just fits" distance by an unexplained 1.5 on top of that -
   * both push the camera closer than the box actually needs, and a
   * three-quarter view looks across the box's diagonal, not just its
   * tallest face, so the true minimum radius (half the diagonal,
   * `size.length() / 2`) is bigger than what was being fit to. Together
   * that cropped the cat down to roughly head-and-shoulders instead of
   * showing it "head to feet," which is what this was asked to fix -
   * there is no zoom factor left here at all: `MARGIN` only ever adds
   * headroom, never crops in past what the geometry needs.
   */
  private frameCamera(cat: Cat): void {
    const box = cat.getVisualBounds();
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Half the box's diagonal: the true radius of the smallest sphere that
    // contains the whole box from any viewing angle.
    const radius = size.length() * 0.5 || 1;

    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    // Whichever axis is tighter is what actually constrains how close the
    // camera can sit without cropping the cat off one edge - a portrait
    // (narrower-than-tall) canvas is constrained by its horizontal FOV, not
    // the vertical one a plain "fits the height" calculation would assume.
    const limitingFov = Math.min(verticalFov, horizontalFov);
    // Headroom so the cat doesn't touch the frame edges - a pure "just
    // fits" distance reads as cramped, not "centred and fully visible."
    const MARGIN = 1.15;
    const distance = (radius * MARGIN) / Math.sin(limitingFov / 2);

    // Three-quarter "character select" angle - a little to one side and
    // slightly above, not a flat front-on silhouette - expressed as actual
    // angles around the fitted distance rather than ad-hoc per-axis
    // fractions of it, so the fit distance derived above is what the
    // camera actually ends up at, not just a number a further transform
    // then partially undoes.
    const azimuth = THREE.MathUtils.degToRad(35);
    const elevation = THREE.MathUtils.degToRad(12);
    const flatDistance = distance * Math.cos(elevation);
    this.camera.position.set(
      center.x + flatDistance * Math.sin(azimuth),
      center.y + distance * Math.sin(elevation),
      center.z + flatDistance * Math.cos(azimuth),
    );
    this.camera.lookAt(center);
  }

  start(): void {
    if (this.rafHandle) return;
    this.resize();
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.rafHandle) return;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  private readonly frame = (now: number): void => {
    this.rafHandle = requestAnimationFrame(this.frame);

    const dt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DELTA);
    this.lastTime = now;

    this.previewYaw += dt * PREVIEW_ROTATE_RATE;
    this.previewInput.rotation.setFromAxisAngle(UP, this.previewYaw);

    this.cat?.update(dt, this.previewInput);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.stop();
    this.loadToken++;
    this.cat?.dispose();
    this.cat = null;
    this.renderer.dispose();
  }
}
