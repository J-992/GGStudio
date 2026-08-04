/**
 * Guards on the wave-clear card's full repair being genuinely full.
 *
 * It used to quote only the surviving parts' dents, so a rig that had a wheel
 * torn off was told it could be made whole for the price of its scratches and
 * then rolled into the next wave still missing the wheel. The price now covers
 * buying every torn-off block back, and the card says so.
 */

import { describe, expect, it } from 'vitest';
import { SurvivalMode } from '../src/survival/SurvivalMode.ts';
import { getPartDef } from '../src/core/parts.ts';
import { partRepairCost } from '../src/core/economy.ts';

interface QuoteHarness {
  vehicle: { assembled: { parts: Map<string, unknown> } };
  callbacks: {
    profileMoney(): number;
    missingPartsQuote?(): { cost: number; count: number };
  };
  repairQuote(): {
    cost: number;
    affordable: boolean;
    rebuiltParts: number;
  } | null;
}

function runtimePart(
  defId: string,
  health: number,
  state: { alive?: boolean; detached?: boolean } = {},
): unknown {
  const def = getPartDef(defId);
  return {
    placed: { defId },
    def,
    health,
    alive: state.alive ?? true,
    detached: state.detached ?? false,
  };
}

function harness(options: {
  parts: [string, unknown][];
  money?: number;
  missing?: { cost: number; count: number };
}): QuoteHarness {
  const mode = Object.create(SurvivalMode.prototype) as QuoteHarness;
  Object.assign(mode, {
    vehicle: { assembled: { parts: new Map(options.parts) } },
    callbacks: {
      profileMoney: () => options.money ?? 10_000,
      ...(options.missing
        ? { missingPartsQuote: () => options.missing }
        : {}),
    },
  });
  return mode;
}

const TURRET = getPartDef('turret');
const WHEEL = getPartDef('wheel-standard');

describe('wave-clear full repair quote', () => {
  it('offers nothing on an undamaged, intact rig', () => {
    const mode = harness({
      parts: [['a', runtimePart('turret', TURRET.health)]],
    });
    expect(mode.repairQuote()).toBeNull();
  });

  it('prices the dents on a rig that lost nothing', () => {
    const mode = harness({
      parts: [['a', runtimePart('turret', TURRET.health / 2)]],
    });
    const quote = mode.repairQuote();
    expect(quote?.rebuiltParts).toBe(0);
    expect(quote?.cost).toBe(
      partRepairCost(TURRET.cost, TURRET.health / 2, TURRET.health),
    );
  });

  it('adds the shelf price of every block torn off this wave', () => {
    const mode = harness({
      parts: [
        ['a', runtimePart('turret', TURRET.health / 2)],
        ['b', runtimePart('wheel-standard', 0, { alive: false })],
        ['c', runtimePart('wheel-standard', 20, { detached: true })],
      ],
    });
    const quote = mode.repairQuote();
    expect(quote?.rebuiltParts).toBe(2);
    expect(quote?.cost).toBe(
      partRepairCost(TURRET.cost, TURRET.health / 2, TURRET.health) +
        WHEEL.cost * 2,
    );
  });

  it('never bills a dead or detached part for repair as well as rebuild', () => {
    // A destroyed block is bought back whole; charging its missing HP on top
    // would be paying for the same block twice.
    const mode = harness({
      parts: [['b', runtimePart('wheel-standard', 0, { alive: false })]],
    });
    expect(mode.repairQuote()?.cost).toBe(WHEEL.cost);
  });

  it('includes blocks still missing from an earlier wave', () => {
    const mode = harness({
      parts: [['a', runtimePart('turret', TURRET.health)]],
      missing: { cost: 41, count: 2 },
    });
    const quote = mode.repairQuote();
    expect(quote?.cost).toBe(41);
    expect(quote?.rebuiltParts).toBe(2);
  });

  it('marks the offer unaffordable rather than hiding it', () => {
    const mode = harness({
      parts: [['b', runtimePart('wheel-standard', 0, { alive: false })]],
      money: WHEEL.cost - 1,
    });
    const quote = mode.repairQuote();
    expect(quote?.cost).toBe(WHEEL.cost);
    expect(quote?.affordable).toBe(false);
  });
});
