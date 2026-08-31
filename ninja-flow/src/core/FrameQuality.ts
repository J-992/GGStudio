export type FrameQualityName = 'high' | 'balanced' | 'low';

export interface FrameQualityProfile {
  name: FrameQualityName;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  ambientStride: number;
}

const TIERS = [
  { name: 'high', maxPixelRatio: 1.5, shadows: true, shadowMapSize: 512, ambientStride: 1 },
  { name: 'balanced', maxPixelRatio: 1.25, shadows: true, shadowMapSize: 256, ambientStride: 2 },
  { name: 'low', maxPixelRatio: 1, shadows: false, shadowMapSize: 256, ambientStride: 3 },
] as const;

/**
 * Slow-moving render-quality governor.
 *
 * Resolution and shadows are the two large GPU costs in this scene. The
 * governor reacts to sustained frame time rather than individual hitches, and
 * recovers much more slowly than it degrades so it cannot oscillate every few
 * seconds on a borderline phone.
 */
export class FrameQuality {
  private tier = 0;
  private averageFrame = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;

  constructor(private readonly devicePixelRatio: number) {}

  get profile(): FrameQualityProfile {
    const tier = TIERS[this.tier];
    return {
      name: tier.name,
      pixelRatio: Math.min(this.devicePixelRatio, tier.maxPixelRatio),
      shadows: tier.shadows,
      shadowMapSize: tier.shadowMapSize,
      ambientStride: tier.ambientStride,
    };
  }

  /** Samples one real frame and returns true only when the tier changed. */
  sample(dtReal: number): boolean {
    if (!Number.isFinite(dtReal) || dtReal <= 0) return false;
    const dt = Math.min(0.1, Math.max(1 / 240, dtReal));
    const blend = 1 - Math.exp(-dt * 3);
    this.averageFrame += (dt - this.averageFrame) * blend;
    const fps = 1 / this.averageFrame;

    const downgradeBelow = this.tier === 0 ? 52 : 42;
    if (this.tier < TIERS.length - 1 && fps < downgradeBelow) this.slowFor += dt;
    else this.slowFor = Math.max(0, this.slowFor - dt * 2);

    if (this.tier > 0 && fps >= 57) this.fastFor += dt;
    else this.fastFor = Math.max(0, this.fastFor - dt);

    if (this.slowFor >= 1.25 && this.tier < TIERS.length - 1) {
      this.tier += 1;
      this.slowFor = 0;
      this.fastFor = 0;
      return true;
    }
    if (this.fastFor >= 8 && this.tier > 0) {
      this.tier -= 1;
      this.slowFor = 0;
      this.fastFor = 0;
      return true;
    }
    return false;
  }
}
