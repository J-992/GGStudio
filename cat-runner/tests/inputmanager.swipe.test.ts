import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { InputManager } from '../src/game/InputManager';

/**
 * Swipe gestures (feature: mobile touch controls) - swipe left/right maps to
 * the same lane-tap primitive keyboard/gamepad use, swipe up jumps, swipe
 * down slides. `InputManager` unconditionally touches `window`/`document` in
 * its constructor (see `inputmanager.test.ts`'s own doc comment), so this
 * stubs just enough of both for construction to succeed, and uses plain
 * `EventTarget`s (a real Node global) for `target`/`swipeSurface` rather than
 * needing a full DOM.
 */

function pointerEvent(pointerId: number, clientX: number, clientY: number): Event {
  return Object.assign(new Event('pointerdown'), { pointerId, clientX, clientY });
}

function pointerUpEvent(pointerId: number, clientX: number, clientY: number): Event {
  return Object.assign(new Event('pointerup'), { pointerId, clientX, clientY });
}

function pointerMoveEvent(pointerId: number, clientX: number, clientY: number): Event {
  return Object.assign(new Event('pointermove'), { pointerId, clientX, clientY });
}

describe('InputManager swipe gestures', () => {
  let now = 0;

  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function swipe(dx: number, dy: number, durationMs = 100): InputManager {
    const target = new EventTarget() as unknown as HTMLElement;
    const surface = new EventTarget() as unknown as HTMLElement;
    const input = new InputManager(target, surface);

    const el = surface as unknown as EventTarget;
    el.dispatchEvent(pointerEvent(1, 0, 0));
    now += durationMs;
    el.dispatchEvent(pointerUpEvent(1, dx, dy));
    return input;
  }

  it('swipe up sets jump on the next update()', () => {
    const input = swipe(0, -60);
    input.update();
    expect(input.drive.jump).toBe(true);
    expect(input.drive.slide).toBe(false);
  });

  it('swipe down sets slide on the next update()', () => {
    const input = swipe(0, 60);
    input.update();
    expect(input.drive.slide).toBe(true);
    expect(input.drive.jump).toBe(false);
  });

  it('swipe left registers a left lane tap', () => {
    const input = swipe(-60, 0);
    input.update();
    expect(input.drive.laneStep).toBe(-1);
  });

  it('swipe right registers a right lane tap', () => {
    const input = swipe(60, 0);
    input.update();
    expect(input.drive.laneStep).toBe(1);
  });

  it('marks touch active as soon as a swipe starts', () => {
    const input = swipe(0, -60);
    expect(input.isTouchActive).toBe(true);
  });

  it('ignores a drag shorter than the minimum swipe distance', () => {
    const input = swipe(0, -20);
    input.update();
    expect(input.drive.jump).toBe(false);
    expect(input.drive.slide).toBe(false);
    expect(input.drive.laneStep).toBe(0);
  });

  it('ignores a drag that takes too long to complete', () => {
    const input = swipe(0, -60, 900);
    input.update();
    expect(input.drive.jump).toBe(false);
  });

  it('ignores a diagonal drag too ambiguous to classify', () => {
    // Close to 45 degrees - neither axis clears SWIPE_DIRECTION_BIAS over the other.
    const input = swipe(50, -55);
    input.update();
    expect(input.drive.jump).toBe(false);
    expect(input.drive.slide).toBe(false);
    expect(input.drive.laneStep).toBe(0);
  });

  it('a second pointer while one gesture is active is ignored', () => {
    const target = new EventTarget() as unknown as HTMLElement;
    const surface = new EventTarget() as unknown as HTMLElement;
    const input = new InputManager(target, surface);
    const el = surface as unknown as EventTarget;

    el.dispatchEvent(pointerEvent(1, 0, 0));
    el.dispatchEvent(pointerEvent(2, 0, 0)); // second pointer down mid-gesture
    now += 100;
    // The second pointer's up should be ignored - it never started a tracked gesture.
    el.dispatchEvent(pointerUpEvent(2, 0, -60));
    input.update();
    expect(input.drive.jump).toBe(false);

    // The first pointer's own up still resolves normally.
    el.dispatchEvent(pointerUpEvent(1, 0, -60));
    input.update();
    expect(input.drive.jump).toBe(true);
  });
});

