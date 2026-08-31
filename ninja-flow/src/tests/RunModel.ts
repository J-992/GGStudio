import { Scene } from 'three';
import { ENEMY, FLOW, GUARD, HEALTH, SCORE, TIMING, TUTORIAL } from '../config';
import { CombatDirector } from '../game/CombatDirector';
import { ComboSystem } from '../game/ComboSystem';
import { FlowSystem } from '../game/FlowSystem';
import { evaluate } from '../game/TimingEvaluator';
import { TimingAssist } from '../game/TimingAssist';
import { Rng } from '../core/Rng';
import type { Enemy } from '../game/Enemy';

/**
 * A headless model of one run, used to measure balance.
 *
 * It drives the REAL director, combo, flow and timing systems — only the
 * renderer, audio and animation are absent. That is what makes the numbers it
 * produces trustworthy: the spacing, the Flow curve and the health economy are
 * the ones the game ships with, not a re-implementation.
 *
 * The simulated player is described by two numbers, which is enough to span the
 * population that matters: how precisely they time a swing, and how often they
 * miss a threat entirely.
 */

export interface PlayerProfile {
  /** Standard timing error in seconds. 0 = frame-perfect. */
  errorSeconds: number;
  /** Probability of failing to answer a threat at all. */
  missRate: number;
  /** Chance an attempted answer chooses the wrong side; 50% models blind mashing. */
  wrongLaneRate?: number;
  /** Probability of fumbling any single Flow input. */
  flowFumbleRate: number;
  /**
   * Learning time constant, seconds. Error and miss rate decay toward 40% of
   * their initial values as the run progresses, mirroring how real players
   * sharpen over the first half minute; Infinity disables learning (masher).
   */
  learnSeconds: number;
}

export interface RunOptions {
  /** Models the protected, forced-Flow showcase shown before ordinary runs. */
  firstFlowShowcase?: boolean;
}

export interface RunResult {
  /** Guard plates broken during the run. */
  guardBreaks: number;
  survived: number;
  score: number;
  maxCombo: number;
  flowChains: number;
  perfects: number;
  goods: number;
  whiffs: number;
  damageTaken: number;
  /** Run time at which each milestone first happened, or null. */
  tFirstPerfect: number | null;
  tFirstFlow: number | null;
  tFirstFlowComplete: number | null;
  tFirstDamage: number | null;
  tCombo10: number | null;
}

const DT = 1 / 60;
const ATTACK_LOCK = 0.335;

