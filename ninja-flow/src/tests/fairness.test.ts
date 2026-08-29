import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { ATTACK, FLOW } from '../config';
import { CombatDirector } from '../game/CombatDirector';
import { Rng } from '../core/Rng';

/**
 * The fairness invariants, exercised against the real director over simulated
 * minutes of play. These are the rules that, when broken, produce the one thing
 * a timing game can never do: an attack the player could not have answered.
 */

const MIN_GAP = ATTACK.total + 0.12;

function simulate(seconds: number, seed: number, opts: { flowAt?: number[] } = {}) {
  const scene = new Scene();
  const director = new CombatDirector(scene, new Rng(seed));
  director.reset(0);

  const impacts: number[] = [];
  const seenIds = new Set<number>();
  const dt = 1 / 60;
  let now = 0;
  const flowAt = new Set(opts.flowAt ?? []);
  let flowsDone = new Set<number>();

  while (now < seconds) {
    now += dt;
    director.update(dt, now, now);

    for (const e of director.liveThreats) {
      if (!e.isThreat) continue;
      const id = Math.round(e.impactAt * 1e4);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        impacts.push(e.impactAt);
      }
      // Stand in for a player answering every threat on the beat, which is
      // what recycles the pool. Without this the sim just fills up and stalls.
      if (now >= e.impactAt) {
        e.kill(0, 1);
        director.consumeTutorialThreat();
      }
    }

    // Simulate Flow interrupting combat at the requested moments.
    for (const t of flowAt) {
      if (now >= t && !flowsDone.has(t)) {
        flowsDone.add(t);
        director.clearThreats(0);
        director.delayTo(now + FLOW.recoverPause);
      }
    }
  }

  impacts.sort((a, b) => a - b);
  return { impacts, director };
}

describe('CombatDirector fairness', () => {
  it('never schedules two impacts inside one attack commitment', () => {
    for (const seed of [1, 7, 23, 101, 999]) {
      const { impacts } = simulate(150, seed);
      expect(impacts.length).toBeGreaterThan(60);
      for (let i = 1; i < impacts.length; i++) {
        expect(impacts[i] - impacts[i - 1], `seed ${seed}, index ${i}`).toBeGreaterThanOrEqual(
          MIN_GAP - 1e-6,
        );
      }
    }
  });

  it('never gives two live threats the same impact time', () => {
    const { impacts } = simulate(150, 5);
    expect(new Set(impacts.map((t) => t.toFixed(4))).size).toBe(impacts.length);
  });

  it('keeps the gap after Flow interrupts and re-times the schedule', () => {
    // Flow clearing the field and pushing the schedule is exactly the path that
    // used to collapse several threats onto one instant.
    const { impacts } = simulate(180, 11, { flowAt: [20, 45, 70, 96, 130] });
    for (let i = 1; i < impacts.length; i++) {
      expect(impacts[i] - impacts[i - 1]).toBeGreaterThanOrEqual(MIN_GAP - 1e-6);
    }
  });

  it('never spawns a threat that is already past its impact time', () => {
    const scene = new Scene();
    const director = new CombatDirector(scene, new Rng(17));
    director.reset(0);
    const dt = 1 / 60;
    let now = 0;
    while (now < 120) {
      now += dt;
      director.update(dt, now, now);
      for (const e of director.liveThreats) {
        if (!e.isThreat) continue;
        // A threat must always still be answerable when it appears: spawning
        // one whose beat has already passed is the definition of unavoidable.
        expect(e.impactAt).toBeGreaterThan(now - 0.02);
        if (now >= e.impactAt) e.kill(0, 1);
      }
    }
  });

  it('survives a wildly variable frame rate without desyncing threats', () => {
    // A phone that stutters between 12 and 120 FPS must still place enemies at
    // the position their schedule implies, because position is derived from
    // time rather than integrated from velocity.
    const scene = new Scene();
    const director = new CombatDirector(scene, new Rng(31));
    director.reset(0);
    const rng = new Rng(4);
    let now = 0;
    while (now < 90) {
      const dt = rng.range(1 / 120, 1 / 12);
      now += dt;
      director.update(dt, now, now);
      for (const e of director.liveThreats) {
        if (!e.isThreat) continue;
        expect(Number.isFinite(e.group.position.x)).toBe(true);
        expect(Math.abs(e.group.position.x)).toBeLessThanOrEqual(9);
        if (now >= e.impactAt) e.kill(0, 1);
      }
    }
  });

  it('keeps the pool bounded across a long run', () => {
    const { director } = simulate(240, 77);
    expect(director.liveThreats.length).toBe(14);
    expect(director.activeCount()).toBeLessThanOrEqual(14);
  });

  it('opens with tutorial threats and then releases the safety', () => {
    const scene = new Scene();
    const director = new CombatDirector(scene, new Rng(2));
    director.reset(0);
    expect(director.tutorialThreatsLeft).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) director.consumeTutorialThreat();
    expect(director.tutorialThreatsLeft).toBe(0);
  });
});