/**
 * Recognition-on-drag - the Subway Surfers-style control the swipe handling
 * was asked to match, and the touch half of the input-latency pass.
 *
 * Classifying a swipe on `pointerup` meant the input landed when the gesture
 * *ended*: the player had already flicked and was waiting on their own thumb
 * coming off the glass. That is 100-300 ms of latency no amount of physics or
 * render tuning can win back, and it is why steering felt detached. These pin
 * the behaviour that replaced it - the input fires the moment the finger
 * crosses the distance threshold, with the release path kept only as a
 * fallback for a flick the browser coalesced into no usable move event.
 */
describe('InputManager swipe recognition on drag', () => {
  let now = 0;

  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function begin(): { input: InputManager; el: EventTarget } {
    const target = new EventTarget() as unknown as HTMLElement;
    const surface = new EventTarget() as unknown as HTMLElement;
    const input = new InputManager(target, surface);
    const el = surface as unknown as EventTarget;
    el.dispatchEvent(pointerEvent(1, 0, 0));
    return { input, el };
  }

  it('fires a lane change while the finger is still down', () => {
    const { input, el } = begin();
    now += 40;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));

    // No pointerup has been dispatched at all - this is the whole point.
    input.update();
    expect(input.drive.laneStep).toBe(-1);
  });

  it('fires a jump while the finger is still down', () => {
    const { input, el } = begin();
    now += 40;
    el.dispatchEvent(pointerMoveEvent(1, 0, -40));

    input.update();
    expect(input.drive.jump).toBe(true);
  });

  it('does not fire twice when the finger is finally lifted', () => {
    const { input, el } = begin();
    now += 40;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));
    input.update();
    expect(input.drive.laneStep).toBe(-1);

    // The release must not re-classify the same movement.
    el.dispatchEvent(pointerUpEvent(1, -40, 0));
    input.update();
    expect(input.drive.laneStep).toBe(0);
  });

  it('does not fire before the finger has travelled far enough', () => {
    const { input, el } = begin();
    now += 20;
    el.dispatchEvent(pointerMoveEvent(1, -8, 0));

    input.update();
    expect(input.drive.laneStep).toBe(0);
  });

  it('lets one continuous drag produce several inputs', () => {
    // Flick left, then down, without ever lifting - the anchor is re-planted
    // after each recognised swipe so a gesture is a stream, not a single
    // input per touch.
    const { input, el } = begin();

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));
    input.update();
    expect(input.drive.laneStep).toBe(-1);
    expect(input.drive.slide).toBe(false);

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 40));
    input.update();
    expect(input.drive.slide).toBe(true);
  });

  it('treats a slow drag as a reposition, then still honours a flick from there', () => {
    const { input, el } = begin();

    // Dawdles well past the flick window without covering any distance.
    now += 900;
    el.dispatchEvent(pointerMoveEvent(1, 5, 0));
    input.update();
    expect(input.drive.laneStep).toBe(0);

    // A sharp flick measured from the re-planted anchor still registers.
    now += 40;
    el.dispatchEvent(pointerMoveEvent(1, 45, 0));
    input.update();
    expect(input.drive.laneStep).toBe(1);
  });

  it('ignores moves from a pointer that never started the tracked gesture', () => {
    const { input, el } = begin();
    now += 30;
    el.dispatchEvent(pointerMoveEvent(2, 0, -60));

    input.update();
    expect(input.drive.jump).toBe(false);
  });
});

