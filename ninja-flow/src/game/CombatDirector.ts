import type { Object3D, Scene } from 'three';
import { ATTACK, DIFFICULTY, ENEMY, FEINT, GUARD, TUTORIAL } from '../config';
import type { Rng } from '../core/Rng';
import { Enemy } from './Enemy';
import type { Props } from '../fx/Props';
import { PatternDirector, type ScheduledThreat, type Side } from './PatternDirector';
import { isTargetable, type TimingWindow } from './TimingEvaluator';
import type { Lane } from '../input/InputManager';
import type { ContactImpulse } from './CombatContact';

const POOL_SIZE = 14;

/**
 * The hard fairness floor: two impacts may never be closer than one full
 * attack commitment plus a margin, or the second threat is literally
 * unanswerable while the player is still recovering from the first.
 */
const MIN_ANSWER_GAP = ATTACK.total + 0.12;

/**
 * Owns the live threats: pooling, spawning from the schedule, and target
 * selection.
 *
 * The director schedules IMPACT times first and derives spawn times by
 * subtracting travel, which is the rule that makes every threat answerable.
 * Nothing here decides what a hit is worth — that is the game's job.
 */
export class CombatDirector {
  readonly patterns: PatternDirector;
  private readonly pool: Enemy[] = [];
  private queue: ScheduledThreat[] = [];
  private poolCursor = 0;
  private tutorialRemaining = TUTORIAL.safeThreats;

  constructor(
    scene: Scene,
    private readonly rng: Rng,
    props: Props | null = null,
  ) {
    this.patterns = new PatternDirector(rng);
    for (let i = 0; i < POOL_SIZE; i++) {
      const enemy = new Enemy(props);
      scene.add(enemy.group);
      this.pool.push(enemy);
    }
  }

  /** @param veteran skips tutorial safety — the player has already proven both sides */
  reset(now: number, veteran = false): void {
    for (const e of this.pool) e.retire();
    this.queue = [];
    this.poolCursor = 0;
    this.tutorialRemaining = veteran ? 0 : TUTORIAL.safeThreats;
    // The opening beat is deliberately late: the player gets a moment to read
    // the arena before the first threat commits.
    this.patterns.reset(now + (veteran ? 1.1 : 1.4));
  }

  get tutorialThreatsLeft(): number {
    return this.tutorialRemaining;
  }

  get liveThreats(): readonly Enemy[] {
    return this.pool;
  }

  /** Installs skeleton-safe, player-quality skins on every pooled enemy. */
  setDetailedEnemyModels(factory: (index: number) => Object3D | null): void {
    for (let index = 0; index < this.pool.length; index++) {
      const enemy = this.pool[index];
      const model = factory(index);
      if (model) enemy.setDetailedModel(model);
    }
  }

  /** Threats currently alive and heading for the player. */
  activeCount(): number {
    let n = 0;
    for (const e of this.pool) if (e.isThreat) n++;
    return n;
  }

  update(dt: number, now: number, elapsed: number, advancedMechanics = true): void {
    this.fillSchedule(now, elapsed, advancedMechanics);

    // Spawn anything whose travel window has opened.
    while (this.queue.length > 0 && this.queue[0].impactAt - this.queue[0].approach <= now) {
      const threat = this.queue.shift()!;
      this.spawn(threat, now);
    }

    for (const e of this.pool) e.update(dt, now);
  }

  /**
   * Picks which enemy a swing should hit.
   * Priority: earliest impact on that side, then nearest — deterministic, so
   * the same screen always resolves the same way.
   */
  findTarget(lane: Lane, now: number, window?: TimingWindow): Enemy | null {
    const side: Side = lane === 'left' ? 'L' : 'R';
    let best: Enemy | null = null;
    for (const e of this.pool) {
      if (!e.isThreat || e.side !== side) continue;
      // A feint is deliberately unhittable. Skipping it here is what turns a
      // swing at one into an ordinary whiff, with the whiff's existing cost,
      // rather than needing a punishment of its own.
      if (e.feint) continue;
      if (!isTargetable(now, e.impactAt, window)) continue;
      if (!best) {
        best = e;
        continue;
      }
      if (e.impactAt < best.impactAt) best = e;
      else if (e.impactAt === best.impactAt && Math.abs(e.group.position.x) < Math.abs(best.group.position.x)) {
        best = e;
      }
    }
    return best;
  }

