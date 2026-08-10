/**
 * `?touch=1` forces the on-screen controls on, `?touch=0` forces them off.
 *
 * Touch cannot be exercised from a desktop browser or a headless screenshot
 * run, so without a switch the mobile layout is only ever verified by holding
 * an actual phone. Read once at module load so the very first renderer and HUD
 * decisions already see it.
 */
function overrideFromLocation(): boolean | null {
  if (typeof location === 'undefined') return null;
  try {
    const value = new URLSearchParams(location.search).get('touch');
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    // A malformed query string is not a reason to refuse to boot.
  }
  return null;
}

let touchControlsOverride: boolean | null = overrideFromLocation();

const overrideListeners = new Set<(enabled: boolean) => void>();

/** True when the device can produce touch input at all (phones and tablets). */
export function isTouchCapable(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/** True when the primary pointer is coarse -- i.e. touch is the main input. */
export function isCoarsePointer(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return window.matchMedia('(pointer: coarse)').matches;
}

/** True when on-screen touch controls should be shown. */
export function shouldUseTouchControls(): boolean {
  return touchControlsOverride ?? (isTouchCapable() && isCoarsePointer());
}

/**
 * Subscribe to pointer-primary changes, including a mouse being attached to a
 * tablet. Returns an unsubscribe function.
 */
export function onTouchControlsChange(
  listener: (enabled: boolean) => void,
): () => void {
  overrideListeners.add(listener);

  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)')
      : null;
  const handleChange = (): void => {
    listener(shouldUseTouchControls());
  };
  media?.addEventListener('change', handleChange);

  return () => {
    overrideListeners.delete(listener);
    media?.removeEventListener('change', handleChange);
  };
}

/**
 * Renderer pixel-ratio ceiling.
 *
 * Portal guidance says to pin mobile DPR to 1, and on a 3x phone that is
 * plainly wrong for this game: the art is chunky voxel work with hard edges and
 * thin HUD strokes, and at 1 the whole screen reads as a blurred, aliased mess
 * rather than as pixel art. 2 is the ceiling everywhere — it is already well
 * under a modern phone's native 3, so the worst case is capped, and above 2
 * there is nothing left to see in a moving 3D scene.
 */
export function maxPixelRatio(): number {
  return 2;
}

/** Force touch controls on/off. Pass null to return to automatic detection. */
export function setTouchControlsOverride(value: boolean | null): void {
  if (touchControlsOverride === value) return;

  touchControlsOverride = value;
  const enabled = shouldUseTouchControls();
  for (const listener of overrideListeners) listener(enabled);
}
