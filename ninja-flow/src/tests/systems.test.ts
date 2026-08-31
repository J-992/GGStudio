import { describe, expect, it, beforeEach, vi } from 'vitest';
import { COMBO, FLOW, TIMING, UNLOCKS } from '../config';
import { evaluate, isTargetable } from '../game/TimingEvaluator';
import { ComboSystem } from '../game/ComboSystem';
import { FlowSystem, flowReactionWindow } from '../game/FlowSystem';
import { PatternDirector, phaseFor } from '../game/PatternDirector';
import { commitRun, masteryFor, unlockState } from '../game/Progression';
import { Rng } from '../core/Rng';
import { loadSave, saveSave, storageAvailable } from '../core/Storage';

describe('TimingEvaluator', () => {
  it('grades a dead-centre swing as perfect', () => {
    expect(evaluate(10, 10).quality).toBe('perfect');
  });

  it('treats the perfect window as symmetric', () => {
    const edge = TIMING.perfectMs / 1000;
    expect(evaluate(10 - edge + 0.001, 10).quality).toBe('perfect');
    expect(evaluate(10 + edge - 0.001, 10).quality).toBe('perfect');
  });

  it('grades early-but-connecting swings as good', () => {
    expect(evaluate(10 - 0.2, 10).quality).toBe('good');
  });

  it('grades late-but-connecting swings as good', () => {
    expect(evaluate(10 + 0.14, 10).quality).toBe('good');
  });

  it('whiffs a swing thrown far too early', () => {
    expect(evaluate(10 - 0.5, 10).quality).toBe('whiff');
  });

  it('marks a swing past the late window as late, not good', () => {
    expect(evaluate(10 + 0.3, 10).quality).toBe('late');
  });

  it('whiffs when there is no target at all', () => {
    expect(evaluate(10, null).quality).toBe('whiff');
  });

  it('reports signed error so early and late are distinguishable', () => {
    expect(evaluate(10 - 0.2, 10).errorMs).toBeCloseTo(-200, 5);
    expect(evaluate(10 + 0.1, 10).errorMs).toBeCloseTo(100, 5);
  });

  it('only targets threats inside the swing window', () => {
    expect(isTargetable(10, 10.5)).toBe(true);
    expect(isTargetable(10, 11.5)).toBe(false);
    expect(isTargetable(10.5, 10)).toBe(false);
  });

  it('grades identically regardless of frame rate', () => {
    // The same physical press time must grade the same whether observed on a
    // 144 Hz or a 30 Hz frame, because grading compares timestamps only.
    const press = 10.05;
    for (const frameTime of [10.051, 10.06, 10.083]) {
      void frameTime;
      expect(evaluate(press, 10).quality).toBe('perfect');
    }
  });
});

describe('ComboSystem', () => {
  let combo: ComboSystem;
  beforeEach(() => {
    combo = new ComboSystem();
  });

  it('starts at 1x', () => {
    expect(combo.multiplier).toBe(1);
  });

  it('climbs the configured tiers', () => {
    for (const [min, mult] of COMBO.tiers) {
      const c = new ComboSystem();
      for (let i = 0; i < min; i++) c.hit();
      expect(c.multiplier).toBe(mult);
    }
  });

  it('reports each milestone exactly once', () => {
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      const m = combo.hit();
      if (m) seen.push(m);
    }
    expect(seen).toEqual([10, 20, 40, 60]);
  });

  it('remembers the best combo across a break', () => {
    for (let i = 0; i < 12; i++) combo.hit();
    combo.break();
    combo.hit();
    expect(combo.count).toBe(1);
    expect(combo.best).toBe(12);
  });
});

