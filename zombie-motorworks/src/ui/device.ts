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
 * Renderer pixel-ratio ceiling. Portals cap mobile DPR because native iOS DPR
 * multiplies fragment work dramatically for little visible benefit in a fast
 * action game; other touch-first devices retain a modest sharpness allowance.
 */
export function maxPixelRatio(): number {
  if (typeof navigator === 'undefined') return 2;

  const isIOSDevice =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOSDevice) return 1;
  if (isCoarsePointer()) return 1.5;
  return 2;
}

/** Force touch controls on/off. Pass null to return to automatic detection. */
export function setTouchControlsOverride(value: boolean | null): void {
  if (touchControlsOverride === value) return;

  touchControlsOverride = value;
  const enabled = shouldUseTouchControls();
  for (const listener of overrideListeners) listener(enabled);
}
