import { DIFFICULTY, TUTORIAL } from '../config';
import type { Rng } from '../core/Rng';

export type Side = 'L' | 'R';

export interface ScheduledThreat {
  /** Plates that must be broken before this threat can be cut down. */
  guard?: number;
  /** A threat that pulls up short: swinging at it is the mistake. */
  feint?: boolean;
  side: Side;
  /** Absolute run time at which this threat's strike should be answered. */
  impactAt: number;
  /** Seconds the enemy spends travelling from spawn to strike range. */
  approach: number;
  rare: boolean;
}

/** Fair pattern primitives. Every one is solvable with LEFT/RIGHT alone. */
const PRIMITIVES: readonly string[][] = [
  ['L'],
  ['R'],
  ['L', 'R'],
  ['R', 'L'],
  ['L', 'R', 'L'],
  ['R', 'L', 'R'],
  ['L', 'L', 'R'],
  ['R', 'R', 'L'],
  ['L', 'R', 'R', 'L'],
  ['R', 'L', 'L', 'R'],
  ['L', 'R', 'L', 'R'],
  ['R', 'L', 'R', 'L'],
  ['L', 'L', 'R', 'R'],
  ['R', 'R', 'L', 'L'],
];

/** Complexity gate: index into PRIMITIVES available at each difficulty phase. */
const COMPLEXITY_POOL: readonly number[] = [2, 4, 6, 8, 11, 14];

export interface PhaseInfo {
  spacing: readonly [number, number];
  approach: number;
  complexity: number;
}

/** Which difficulty phase a run is in, 0-based. Drives the arena's sky. */
export function phaseIndexFor(elapsed: number): number {
  let index = 0;
  for (let i = 0; i < DIFFICULTY.phases.length; i++) {
    if (elapsed >= DIFFICULTY.phases[i].at) index = i;
  }
  return index;
}

export function phaseFor(elapsed: number): PhaseInfo {
  let phase: (typeof DIFFICULTY.phases)[number] = DIFFICULTY.phases[0];
  for (const p of DIFFICULTY.phases) if (elapsed >= p.at) phase = p;
  return {
    spacing: phase.spacing as unknown as readonly [number, number],
    approach: phase.approach,
    complexity: phase.complexity,
  };
}

/**
 * Turns difficulty phases into concrete scheduled impact times.
 *
 * The director schedules by IMPACT time and lets the caller derive spawn time
 * from `approach`. That inversion is what keeps threats fair: the answer beat
 * is decided first, so travel speed can vary without ever producing an
 * unreadable arrival.
 */
export class PatternDirector {
  private patternIndex = 0;
  /** Impact time of the most recently scheduled threat. */
  private cursor = 0;

  constructor(private readonly rng: Rng) {}

  reset(startAt: number): void {
    this.patternIndex = 0;
    this.cursor = startAt;
  }

  /**
   * Produces the next pattern of threats.
   *
   * @param elapsed run time, used to pick the difficulty phase
   * @param tutorialRemaining threats still covered by tutorial safety
   * @param rareAllowed whether rare high-value threats may appear
   */
  nextPattern(elapsed: number, tutorialRemaining: number, rareAllowed: boolean): ScheduledThreat[] {
    const phase = phaseFor(elapsed);

    // The opening beats are hand-shaped: one slow LEFT, then one slow RIGHT, so
    // the very first thing a player learns is the mapping, not the timing.
    const pattern = tutorialRemaining > 0 ? this.tutorialPattern() : this.pickPattern(phase.complexity);

    const isBreather = this.patternIndex % DIFFICULTY.breatherEvery === DIFFICULTY.breatherEvery - 1;
    const isBurst = !isBreather && this.patternIndex % DIFFICULTY.burstEvery === DIFFICULTY.burstEvery - 1;

    const threats: ScheduledThreat[] = [];
    let tutorialLeft = tutorialRemaining;

    for (let i = 0; i < pattern.length; i++) {
      let gap = this.rng.range(phase.spacing[0], phase.spacing[1]);
      if (isBurst) gap *= 0.78;
      if (isBreather && i === 0) gap += DIFFICULTY.breatherBonus;
      gap = Math.max(DIFFICULTY.floorSpacing, gap);

      // Tutorial threats arrive slowly and decelerate their assistance smoothly
      // rather than snapping to full speed the instant safety ends.
      let approach = phase.approach;
      if (tutorialLeft > 0) {
        const t = tutorialLeft / TUTORIAL.safeThreats;
        approach *= 1 + (TUTORIAL.slowFactor - 1) * t;
        gap *= 1 + (TUTORIAL.gapScale - 1) * t;
        tutorialLeft -= 1;
      }

      const rare = rareAllowed && tutorialRemaining === 0 && this.rng.chance(0.055);
      this.cursor += gap;
      threats.push({
        side: pattern[i] as Side,
        impactAt: this.cursor,
        approach: rare ? approach * 0.86 : approach,
        rare,
      });
    }

    this.patternIndex += 1;
    return threats;
  }

  private tutorialPattern(): string[] {
    // First two threats teach one side each; after that, alternate gently.
    if (this.patternIndex === 0) return ['L'];
    if (this.patternIndex === 1) return ['R'];
    if (this.patternIndex === 2) return ['L', 'R'];
    return ['R', 'L'];
  }

  private pickPattern(complexity: number): string[] {
    const limit = COMPLEXITY_POOL[Math.min(complexity, COMPLEXITY_POOL.length - 1)];
    return this.rng.pick(PRIMITIVES.slice(0, limit));
  }

  /** Impact time of the last threat handed out — the schedule's write head. */
  get scheduledUntil(): number {
    return this.cursor;
  }

  /** Pushes the schedule forward, e.g. after Flow Mode's recovery pause. */
  delayTo(time: number): void {
    this.cursor = Math.max(this.cursor, time);
  }
}
