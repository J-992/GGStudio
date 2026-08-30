import { describe, expect, it } from 'vitest';

import { consumeEdges, latchEdges, type RunInput } from '../src/physics/PlayerController';
import { PHYSICS } from '../src/physics/PhysicsConfig';

/**
 * Regression cover for the input-drop bug behind "so much input lag,
 * especially when the player swaps lanes."
 *
 * The bug was never in the input manager, the physics or the renderer - all
 * three were doing exactly what they claimed. It was in how `Game.runFrame`
 * carried a press from the frame that read it to the fixed step that applies
 * it: the pending input was *assigned* from each frame's snapshot rather than
 * latched, and a frame that drives no fixed step (any frame shorter than
 * `fixedTimeStep`, i.e. most of them above 60 Hz) therefore overwrote an
 * un-consumed press with an empty one.
 */

function empty(): RunInput {
  return { laneStep: 0, turn: 0, jump: false, slide: false };
}

function press(over: Partial<RunInput>): RunInput {
  return { ...empty(), ...over };
}

/**
 * Replays the frame/step interleave `Game.runFrame` performs, against the same
 * accumulator arithmetic `PhysicsWorld.update` uses.
 *
 * @param frameHz    display rate to simulate
 * @param pressOn    index of the frame the player presses on
 * @returns the inputs each fixed step actually observed
 */
function simulate(frameHz: number, pressOn: number, frames = 12): RunInput[] {
  const step = PHYSICS.fixedTimeStep;
  const dt = 1 / frameHz;
  const pending = empty();
  const seenByStep: RunInput[] = [];
  let accumulator = 0;

  for (let frame = 0; frame < frames; frame++) {
    const snapshot = frame === pressOn ? press({ laneStep: -1, jump: true }) : empty();
    latchEdges(pending, snapshot);

    accumulator += dt;
    let first = true;
    while (accumulator >= step) {
      seenByStep.push({ ...pending });
      // Mirrors `Game.fixedStep`: cleared after the FIRST sub-step, so
      // sub-steps two onward see no input.
      if (first) {
        consumeEdges(pending);
        first = false;
      }
      accumulator -= step;
    }
  }

  return seenByStep;
}

describe('drive input latching', () => {
  it('accumulates lane steps instead of overwriting them', () => {
    const pending = empty();
    latchEdges(pending, press({ laneStep: -1 }));
    latchEdges(pending, empty());

    // The overwrite bug is exactly this assertion failing.
    expect(pending.laneStep).toBe(-1);
  });

  it('keeps jump and slide pulses latched across an empty frame', () => {
    const pending = empty();
    latchEdges(pending, press({ jump: true, slide: true }));
    latchEdges(pending, empty());

    expect(pending.jump).toBe(true);
    expect(pending.slide).toBe(true);
  });

  it('holds a turn request until something consumes it', () => {
    const pending = empty();
    latchEdges(pending, press({ turn: 1 }));
    latchEdges(pending, empty());
    expect(pending.turn).toBe(1);

    consumeEdges(pending);
    expect(pending.turn).toBe(0);
  });

  it('clamps a banked sweep to the two lanes a single frame could ask for', () => {
    const pending = empty();
    for (let i = 0; i < 6; i++) latchEdges(pending, press({ laneStep: -1 }));

    // Three lanes exist; a stuck key banking across frames must not become an
    // unbounded sweep just because no fixed step ran for a while.
    expect(pending.laneStep).toBe(-2);
  });

  it('a later press on the same side replaces a consumed one, not stacks on it', () => {
    const pending = empty();
    latchEdges(pending, press({ laneStep: 1 }));
    consumeEdges(pending);
    latchEdges(pending, press({ laneStep: 1 }));

    expect(pending.laneStep).toBe(1);
  });

  describe('every press reaches a fixed step, at any refresh rate', () => {
    // 144 and 120 are where the bug was worst: at 144 Hz a frame is 6.9 ms
    // against a 16.67 ms step, so ~3 frames in 5 drive no step at all and a
    // press landing on one of them had a majority chance of being destroyed
    // before any step could see it.
    for (const hz of [30, 60, 75, 90, 120, 144, 165, 240]) {
      it(`${hz} Hz`, () => {
        // Sweep the press across a full frame cycle rather than trusting one
        // lucky offset - the bug was phase-dependent, and a single sample can
        // sit on a frame that happens to drive a step.
        for (let pressOn = 0; pressOn < 8; pressOn++) {
          const steps = simulate(hz, pressOn);
          const laneSteps = steps.filter((s) => s.laneStep !== 0);
          const jumps = steps.filter((s) => s.jump);

          expect(laneSteps.length, `lane press on frame ${pressOn} @ ${hz}Hz`).toBe(1);
          expect(jumps.length, `jump press on frame ${pressOn} @ ${hz}Hz`).toBe(1);
          expect(laneSteps[0].laneStep).toBe(-1);
        }
      });
    }
  });
});