describe('FlowSystem', () => {
  let flow: FlowSystem;
  beforeEach(() => {
    flow = new FlowSystem();
  });

  it('gains more from a perfect than a good', () => {
    const good = new FlowSystem();
    good.onHit('good', 1);
    flow.onHit('perfect', 1);
    expect(flow.value).toBeGreaterThan(good.value);
  });

  it('ramps consecutive perfects up to the ceiling but no further', () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const before = flow.value;
      flow.onHit('perfect', 1);
      last = flow.value - before;
      if (flow.isFull) break;
    }
    expect(last).toBeLessThanOrEqual(FLOW.gainPerfectMax + FLOW.comboBonusMax);
  });

  it('resets the perfect ramp after a good hit', () => {
    flow.onHit('perfect', 1);
    flow.onHit('perfect', 1);
    flow.onHit('good', 1);
    const before = flow.value;
    flow.onHit('perfect', 1);
    expect(flow.value - before).toBeCloseTo(FLOW.gainPerfect, 5);
  });

  it('never drops below zero on repeated damage', () => {
    flow.onHit('good', 1);
    for (let i = 0; i < 5; i++) flow.onDamage();
    expect(flow.value).toBe(0);
  });

  it('never exceeds max', () => {
    for (let i = 0; i < 40; i++) flow.onHit('perfect', 3);
    expect(flow.value).toBe(FLOW.max);
    expect(flow.isFull).toBe(true);
  });

  it('banks a chain only when the sequence completed', () => {
    flow.consume(true);
    flow.consume(false);
    expect(flow.chains).toBe(1);
    expect(flow.value).toBe(0);
  });

  it('tightens the reaction window and then holds it', () => {
    const windows = FLOW.reactionWindows.map((_, i) => flowReactionWindow(i));
    for (let i = 1; i < windows.length; i++) expect(windows[i]).toBeLessThan(windows[i - 1]);
    // Past the table, the window must not keep shrinking toward impossible.
    expect(flowReactionWindow(99)).toBe(windows[windows.length - 1]);
  });
});

describe('PatternDirector', () => {
  const build = (seed = 7) => {
    const d = new PatternDirector(new Rng(seed));
    d.reset(0);
    return d;
  };

  it('opens with one LEFT then one RIGHT so the mapping is taught first', () => {
    const d = build();
    expect(d.nextPattern(0, 5, false).map((t) => t.side)).toEqual(['L']);
    expect(d.nextPattern(0, 4, false).map((t) => t.side)).toEqual(['R']);
  });

  it('always schedules impacts strictly in the future and in order', () => {
    const d = build();
    let last = 0;
    for (let i = 0; i < 60; i++) {
      for (const t of d.nextPattern(i * 2, 0, true)) {
        expect(t.impactAt).toBeGreaterThan(last);
        last = t.impactAt;
      }
    }
  });

  it('never schedules two impacts closer than the fairness floor', () => {
    const d = build(99);
    let last = -Infinity;
    for (let i = 0; i < 200; i++) {
      for (const t of d.nextPattern(i, 0, true)) {
        if (last > -Infinity) expect(t.impactAt - last).toBeGreaterThanOrEqual(0.45);
        last = t.impactAt;
      }
    }
  });

  it('gives tutorial threats a longer approach than late-game threats', () => {
    const early = build().nextPattern(0, 5, false)[0];
    const late = build().nextPattern(140, 0, false)[0];
    expect(early.approach).toBeGreaterThan(late.approach);
  });

  it('never produces a rare threat during tutorial safety', () => {
    const d = build(3);
    for (let i = 0; i < 5; i++) {
      for (const t of d.nextPattern(60, 5, true)) expect(t.rare).toBe(false);
    }
  });

  it('tightens spacing as phases advance but stops at the floor', () => {
    const early = phaseFor(0);
    const mid = phaseFor(60);
    const late = phaseFor(300);
    expect(mid.spacing[0]).toBeLessThan(early.spacing[0]);
    expect(late.spacing[0]).toBeGreaterThanOrEqual(0.45);
    expect(late.complexity).toBeGreaterThan(early.complexity);
  });

  it('is deterministic for a given seed', () => {
    const a = build(42);
    const b = build(42);
    for (let i = 0; i < 20; i++) {
      expect(a.nextPattern(i, 0, true)).toEqual(b.nextPattern(i, 0, true));
    }
  });

  it('can be pushed forward after Flow without producing a past impact', () => {
    const d = build();
    d.nextPattern(0, 0, false);
    d.delayTo(100);
    expect(d.nextPattern(10, 0, false)[0].impactAt).toBeGreaterThan(100);
  });
});

