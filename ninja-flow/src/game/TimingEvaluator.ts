import { TIMING } from '../config';

export type HitQuality = 'perfect' | 'good' | 'whiff' | 'late';

export interface TimingResult {
  quality: HitQuality;
  /** Signed error in ms: negative = early, positive = late. */
  errorMs: number;
}

/**
 * Grades one swing against a threat's ideal impact time.
 *
 * Deliberately pure and frame-rate independent: it compares timestamps, never
 * distances or frame counts, so a 30 FPS phone grades identically to a 144 Hz
 * desktop. `null` means the swing found no target at all — a blind swing.
 */
export function evaluate(nowSeconds: number, impactTimeSeconds: number | null): TimingResult {
  if (impactTimeSeconds === null) return { quality: 'whiff', errorMs: Number.NaN };

  const errorMs = (nowSeconds - impactTimeSeconds) * 1000;

  if (Math.abs(errorMs) <= TIMING.perfectMs) return { quality: 'perfect', errorMs };
  if (errorMs < 0 && errorMs >= -TIMING.goodEarlyMs) return { quality: 'good', errorMs };
  if (errorMs > 0 && errorMs <= TIMING.goodLateMs) return { quality: 'good', errorMs };
  if (errorMs < 0) return { quality: 'whiff', errorMs };
  return { quality: 'late', errorMs };
}

/** True when a threat is close enough that a swing should target it at all. */
export function isTargetable(nowSeconds: number, impactTimeSeconds: number): boolean {
  const errorMs = (nowSeconds - impactTimeSeconds) * 1000;
  return errorMs >= -TIMING.whiffBeyondMs && errorMs <= TIMING.goodLateMs;
}