/**
 * One flick, one lane.
 *
 * The bug this pins: recognition-on-drag re-plants the anchor after every
 * recognised swipe, so a single flick left kept crossing the 26 px threshold
 * as the thumb travelled - 100-200 px on a real phone - and booked a lane step
 * each time. From the centre lane the surplus clamped away at the track edge
 * and looked fine; starting from an outer lane, one swipe crossed the whole
 * track.
 *
 * The rule is that a gesture may not raise the *same* direction twice running.
 * Anything else about the stream is unchanged, which is what the second half
 * of these check.
 */
describe('InputManager one swipe is one lane', () => {
  let now = 0;

  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function begin(): { input: InputManager; el: EventTarget } {
    const target = new EventTarget() as unknown as HTMLElement;
    const surface = new EventTarget() as unknown as HTMLElement;
    const input = new InputManager(target, surface);
    const el = surface as unknown as EventTarget;
    el.dispatchEvent(pointerEvent(1, 0, 0));
    return { input, el };
  }

  it('books one lane for a full-length flick left, not several', () => {
    const { input, el } = begin();
    let total = 0;

    // A 180 px thumb flick, delivered as the browser would: a run of move
    // events. Every one of these used to be worth another lane.
    for (let x = -30; x >= -180; x -= 30) {
      now += 8;
      el.dispatchEvent(pointerMoveEvent(1, x, 0));
      input.update();
      total += input.drive.laneStep;
    }

    expect(total, `one flick booked ${total} lanes`).toBe(-1);
  });

  it('books one lane for a full-length flick right, not several', () => {
    const { input, el } = begin();
    let total = 0;

    for (let x = 30; x <= 180; x += 30) {
      now += 8;
      el.dispatchEvent(pointerMoveEvent(1, x, 0));
      input.update();
      total += input.drive.laneStep;
    }

    expect(total).toBe(1);
  });

  it('still gives a lane per flick when the finger is lifted between them', () => {
    // Two separate swipes are two lanes - that is how a player crosses the
    // track, and it must not be caught by the same-direction rule.
    const target = new EventTarget() as unknown as HTMLElement;
    const surface = new EventTarget() as unknown as HTMLElement;
    const input = new InputManager(target, surface);
    const el = surface as unknown as EventTarget;

    let total = 0;
    for (let i = 0; i < 2; i++) {
      el.dispatchEvent(pointerEvent(i + 1, 0, 0));
      now += 40;
      el.dispatchEvent(pointerMoveEvent(i + 1, -60, 0));
      input.update();
      total += input.drive.laneStep;
      el.dispatchEvent(pointerUpEvent(i + 1, -60, 0));
    }

    expect(total).toBe(-2);
  });

  it('still lets one drag flick left then down', () => {
    // The reason the anchor is re-planted at all; unaffected by the rule,
    // because down is not left.
    const { input, el } = begin();

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));
    input.update();
    expect(input.drive.laneStep).toBe(-1);

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 40));
    input.update();
    expect(input.drive.slide).toBe(true);
  });

  it('re-arms a direction once the finger has gone the other way', () => {
    // Left, right, left in one drag is a player changing their mind twice,
    // and is three real inputs rather than one flick still travelling.
    const { input, el } = begin();
    let total = 0;

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));
    input.update();
    total += input.drive.laneStep;

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, 0, 0)); // back the other way
    input.update();
    total += input.drive.laneStep;

    now += 30;
    el.dispatchEvent(pointerMoveEvent(1, -40, 0));
    input.update();
    total += input.drive.laneStep;

    expect(total).toBe(-1); // -1, +1, -1
  });

  it('does not let a long flick arm a corner turn on its own', () => {
    // registerTap doubles as half a corner turn, so a flick that booked two
    // taps inside DOUBLE_TAP_MS was also requesting a turn nobody asked for.
    const { input, el } = begin();
    let turn = 0;

    for (let x = -30; x >= -180; x -= 30) {
      now += 8;
      el.dispatchEvent(pointerMoveEvent(1, x, 0));
      input.update();
      if (input.drive.turn !== 0) turn = input.drive.turn;
    }

    expect(turn, 'a single flick requested a corner turn').toBe(0);
  });
});
