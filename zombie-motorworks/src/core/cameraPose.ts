/**
 * Hand-authored camera poses, shared by the garage and the arena.
 *
 * This exists so the trailer capture harness can speak one vocabulary to both
 * modes: a shot list names a position, a look-at point and a field of view, and
 * whichever mode is on screen honours it. It lives in `core/` because it is
 * nothing but numbers — no Three.js, no DOM — and both `editor/` and
 * `survival/` need it without either owning it.
 *
 * Nothing in normal play reads these types. They are reached only through the
 * `?debug=1` seam.
 */

/** A camera pose to impose on a mode, in world metres and degrees. */
export interface DebugCameraPose {
  pos: [number, number, number];
  lookAt: [number, number, number];
  /** Vertical FOV in degrees. Left alone when omitted. */
  fov?: number;
}

/**
 * A pose read back off a live camera.
 *
 * `lookAt` is synthesised — a Three camera stores an orientation, not the point
 * it was aimed at — so it is a point along the view direction rather than the
 * exact argument of the last `lookAt()` call. That is what shot authoring
 * wants: fly the camera by hand, read this, paste it into the shot list.
 */
export interface DebugCameraPoseReadout {
  pos: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

/** Distance ahead of the camera the synthesised `lookAt` point is placed. */
export const DEBUG_LOOK_AT_DISTANCE_M = 10;