export function simulateRun(
  profile: PlayerProfile,
  seed: number,
  maxSeconds = 400,
  options: RunOptions = {},
): RunResult {
  // Two independent streams, deliberately.
  //
  // The director's stream belongs to the GAME: spawn patterns, rare targets,
  // guards. The player's stream belongs to the SIMULATED HUMAN: whether they
  // misread a threat, how far off their timing is, whether they fumble a Flow
  // press. Sharing one stream meant any change to how the game draws randomness
  // — even a cosmetic one, like picking a weapon — reshuffled the simulated
  // player's decisions and moved every balance number with it. Separated, a
  // visual change cannot move a balance result, and a real difficulty change
  // still does.
  const rng = new Rng(seed);
  const playerRng = new Rng((seed * 2654435761) >>> 0);
  const director = new CombatDirector(new Scene(), rng);
  const flow = new FlowSystem();
  const combo = new ComboSystem();
  const timingAssist = new TimingAssist();

  director.reset(0);
  flow.reset(options.firstFlowShowcase ? FLOW.firstRunHead : 0);

  let now = 0;
  let hearts = HEALTH.hearts;
  let recovery = 0;
  let lock = 0;
  let score = 0;
  let flowChains = 0;
  let perfects = 0;
  let goods = 0;
  let whiffs = 0;
  let damageTaken = 0;
  let guardBreaks = 0;
  const result: Partial<RunResult> = {};

  /**
   * Decision cached per threat so the player commits to one plan, like a human.
   * Keyed by impact time, NOT by Enemy instance — the pool recycles instances,
   * and a stale per-instance plan would silently mark new threats as handled.
   */
  const plan = new Map<string, { at: number | null; done: boolean; lane: 'left' | 'right' }>();
  const keyOf = (e: Enemy) => e.impactAt.toFixed(4);

  while (hearts > 0 && now < maxSeconds) {
    now += DT;
    lock = Math.max(0, lock - DT);
    recovery = Math.max(0, recovery - DT);

    director.update(DT, now, now);

    // Choose (once) when to swing at each newly visible threat.
    const learn = Number.isFinite(profile.learnSeconds)
      ? 0.4 + 0.6 * Math.exp(-now / profile.learnSeconds)
      : 1;
    for (const enemy of director.liveThreats) {
      if (!enemy.isThreat || plan.has(keyOf(enemy))) continue;
      const miss = playerRng.next() < profile.missRate * learn;
      const jitter = gaussian(playerRng) * profile.errorSeconds * learn;
      const intended = enemy.side === 'L' ? 'left' : 'right';
      const wrong = playerRng.next() < (profile.wrongLaneRate ?? 0);
      const lane = wrong ? (intended === 'left' ? 'right' : 'left') : intended;
      plan.set(keyOf(enemy), { at: miss ? null : enemy.impactAt + jitter, done: false, lane });
    }

    // Swing.
    for (const enemy of director.liveThreats) {
      const p = plan.get(keyOf(enemy));
      if (!p || p.done || p.at === null || !enemy.isThreat) continue;
      if (now < p.at) continue;
      p.done = true;

      if (lock > 0) continue; // Committed to a previous swing: the press is lost.

      const target = director.findTarget(p.lane, now, timingAssist.window);
      const timing = evaluate(now, target ? target.impactAt : null, timingAssist.window);
      if (target) timingAssist.observe(timing.errorMs);
      const quality = timing.quality;

      if (quality === 'perfect' || quality === 'good') {
        lock = ATTACK_LOCK;
        // A guarded enemy eats the strike and comes again on a fresh impact
        // time, so the simulated player has to read and answer it a second
        // time — exactly as the live game asks.
        if (target!.guarded) {
          director.breakGuard(target!, now, 0);
          combo.hit();
          flow.boost(GUARD.flowGain);
          score += Math.round(GUARD.breakScore * combo.multiplier);
          guardBreaks++;
          continue;
        }
        target!.kill(0, 1);
        director.consumeTutorialThreat();
        combo.hit();
        flow.onHit(quality, combo.multiplier);
        score += Math.round((quality === 'perfect' ? SCORE.perfect : SCORE.good) * combo.multiplier);
        if (quality === 'perfect') {
          perfects++;
          result.tFirstPerfect ??= now;
        } else goods++;
        if (combo.count >= 10) result.tCombo10 ??= now;
      } else {
        lock = ATTACK_LOCK * 1.35;
        whiffs++;
        combo.break();
        flow.onHit('whiff', 1);
      }
    }

    // Unanswered threats land.
    const overdue = director.findOverdue(now);
    if (overdue) {
      const safe = options.firstFlowShowcase || director.tutorialThreatsLeft > 0 || recovery > 0;
      director.consumeTutorialThreat();
      director.rearmAfterLanding(overdue, now, 0);
      combo.break();
      if (!safe) {
        hearts -= 1;
        damageTaken += 1;
        recovery = HEALTH.recovery;
        flow.onDamage();
        result.tFirstDamage ??= now;
      }
    }

    if (options.firstFlowShowcase && now >= TUTORIAL.flowForceSeconds && !flow.isFull) {
      flow.boost(FLOW.max);
    }

    // Flow Mode. The showcase is held until the hook beat even if a skilled
    // player fills early, and force-filled there when the cold player did not.
    const flowReady = !options.firstFlowShowcase || now >= TUTORIAL.flowEarliestSeconds;
    if (flow.isFull && flowReady) {
      result.tFirstFlow ??= now;
      const targets = FLOW.minTargets + rng.int(FLOW.maxTargets - FLOW.minTargets + 1);
      let completed = true;
      for (let i = 0; i < targets + 1; i++) {
        if (!options.firstFlowShowcase && playerRng.next() < profile.flowFumbleRate) {
          completed = false;
          break;
        }
        score += Math.round(FLOW.scorePerHit * combo.multiplier);
        combo.hit();
      }
      if (completed) {
        score += Math.round(FLOW.finisherScore * combo.multiplier);
        flowChains += 1;
        result.tFirstFlowComplete ??= now;
      }
      flow.consume(completed);

      // Mirror the game: the field is swept and the schedule pushed out.
      director.clearThreats(0);
      const pause = FLOW.activationHold + targets * 0.4 + FLOW.recoverPause;
      now += pause;
      director.delayTo(now + FLOW.recoverPause);
      if (options.firstFlowShowcase && completed) break;
    }

    // Drop plans whose moment has long passed so the map cannot grow forever.
    if (plan.size > 64) {
      for (const [key] of plan) {
        if (Number(key) < now - 5) plan.delete(key);
      }
    }
  }

  score += Math.round(now * SCORE.survivalPerSecond);

  return {
    survived: now,
    score,
    maxCombo: combo.best,
    flowChains,
    perfects,
    goods,
    whiffs,
    damageTaken,
    guardBreaks,
    tFirstPerfect: result.tFirstPerfect ?? null,
    tFirstFlow: result.tFirstFlow ?? null,
    tFirstFlowComplete: result.tFirstFlowComplete ?? null,
    tFirstDamage: result.tFirstDamage ?? null,
    tCombo10: result.tCombo10 ?? null,
  };
}

/** Player archetypes used across the balance tests. */
export const PROFILES = {
  /** Observed portal cold-open player: broad timing error and frequent missed reads. */
  coldOpen: { errorSeconds: 0.32, missRate: 0.4, flowFumbleRate: 0.22, learnSeconds: 28 },
  firstTimer: { errorSeconds: 0.16, missRate: 0.16, flowFumbleRate: 0.14, learnSeconds: 22 },
  casual: { errorSeconds: 0.1, missRate: 0.07, flowFumbleRate: 0.07, learnSeconds: 30 },
  competent: { errorSeconds: 0.06, missRate: 0.03, flowFumbleRate: 0.03, learnSeconds: 40 },
  expert: { errorSeconds: 0.03, missRate: 0.005, flowFumbleRate: 0.01, learnSeconds: 60 },
  masher: {
    errorSeconds: 0.5,
    missRate: 0.02,
    wrongLaneRate: 0.5,
    flowFumbleRate: 0.3,
    learnSeconds: Infinity,
  },
} as const satisfies Record<string, PlayerProfile>;

/** Box-Muller, clipped, so timing error is bell-shaped rather than uniform. */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.5, Math.min(2.5, g));
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function runMany(profile: PlayerProfile, count: number, options: RunOptions = {}): RunResult[] {
  return Array.from({ length: count }, (_, i) => simulateRun(profile, 1000 + i * 37, 400, options));
}

void TIMING;
void ENEMY;
