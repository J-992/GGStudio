import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { FLOW } from '../config';
import { FlowMode } from '../game/FlowMode';
import { flowReactionWindow } from '../game/FlowSystem';
import { Rng } from '../core/Rng';

/**
 * Flow's readability invariants.
 *
 * The chain asks for a direction under a tightening clock and ends instantly on
 * a wrong press. That is only fair while the direction it wants is visible, so
 * these tests assert the CUE, not just the rules: at every moment the chain
 * accepts input, exactly one body is lit, and it is on the side the chain is
 * about to accept. A version of this game that plays perfectly under a script
 * reading its own internals, but shows the player nothing, passes the rules and
 * fails here.
 */

function makeFlow(seed = 4) {
  const flow = new FlowMode(new Scene(), new Rng(seed));
  flow.start(0, 0);
  return flow;
}

/** Runs the chain forward, always pressing the side the cue points at. */
function playByTheCue(flow: FlowMode, steps = 40) {
  const dt = 1 / 60;
  let now = 0;
  let litSides: Array<string | null> = [];
  for (let i = 0; i < steps * 60 && flow.phase !== 'off'; i++) {
    now += dt;
    flow.update(dt, now);
    if (flow.acceptsInput) {
      const lit = flow
        .debugTargets()
        .filter((t) => t.marked === 'target')
        .map((t) => t.side);
      litSides.push(lit.length === 1 ? lit[0] : null);
      if (flow.currentSide) flow.press(flow.currentSide === 'L' ? 'left' : 'right');
    }
  }
  return { litSides, events: flow.drain() };
}

