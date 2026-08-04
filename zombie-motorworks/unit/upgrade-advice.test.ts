/**
 * Guards on the garage's upgrade coach mark: which single unlock it points at.
 *
 * The ordering is the product decision, so it is what gets asserted — never a
 * literal price, which belongs to the economy tuning in `parts.ts`.
 */

import { describe, expect, it } from 'vitest';
import { recommendUpgrade } from '../src/core/upgradeAdvice.ts';
import { nextUpgrade } from '../src/core/economy.ts';
import type { PlacedPart } from '../src/core/types.ts';

function part(
  id: string,
  defId: string,
  level = 1,
  z = 0,
): PlacedPart {
  return { id, defId, pos: { x: 0, y: 1, z }, orient: 0, config: { level } };
}

/** Exact price of the next unlock on a part, straight from the economy. */
function priceOf(placed: PlacedPart): number {
  const upgrade = nextUpgrade(placed);
  if (upgrade === null) throw new Error(`${placed.defId} has no next upgrade`);
  return upgrade.price;
}

describe('recommendUpgrade', () => {
  it('returns nothing when the rig has no upgradeable parts', () => {
    expect(recommendUpgrade([], 10_000)).toBeNull();
  });

  it('never recommends an unlock the wallet cannot cover', () => {
    const turret = part('p1', 'turret');
    expect(recommendUpgrade([turret], priceOf(turret) - 1)).toBeNull();
    expect(recommendUpgrade([turret], priceOf(turret))?.partId).toBe('p1');
  });

  it('puts a gun ahead of a cheaper non-weapon block', () => {
    const frame = part('p1', 'frame-box');
    const turret = part('p2', 'turret');
    // The frame is the cheaper unlock, so only the weapon rule can pick p2.
    expect(priceOf(frame)).toBeLessThan(priceOf(turret));
    expect(recommendUpgrade([frame, turret], 10_000)?.partId).toBe('p2');
  });

  it('falls back to other blocks once no gun is affordable', () => {
    const frame = part('p1', 'frame-box');
    const turret = part('p2', 'turret');
    const budget = priceOf(turret) - 1;
    expect(priceOf(frame)).toBeLessThanOrEqual(budget);
    expect(recommendUpgrade([frame, turret], budget)?.partId).toBe('p1');
  });

  it('concentrates stars on the gun that already has some', () => {
    const fresh = part('p1', 'turret', 1);
    const started = part('p2', 'turret', 3, 1);
    // The started gun's next unlock costs more, so cheapest-first would pick
    // p1; the "already upgraded" rule has to beat it.
    expect(priceOf(started)).toBeGreaterThan(priceOf(fresh));
    expect(recommendUpgrade([fresh, started], 10_000)?.partId).toBe('p2');
  });

  it('offers the next level up and its price', () => {
    const turret = part('p1', 'turret', 2);
    const advice = recommendUpgrade([turret], 10_000);
    expect(advice).toEqual({
      partId: 'p1',
      defId: 'turret',
      targetLevel: 3,
      price: priceOf(turret),
    });
  });

  it('skips a maxed part and moves to the next candidate', () => {
    const maxed = part('p1', 'turret', 6);
    const other = part('p2', 'turret', 1, 1);
    expect(nextUpgrade(maxed)).toBeNull();
    expect(recommendUpgrade([maxed, other], 10_000)?.partId).toBe('p2');
  });

  it('breaks ties the same way every call, so the mark does not flicker', () => {
    const a = part('p1', 'turret', 2);
    const b = part('p2', 'turret', 2, 1);
    expect(recommendUpgrade([a, b], 10_000)?.partId).toBe('p1');
    expect(recommendUpgrade([b, a], 10_000)?.partId).toBe('p1');
  });

  it('recommends the build signature block like any other gun', () => {
    const tank = part('p1', 'fuel-tank');
    const rod = part('p2', 'storm-rod');
    expect(recommendUpgrade([tank, rod], 10_000)?.partId).toBe('p2');
  });
});
