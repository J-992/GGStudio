import { describe, expect, it } from 'vitest';
import { shouldOfferCommercialBreak } from '../src/platform/adPolicy';

describe('commercial break policy', () => {
  it('protects the first gameplay interaction and only offers ads at a completed run', () => {
    expect(shouldOfferCommercialBreak('firstGameplay')).toBe(false);
    expect(shouldOfferCommercialBreak('runRestart')).toBe(true);
  });
});