  /** Any threat whose strike moment has passed unanswered. */
  findOverdue(now: number): Enemy | null {
    for (const e of this.pool) {
      if (!e.isThreat || e.feint) continue;
      if (now >= e.impactAt + ENEMY.enemyAttackDelay) return e;
    }
    return null;
  }

  /**
   * Feints whose moment has passed untouched, retired as they are collected.
   *
   * Called once a frame; the caller pays out the reward. A feint that was
   * swung at is already gone — the swing whiffed and the enemy withdrew — so
   * anything returned here was genuinely held.
   */
  collectHeldFeints(now: number): Enemy[] {
    const held: Enemy[] = [];
    for (const e of this.pool) {
      if (!e.isThreat || !e.feint) continue;
      if (now < e.impactAt + FEINT.retreatAfter) continue;
      held.push(e);
      e.retire();
    }
    return held;
  }

  /** The most imminent threat, used for tutorial prompts and camera focus. */
  nextThreat(now: number): Enemy | null {
    let best: Enemy | null = null;
    for (const e of this.pool) {
      if (!e.isThreat) continue;
      if (e.impactAt < now - 0.4) continue;
      if (!best || e.impactAt < best.impactAt) best = e;
    }
    return best;
  }

  consumeTutorialThreat(): void {
    if (this.tutorialRemaining > 0) this.tutorialRemaining -= 1;
  }

  /** Clears the field, e.g. when Flow Mode takes over. */
  clearThreats(launchFromX = 0): void {
    for (const e of this.pool) {
      if (e.isThreat) e.kill(launchFromX, 0.55);
    }
  }

  /**
   * Pushes the whole schedule out, used after Flow's recovery pause.
   *
   * The queue is shifted by one shared delta rather than clamped per threat:
   * clamping would pile several threats onto the same instant, which is how you
   * get two enemies arriving from both sides on the same frame.
   */
  delayTo(time: number): void {
    const first = this.queue[0];
    if (first && first.impactAt < time) {
      const delta = time - first.impactAt;
      for (const t of this.queue) t.impactAt += delta;
    }
    this.patterns.delayTo(Math.max(time, this.lastQueued()));
  }

  private lastQueued(): number {
    return this.queue.length > 0 ? this.queue[this.queue.length - 1].impactAt : 0;
  }

  /** The latest impact time already committed to a live enemy. */
  private lastLive(): number {
    let latest = 0;
    for (const e of this.pool) if (e.isThreat && e.impactAt > latest) latest = e.impactAt;
    return latest;
  }

  private fillSchedule(now: number, elapsed: number, advancedMechanics: boolean): void {
    // Keep roughly two patterns of lookahead so travel windows always exist.
    const horizon = now + 4;
    let guard = 0;
    while (this.patterns.scheduledUntil < horizon && guard++ < 8) {
      const rareAllowed = advancedMechanics && elapsed >= ENEMY.rareUnlockAfter;
      const batch = this.patterns.nextPattern(elapsed, this.tutorialRemaining, rareAllowed);
      for (const threat of batch) {
        // Two clamps, applied in order and then re-imposed on the schedule:
        //   1. a threat must never materialise already mid-approach (unreadable)
        //   2. it must never land inside the previous threat's answer window
        // Sorting alone would not fix (2), because clamping (1) can push a
        // threat forward into its neighbour.
        const earliestReadable = now + threat.approach * 0.75;
        // The clamp is against the last BOOKED impact, not just the last
        // queued one: a guard that was broken re-arms a live threat on a new
        // impact time, and a freshly scheduled threat must clear that too.
        const earliestAnswerable = Math.max(this.lastQueued(), this.lastLive()) + MIN_ANSWER_GAP;
        threat.impactAt = Math.max(threat.impactAt, earliestReadable, earliestAnswerable);
        // A guarded threat costs two exchanges, so it is never stacked onto a
        // rare target and never appears while tutorial safety is still on.
        threat.guard =
          !advancedMechanics || this.tutorialRemaining > 0 || threat.rare
            ? 0
            : this.guardFor(elapsed);
        // A feint is neither guarded nor rare: it is never struck, so a plate
        // on it would be undiscoverable and a bonus on it unclaimable.
        threat.feint =
          !advancedMechanics || this.tutorialRemaining > 0 || threat.rare || threat.guard > 0
            ? false
            : this.feintFor(elapsed);
        if (threat.feint) threat.guard = 0;
        this.queue.push(threat);
      }
      // The queue is built in ascending order by construction, so the pattern
      // director's own cursor is advanced to match rather than re-sorting.
      this.patterns.delayTo(this.lastQueued());
    }
  }

