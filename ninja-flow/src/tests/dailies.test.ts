import { describe, expect, it } from 'vitest';
import {
  commitDaily,
  dailiesFor,
  dayKey,
  emptyState,
  forToday,
  goalsFor,
  type DailyRun,
} from '../game/Dailies';

/**
 * Daily goals exist to give a player a reason to come back, so their failure
 * modes are all about trust: a goal that pays twice, a goal that cannot be
 * finished, or a set that changes under the player mid-day would each be worse
 * than having no goals at all.
 */

const run = (over: Partial<DailyRun> = {}): DailyRun => ({
  kills: 0,
  perfects: 0,
  flows: 0,
  score: 0,
  bestCombo: 0,
  held: 0,
  ...over,
});

describe('daily goals', () => {
  it('gives the same three goals to everyone on the same day', () => {
    const a = goalsFor('2026-08-29');
    const b = goalsFor('2026-08-29');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((g) => g.id)).size).toBe(3);
  });

  it('changes the set from one day to the next', () => {
    const week = ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'];
    const sets = week.map((d) => goalsFor(d).map((g) => `${g.id}:${g.target}`).join('|'));
    expect(new Set(sets).size).toBeGreaterThan(1);
  });

  it('always offers goals that can actually be finished', () => {
    for (let i = 0; i < 400; i++) {
      const day = dayKey(new Date(2026, 0, 1 + i));
      for (const goal of goalsFor(day)) {
        expect(goal.target, `${day} ${goal.id}`).toBeGreaterThan(0);
        expect(goal.reward).toBeGreaterThan(0);
        expect(goal.label.length).toBeGreaterThan(4);
      }
    }
  });

  it('pays a goal exactly once, however many runs follow it', () => {
    const day = '2026-08-29';
    let state = emptyState(day);
    let total = 0;
    // Ten runs, each enough to finish everything on offer.
    for (let i = 0; i < 10; i++) {
      const result = commitDaily(
        state,
        run({ kills: 500, perfects: 500, flows: 50, score: 999999, bestCombo: 200, held: 100 }),
        day,
      );
      state = result.state;
      total += result.mastery;
    }
    const once = goalsFor(day).reduce((n, g) => n + g.reward, 0);
    expect(total).toBe(once);
    expect(dailiesFor(state, day).every((d) => d.done)).toBe(true);
  });

  it('adds up counting goals across runs but takes the best of per-run ones', () => {
    const day = '2026-08-29';
    const goals = goalsFor(day);
    let state = emptyState(day);
    for (let i = 0; i < 3; i++) {
      state = commitDaily(state, run({ kills: 10, perfects: 5, flows: 1, bestCombo: 12, score: 900 }), day).state;
    }
    for (const goal of goals) {
      const progress = state.progress[goal.id] ?? 0;
      if (goal.metric === 'combo') expect(progress).toBe(12);
      else if (goal.metric === 'score') expect(progress).toBe(900);
      else if (goal.metric === 'kills') expect(progress).toBe(30);
      else if (goal.metric === 'perfects') expect(progress).toBe(15);
      else if (goal.metric === 'flows') expect(progress).toBe(3);
    }
  });

  it('starts clean on a new day and never carries a debt', () => {
    const before = commitDaily(emptyState('2026-08-29'), run({ kills: 40 }), '2026-08-29').state;
    const today = forToday(before, '2026-08-30');
    expect(today.day).toBe('2026-08-30');
    expect(today.progress).toEqual({});
    expect(today.claimed).toEqual([]);
    // Nothing about yesterday makes today harder — no streak, no catch-up.
    expect(dailiesFor(today, '2026-08-30').every((d) => d.progress === 0)).toBe(true);
  });

  it('never reports progress beyond the target', () => {
    const day = '2026-08-29';
    const state = commitDaily(emptyState(day), run({ kills: 9999, perfects: 9999, flows: 99, score: 1e6, bestCombo: 999, held: 99 }), day).state;
    for (const daily of dailiesFor(state, day)) {
      expect(daily.progress).toBe(daily.target);
    }
  });
});