describe('guarded threats', () => {
  /**
   * Breaking a plate buys a second exchange. That second exchange is a threat
   * like any other, so it must obey the same rule: never land inside another
   * threat's answer window, and never arrive before the player could have read
   * it. This is the invariant that stops a guard from turning into an
   * unavoidable hit.
   */
  function simulateGuards(seconds: number, seed: number) {
    const director = new CombatDirector(new Scene(), new Rng(seed));
    director.reset(0);
    const dt = 1 / 60;
    let now = 0;
    let breaks = 0;
    let violations = 0;
    let unreadable = 0;

    while (now < seconds) {
      now += dt;
      // `elapsed` is pushed past the guard unlock so guards actually appear.
      director.update(dt, now, now + 60);

      // Standing invariant, checked every frame rather than only at the break:
      // no two live threats may ever sit inside one answer window, however
      // they got there.
      const live = director.liveThreats
        .filter((e) => e.isThreat)
        .map((e) => e.impactAt)
        .sort((a, b) => a - b);
      for (let i = 1; i < live.length; i++) {
        if (live[i] - live[i - 1] < MIN_GAP - 1e-6) violations += 1;
      }

      for (const e of director.liveThreats) {
        if (!e.isThreat) continue;
        if (now < e.impactAt) continue;
        if (e.guarded) {
          const impact = director.breakGuard(e, now, 0);
          breaks += 1;
          // The re-armed strike must be answerable and readable.
          if (impact - now < ATTACK.total) unreadable += 1;
          for (const other of director.liveThreats) {
            if (other === e || !other.isThreat) continue;
            if (Math.abs(other.impactAt - impact) < MIN_GAP - 1e-6) violations += 1;
          }
        } else {
          e.kill(0, 1);
          director.consumeTutorialThreat();
        }
      }
    }
    return { breaks, violations, unreadable };
  }

  it('never re-arms a broken guard inside another threat answer window', () => {
    for (const seed of [1, 7, 21, 99, 404]) {
      const { breaks, violations, unreadable } = simulateGuards(150, seed);
      expect(breaks, `seed ${seed}`).toBeGreaterThan(3);
      expect(violations, `seed ${seed}`).toBe(0);
      expect(unreadable, `seed ${seed}`).toBe(0);
    }
  });

  it('holds guards back until the player has learned the basic exchange', () => {
    const director = new CombatDirector(new Scene(), new Rng(3));
    director.reset(0);
    const dt = 1 / 60;
    let now = 0;
    let earlyGuards = 0;
    while (now < 38) {
      now += dt;
      director.update(dt, now, now);
      for (const e of director.liveThreats) {
        if (!e.isThreat) continue;
        if (e.guarded) earlyGuards += 1;
        if (now >= e.impactAt) {
          e.kill(0, 1);
          director.consumeTutorialThreat();
        }
      }
    }
    expect(earlyGuards).toBe(0);
  });

  it('drops one plate per broken guard and sends the enemy back out', () => {
    const director = new CombatDirector(new Scene(), new Rng(11));
    director.reset(0);
    const dt = 1 / 60;
    let now = 0;
    let checked = 0;
    while (now < 200 && checked < 5) {
      now += dt;
      director.update(dt, now, now + 60);
      for (const e of director.liveThreats) {
        if (!e.isThreat || now < e.impactAt) continue;
        if (e.guarded) {
          const before = e.guard;
          const distanceBefore = Math.abs(e.group.position.x);
          const impact = director.breakGuard(e, now, 0);
          expect(e.guard).toBe(before - 1);
          expect(impact).toBeGreaterThan(now);
          // Contact itself does not teleport the body. The measured shove is
          // integrated on subsequent frames, then the fair approach resumes.
          expect(Math.abs(e.group.position.x)).toBeCloseTo(distanceBefore, 5);
          e.update(dt, now + dt);
          expect(Math.abs(e.group.position.x)).toBeGreaterThan(distanceBefore);
          expect(e.isThreat).toBe(true);
          checked += 1;
        } else {
          e.kill(0, 1);
          director.consumeTutorialThreat();
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