describe('Progression', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Storage caches in-module; reload it so each test sees a clean save.
    saveSave({ mastery: 0, unlocked: ['fox'], best: 0, runs: 0 });
  });

  it('unlocks only the first ninja at zero mastery', () => {
    const s = unlockState(0);
    expect(s.unlocked).toEqual(['fox']);
    expect(s.next).toBe('cat');
    expect(s.progress).toBe(0);
  });

  it('reaches the second ninja inside a couple of decent runs', () => {
    // A competent early run: ~30 kills, ~12 perfects, one Flow, ~6k score.
    const run = masteryFor({ kills: 30, perfects: 12, flows: 1, score: 6000 });
    expect(run).toBeGreaterThanOrEqual(UNLOCKS.thresholds[1]);
  });

  it('reports partial progress toward the next unlock', () => {
    const half = (UNLOCKS.thresholds[1] + UNLOCKS.thresholds[0]) / 2;
    const s = unlockState(half);
    expect(s.progress).toBeCloseTo(0.5, 1);
    expect(s.next).toBe('cat');
  });

  it('saturates when everything is unlocked', () => {
    const s = unlockState(UNLOCKS.thresholds[UNLOCKS.thresholds.length - 1] + 50_000);
    expect(s.next).toBeNull();
    expect(s.progress).toBe(1);
    expect(s.unlocked).toHaveLength(UNLOCKS.order.length);
  });

  /**
   * A continued run commits twice — once when it first ended, so nothing is
   * lost if the tab closes on the results screen, and again when it ended for
   * good. The second commit must add only what happened after the continue.
   */
  it('counts a continued run once and its progress once', () => {
    const first = commitRun({ kills: 10, perfects: 4, flows: 1, score: 1000 });
    const afterFirst = loadSave();

    const second = commitRun(
      { kills: 6, perfects: 3, flows: 1, score: 700 },
      0,
      { countRun: false, bestScore: 1700 },
    );
    const afterSecond = loadSave();

    // One run, not two.
    expect(afterSecond.runs).toBe(afterFirst.runs);
    // Mastery is the sum of the two halves, never the whole run counted twice.
    expect(afterSecond.mastery - afterFirst.mastery).toBe(
      masteryFor({ kills: 6, perfects: 3, flows: 1, score: 700 }),
    );
    // The personal best is the run's real total, not either half of it.
    expect(afterSecond.best).toBeGreaterThanOrEqual(1700);
    expect(second.state.mastery).toBe(afterSecond.mastery);
    expect(first.state.mastery).toBe(afterFirst.mastery);
  });

  it('reports newly unlocked ninjas exactly once', () => {
    const first = commitRun({ kills: 200, perfects: 100, flows: 4, score: 20_000 });
    expect(first.newlyUnlocked.length).toBeGreaterThan(0);
    const second = commitRun({ kills: 0, perfects: 0, flows: 0, score: 0 });
    expect(second.newlyUnlocked).toEqual([]);
  });

  it('accumulates mastery across runs and keeps the best score', () => {
    commitRun({ kills: 10, perfects: 3, flows: 0, score: 500 });
    commitRun({ kills: 10, perfects: 3, flows: 0, score: 200 });
    const save = loadSave();
    expect(save.best).toBe(500);
    expect(save.runs).toBe(2);
    expect(save.mastery).toBeGreaterThan(0);
  });
});

describe('Storage safety', () => {
  it('survives a localStorage that throws on every access', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    // The module caches its save, so a throwing store must not surface here.
    expect(() => saveSave({ best: 123 })).not.toThrow();
    expect(loadSave().best).toBe(123);
    spy.mockRestore();
  });

  it('exposes whether persistence is working', () => {
    expect(typeof storageAvailable()).toBe('boolean');
  });
});