  private spawn(threat: ScheduledThreat, now: number): void {
    let enemy: Enemy | undefined;
    for (let offset = 0; offset < this.pool.length; offset++) {
      const index = (this.poolCursor + offset) % this.pool.length;
      if (this.pool[index].state !== 'dead') continue;
      enemy = this.pool[index];
      this.poolCursor = (index + 1) % this.pool.length;
      break;
    }
    if (!enemy) return; // Pool exhausted — drop rather than allocate mid-run.
    enemy.spawn({
      side: threat.side,
      impactAt: threat.impactAt,
      spawnAt: now,
      approach: Math.max(0.35, threat.impactAt - now),
      rare: threat.rare,
      rng: this.rng,
      guard: threat.guard,
      feint: threat.feint,
    });
  }

  /**
   * A strike that broke a plate rather than the enemy.
   *
   * The enemy re-engages on a fresh impact time. That time is held clear of
   * every other live threat and of the queue by the same fairness gap the
   * schedule uses, and anything it would collide with is pushed out — a second
   * exchange must never make the first threat of the next pattern unanswerable.
   */
  breakGuard(enemy: Enemy, now: number, fromX: number, impulse?: ContactImpulse): number {
    // The re-armed strike is slotted INTO the existing schedule rather than
    // pushed in front of it. Delaying the whole queue on every break would
    // hand the player a breather for winning an exchange, which is backwards:
    // the reward for breaking a guard is the opening, not a quieter fight.
    const impact = this.fairReengageTime(enemy, now + GUARD.recoverSeconds);
    enemy.breakGuard(now, impact - now, fromX, impulse);
    return impact;
  }

  /** Keeps an attacker in play after it connects and schedules its next read. */
  rearmAfterLanding(enemy: Enemy, now: number, fromX: number): number {
    const impact = this.fairReengageTime(enemy, now + ENEMY.retrySeconds);
    enemy.recoverAfterAttack(now, impact - now, fromX);
    return impact;
  }

  /** Finds the first answer window that does not collide with booked combat. */
  private fairReengageTime(enemy: Enemy, candidate: number): number {
    let impact = candidate;
    const booked = [
      ...this.pool.filter((e) => e !== enemy && e.isThreat).map((e) => e.impactAt),
      ...this.queue.map((t) => t.impactAt),
    ].sort((a, b) => a - b);
    // Walking in order matters: clearing one threat's window can move the
    // strike into the next one's.
    for (const other of booked) {
      if (Math.abs(other - impact) < MIN_ANSWER_GAP) impact = other + MIN_ANSWER_GAP;
    }
    return impact;
  }

  /** Whether the next threat should carry a guard, and how many plates. */
  /** Whether the next threat is a feint. Ramps like the guard chance does. */
  feintFor(elapsed: number): boolean {
    if (elapsed < FEINT.fromSeconds) return false;
    const ramp = Math.min(
      1,
      (elapsed - FEINT.fromSeconds) / Math.max(1, FEINT.chanceRampSeconds),
    );
    const chance = FEINT.chanceStart + (FEINT.chanceMax - FEINT.chanceStart) * ramp;
    return this.rng.next() < chance;
  }

  guardFor(elapsed: number): number {
    if (elapsed < GUARD.fromSeconds) return 0;
    const ramp = Math.min(
      1,
      (elapsed - GUARD.fromSeconds) / Math.max(1, GUARD.chanceRampSeconds),
    );
    const chance = GUARD.chanceStart + (GUARD.chanceMax - GUARD.chanceStart) * ramp;
    if (this.rng.next() >= chance) return 0;
    if (elapsed >= GUARD.doubleFromSeconds && this.rng.next() < GUARD.doubleChance) return 2;
    return 1;
  }
}

/** Spacing floor is a hard fairness limit, exported for tests. */
export const MIN_SPACING = DIFFICULTY.floorSpacing;
