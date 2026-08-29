/**
 * A deliberate twenty-minute retention curve. The first two minutes teach the
 * merge loop, minutes 6–14 shorten the runway, and the final stretch turns
 * every purchase and boss attack into a visible high-pressure decision.
 */
export interface TempoPhase {
  id: 'opening' | 'rising' | 'rivalry' | 'surge' | 'onslaught' | 'ascension';
  label: string;
  startsAtMs: number;
  /** How far below the best discovered unit the shop lags. */
  buyTierOffset: number;
  /** Multiplies earned coins from damage and boss victories. */
  rewardMultiplier: number;
  /** Bosses press the line faster later in a session. */
  attackIntervalMultiplier: number;
  /** Boss strike power rises alongside the faster rhythm. */
  attackDamageMultiplier: number;
}

export const TEMPO_PHASES: readonly TempoPhase[] = [
  { id: 'opening', label: 'OPENING', startsAtMs: 0, buyTierOffset: 4, rewardMultiplier: 1, attackIntervalMultiplier: 1, attackDamageMultiplier: .72 },
  { id: 'rising', label: 'RISING', startsAtMs: 2 * 60_000, buyTierOffset: 3, rewardMultiplier: 1.12, attackIntervalMultiplier: 1.06, attackDamageMultiplier: .84 },
  { id: 'rivalry', label: 'RIVALRY', startsAtMs: 6 * 60_000, buyTierOffset: 3, rewardMultiplier: 1.35, attackIntervalMultiplier: .96, attackDamageMultiplier: 1 },
  // Same relief-valve logic as ONSLAUGHT below: by minute ten the compounding
  // purchase inflation has eaten the cheap-shop headroom, and holding the
  // shop close to the champion here produced 20+ second unaffordable
  // stretches in the pacing sim.
  { id: 'surge', label: 'SURGE', startsAtMs: 10 * 60_000, buyTierOffset: 3, rewardMultiplier: 1.5, attackIntervalMultiplier: .86, attackDamageMultiplier: 1.06 },
  // ONSLAUGHT must not pinch income: minutes 14-18 are where the cost curve
  // bites hardest -- purchase-count inflation has compounded for fifteen
  // minutes by then -- and a starved line slows boss kills, which cuts the
  // victory heals, which ends runs. The shop also steps back a tier here:
  // cheaper units are the relief valve that keeps buys flowing, and the
  // deeper merge ladder they feed is what keeps the last tiers earned.
  { id: 'onslaught', label: 'ONSLAUGHT', startsAtMs: 14 * 60_000, buyTierOffset: 3, rewardMultiplier: 1.55, attackIntervalMultiplier: .82, attackDamageMultiplier: 1.15 },
  { id: 'ascension', label: 'ASCENSION', startsAtMs: 18 * 60_000, buyTierOffset: 3, rewardMultiplier: 2, attackIntervalMultiplier: .78, attackDamageMultiplier: 1.25 },
];

export function tempoFor(timePlayedMs: number): TempoPhase {
  const safe = Math.max(0, timePlayedMs);
  for (let index = TEMPO_PHASES.length - 1; index >= 0; index -= 1) {
    const phase = TEMPO_PHASES[index]!;
    if (safe >= phase.startsAtMs) return phase;
  }
  return TEMPO_PHASES[0]!;
}

/**
 * Policy for how much real time the tempo clock should credit when a speed
 * boost is running.
 *
 * Today `GameCore.update` advances `metrics.timePlayedMs` by
 * `real * speedMultiplier * boostMultiplier`, so one ten-second golden clock
 * at x10 skips the tempo schedule by ~100 seconds and a child is dropped into
 * ONSLAUGHT without playing it. The intended policy is that boosts accelerate
 * the BOARD (bosses die faster, coins flow faster) but contribute at most a
 * 2x reading to the session clock: the player only played ten real seconds,
 * and tempo phases should be reached by playing, not by pickup luck.
 *
 * This helper is the single source of that policy so the suite can pin its
 * arithmetic before the core switches over to it.
 */
export interface BoostClockPolicy {
  /** The active golden-clock multiplier; 1 means no boost. */
  boostMultiplier?: number;
}

export function phaseClockAdvance(realMs: number, policy: BoostClockPolicy = {}): number {
  const raw = policy.boostMultiplier === undefined ? 1 : Math.max(1, policy.boostMultiplier);
  const capped = Math.min(raw, 2);
  return Math.max(0, realMs) * capped;
}
