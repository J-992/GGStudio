import { describe, expect, it } from 'vitest';
import { previewSeedPlan, SHOWCASE_ROSTER_TIERS } from '../src/data/devPreview';

const env = (overrides: Partial<Parameters<typeof previewSeedPlan>[1]> = {}) => ({
  devMode: true,
  restarted: false,
  loadedFromSave: false,
  tierCount: 29,
  bossCount: 37,
  ...overrides,
});

describe('previewSeedPlan', () => {
  it('seeds nothing in production, even with explicit params', () => {
    const plan = previewSeedPlan({ showcaseTier: '14' }, env({ devMode: false }));
    expect(plan).toEqual({ tiers: [], skipToStage: null });
  });

  it('seeds nothing after a Restart, even with explicit params', () => {
    const plan = previewSeedPlan({ showcaseTier: '3' }, env({ restarted: true }));
    expect(plan).toEqual({ tiers: [], skipToStage: null });
  });

  it('regression: a fresh dev boot with no params seeds nothing', () => {
    const plan = previewSeedPlan({}, env());
    expect(plan).toEqual({ tiers: [], skipToStage: null });
  });

  it('regression: reloading a saved run with no params seeds nothing', () => {
    const plan = previewSeedPlan({}, env({ loadedFromSave: true }));
    expect(plan).toEqual({ tiers: [], skipToStage: null });
  });

  it('an explicit showcaseTier works regardless of save state', () => {
    const saved = previewSeedPlan({ showcaseTier: '14' }, env({ loadedFromSave: true }));
    const fresh = previewSeedPlan({ showcaseTier: '14' }, env());
    expect(saved.tiers).toEqual([14]);
    expect(fresh.tiers).toEqual([14]);
  });

  it('showcaseRoster uses the curated spread', () => {
    const plan = previewSeedPlan({ showcaseRoster: true }, env());
    expect(plan.tiers).toEqual([...SHOWCASE_ROSTER_TIERS]);
  });

  it('an explicit tier wins over the roster flag', () => {
    const plan = previewSeedPlan({ showcaseTier: '7', showcaseRoster: true }, env());
    expect(plan.tiers).toEqual([7]);
  });

  it('showcaseBoss only skips the ladder forward', () => {
    const plan = previewSeedPlan({ showcaseBoss: '12' }, env());
    expect(plan.skipToStage).toBe(12);
  });

  it('invalid or out-of-range values are ignored entirely', () => {
    // 30 is a valid boss stage but an invalid tier; 99 is invalid as either.
    for (const bad of ['abc', '0', '-3', '2.5']) {
      const plan = previewSeedPlan({ showcaseTier: bad, showcaseBoss: bad }, env());
      expect(plan).toEqual({ tiers: [], skipToStage: null });
    }
    const badTier = previewSeedPlan({ showcaseTier: '30', showcaseBoss: '99' }, env());
    expect(badTier).toEqual({ tiers: [], skipToStage: null });
  });

  it('boss values above the ladder are rejected', () => {
    const plan = previewSeedPlan({ showcaseBoss: '99' }, env());
    expect(plan.skipToStage).toBeNull();
  });

  it('empty-string params count as absent asks', () => {
    const plan = previewSeedPlan({ showcaseTier: '', showcaseBoss: '' }, env());
    expect(plan).toEqual({ tiers: [], skipToStage: null });
  });
});
