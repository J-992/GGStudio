import { describe, expect, it } from 'vitest';
import { HIGHLIGHTS } from '../config';
import { captionFor, MomentLog, type Moment } from '../game/Highlights';
import { paceFor } from '../game/HighlightReel';

const m = (over: Partial<Moment>): Moment => ({
  kind: 'good',
  side: 'L',
  combo: 1,
  at: 0,
  ...over,
});

describe('MomentLog', () => {
  it('shows no reel for a run with too little worth replaying', () => {
    const log = new MomentLog();
    expect(log.pick()).toEqual([]);
    log.add(m({ kind: 'perfect' }));
    expect(log.pick().length).toBeLessThan(HIGHLIGHTS.minMoments);
    expect(log.pick()).toEqual([]);
  });

  it('shows a different kind of scene in each slot when the run had them', () => {
    // Three Flow finishers must not become three copies of the same vignette.
    const log = new MomentLog();
    for (let i = 0; i < 4; i++) log.add(m({ kind: 'finisher', combo: 20 + i, at: i }));
    log.add(m({ kind: 'perfect', combo: 30, at: 10 }));
    log.add(m({ kind: 'rare', combo: 4, at: 11 }));
    const kinds = log.pick(3).map((p) => p.kind);
    expect(new Set(kinds).size).toBe(3);
    expect(kinds).toContain('finisher');
  });

  it('still fills the reel by weight when the run had only one kind', () => {
    const log = new MomentLog();
    for (let i = 0; i < 5; i++) log.add(m({ kind: 'perfect', combo: i, at: i }));
    const picked = log.pick(3);
    expect(picked).toHaveLength(3);
    expect(picked.map((p) => p.combo)).toEqual([2, 3, 4]);
  });

  it('picks the most spectacular moments of the run', () => {
    const log = new MomentLog();
    for (let i = 0; i < 20; i++) log.add(m({ kind: 'good', combo: i, at: i }));
    log.add(m({ kind: 'finisher', combo: 5, at: 30 }));
    log.add(m({ kind: 'rare', combo: 2, at: 31 }));
    log.add(m({ kind: 'perfect', combo: 12, at: 32 }));
    const picked = log.pick(3);
    expect(picked.map((p) => p.kind).sort()).toEqual(['finisher', 'perfect', 'rare']);
  });

  it('plays the reel in chronological order, not best-first', () => {
    const log = new MomentLog();
    log.add(m({ kind: 'perfect', at: 50 }));
    log.add(m({ kind: 'finisher', at: 10 }));
    log.add(m({ kind: 'rare', at: 30 }));
    const picked = log.pick(3);
    expect(picked.map((p) => p.at)).toEqual([10, 30, 50]);
  });

  it('stays bounded on a long expert run without losing the best moments', () => {
    const log = new MomentLog();
    log.add(m({ kind: 'finisher', at: 1 }));
    for (let i = 0; i < 500; i++) log.add(m({ kind: 'good', combo: 1, at: 2 + i }));
    expect(log.count).toBeLessThanOrEqual(64);
    expect(log.pick(3).some((p) => p.kind === 'finisher')).toBe(true);
  });

  it('resets between runs', () => {
    const log = new MomentLog();
    log.add(m({ kind: 'finisher' }));
    log.add(m({ kind: 'rare' }));
    log.reset();
    expect(log.count).toBe(0);
    expect(log.pick()).toEqual([]);
  });
});

describe('captionFor', () => {
  it('names each moment by what the player earned', () => {
    expect(captionFor(m({ kind: 'finisher' }))).toBe('FLOW FINISHER');
    expect(captionFor(m({ kind: 'rare' }))).toBe('GOLDEN TARGET');
    expect(captionFor(m({ kind: 'perfect', combo: 24 }))).toBe('PERFECT ×24');
    expect(captionFor(m({ kind: 'perfect', combo: 1 }))).toBe('PERFECT');
    expect(captionFor(m({ kind: 'good', combo: 8 }))).toBe('COMBO ×8');
    expect(captionFor(m({ kind: 'good', combo: 1 }))).toBe('CLEAN HIT');
  });
});

describe('reel pacing', () => {
  it('plays a short moment at speed and a long chain in slow motion', () => {
    const quick = paceFor(m({ kind: 'perfect', combo: 2 }));
    const long = paceFor(m({ kind: 'perfect', combo: 40 }));
    expect(quick).toBeGreaterThan(0.85);
    expect(long).toBeLessThan(0.5);
    expect(long).toBeLessThan(quick);
  });

  it('ramps smoothly rather than switching between two speeds', () => {
    const paces = [2, 8, 14, 20, 26, 34].map((combo) => paceFor(m({ kind: 'perfect', combo })));
    for (let i = 1; i < paces.length; i++) expect(paces[i]).toBeLessThanOrEqual(paces[i - 1]);
    expect(new Set(paces).size).toBeGreaterThan(3);
  });

  it('always shows the finisher and the golden target slowly', () => {
    // Even a one-hit finisher is a set piece; it never plays at full speed.
    for (const kind of ['finisher', 'rare'] as const) {
      expect(paceFor(m({ kind, combo: 1 }))).toBeLessThanOrEqual(0.5);
    }
  });
});