describe('Flow chain cue', () => {
  it('lights exactly one target, on the side it is about to accept', () => {
    const flow = makeFlow();
    const dt = 1 / 60;
    let now = 0;
    let checks = 0;
    for (let i = 0; i < 600 && flow.phase !== 'off'; i++) {
      now += dt;
      flow.update(dt, now);
      if (!flow.acceptsInput) continue;
      const lit = flow.debugTargets().filter((t) => t.marked === 'target');
      expect(lit).toHaveLength(1);
      expect(lit[0].side).toBe(flow.currentSide);
      checks += 1;
      flow.press(flow.currentSide === 'L' ? 'left' : 'right');
    }
    expect(checks).toBeGreaterThan(4);
  });

  it('accepts the first press as soon as the first target is marked', () => {
    // Showing a glowing target while rejecting its matching press teaches the
    // player that Flow controls do nothing. The visual cue and input window
    // must become active on the same frame.
    const flow = makeFlow();
    expect(flow.phase).toBe('activating');
    expect(flow.acceptsInput).toBe(true);
    const lit = flow.debugTargets().filter((t) => t.marked === 'target');
    expect(lit).toHaveLength(1);
    expect(flow.currentSide).toBe(lit[0].side);
    expect(flow.press(lit[0].side === 'L' ? 'left' : 'right')).toBe(true);
    expect(flow.hitCount).toBe(1);
  });

  it('lets the first-ever Flow retry a wrong side instead of ending immediately', () => {
    const flow = new FlowMode(new Scene(), new Rng(12));
    flow.start(0, 0, true);
    const correct = flow.currentSide === 'L' ? 'left' : 'right';
    const wrong = correct === 'left' ? 'right' : 'left';

    expect(flow.press(wrong)).toBe(true);
    expect(flow.hitCount).toBe(0);
    expect(flow.drain().some((event) => event.type === 'wrong')).toBe(true);
    expect(flow.active).toBe(true);

    expect(flow.press(correct)).toBe(true);
    expect(flow.hitCount).toBe(1);
  });

  it('never leaves the player without a cue at any point in the chain', () => {
    // The invariant that was missing: from the moment Flow starts until it
    // ends, there is always a side being shown.
    const flow = makeFlow(6);
    const dt = 1 / 60;
    let now = 0;
    let blind = 0;
    for (let i = 0; i < 900 && flow.phase !== 'off'; i++) {
      now += dt;
      flow.update(dt, now);
      // The cue is only owed while the chain is asking for something: the
      // finisher dash, the recovery beat and the frame Flow ends are not.
      if (flow.phase !== 'activating' && flow.phase !== 'chain' && flow.phase !== 'finisherWindup') {
        continue;
      }
      if (flow.currentSide === null) blind += 1;
      if (flow.acceptsInput) flow.press(flow.currentSide === 'L' ? 'left' : 'right');
    }
    expect(blind).toBe(0);
  });

  it('is winnable by a player who only ever reads the cue', () => {
    for (const seed of [1, 2, 3, 9, 17]) {
      const flow = makeFlow(seed);
      const { litSides, events } = playByTheCue(flow);
      expect(litSides.every((s) => s !== null), `seed ${seed}`).toBe(true);
      expect(events.some((e) => e.type === 'end' && e.completed), `seed ${seed}`).toBe(true);
      expect(events.some((e) => e.type === 'miss'), `seed ${seed}`).toBe(false);
    }
  });

  it('gives the opening press the most room, then tightens', () => {
    const windows = [0, 1, 2, 3, 4, 5].map(flowReactionWindow);
    for (let i = 1; i < windows.length; i++) expect(windows[i]).toBeLessThan(windows[i - 1]);
    // Long enough to take in a screen that just changed completely.
    expect(windows[0]).toBeGreaterThanOrEqual(1);
    // The chain still accelerates — the last press is meaningfully tighter
    // than the first, so Flow builds pressure rather than staying flat.
    expect(windows[windows.length - 1]).toBeLessThan(windows[0] * 0.75);
    // But it stays comfortably inside human reaction time, on a phone, while
    // reading a new target. Flow is the reward for playing well; a chain that
    // ends in a coin flip against the clock is a punishment dressed as one.
    expect(windows[windows.length - 1]).toBeGreaterThanOrEqual(0.6);
  });

  it('clears every mark when the chain ends, however it ended', () => {
    for (const wrongPress of [true, false]) {
      const flow = makeFlow(5);
      const dt = 1 / 60;
      let now = 0;
      for (let i = 0; i < 120; i++) {
        now += dt;
        flow.update(dt, now);
      }
      if (wrongPress) {
        flow.press(flow.currentSide === 'L' ? 'right' : 'left');
      } else {
        flow.abort();
      }
      expect(flow.debugTargets().every((t) => t.marked === 'none')).toBe(true);
    }
  });

  it('never punishes Flow with health, only with the chain', () => {
    const flow = makeFlow(8);
    const dt = 1 / 60;
    let now = 0;
    for (let i = 0; i < 120; i++) {
      now += dt;
      flow.update(dt, now);
    }
    flow.press(flow.currentSide === 'L' ? 'right' : 'left');
    const events = flow.drain();
    expect(events.some((e) => e.type === 'miss')).toBe(true);
    expect(events.some((e) => e.type === 'end' && e.completed === false)).toBe(true);
  });

  it('still asks the player to read rather than alternate', () => {
    // A chain that strictly alternates can be won with a rhythm and no reading.
    const sides: string[] = [];
    for (const seed of [1, 4, 12, 30]) {
      const flow = new FlowMode(new Scene(), new Rng(seed));
      flow.start(0, 0);
      sides.push(flow.debugTargets().map((t) => t.side).join(''));
    }
    const alternating = sides.filter((s) => /^(LR)+L?$|^(RL)+R?$/.test(s));
    expect(alternating.length).toBeLessThan(sides.length);
  });
});

describe('Flow timing', () => {
  it('keeps the activation hold as free read time without closing input', () => {
    expect(FLOW.activationHold).toBeGreaterThan(0.3);
    expect(FLOW.activationHold).toBeLessThan(0.8);
    const flow = makeFlow();
    const dt = 1 / 60;
    let now = 0;
    while (now < FLOW.activationHold - dt) {
      now += dt;
      flow.update(dt, now);
      expect(flow.acceptsInput).toBe(true);
    }
    while (now < FLOW.activationHold + 0.05) {
      now += dt;
      flow.update(dt, now);
    }
    expect(flow.acceptsInput).toBe(true);
  });
});
